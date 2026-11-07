/**
 * 桌面状态条的系统指标采样。
 *
 * 只做采样与归一化，不碰界面：
 *   CPU   —— node:os 两次 tick 差值，3 秒一次
 *   内存  —— os.totalmem / os.freemem，跟 CPU 同一拍
 *   网速  —— PowerShell 读网卡累计字节，两次差值除以间隔
 *   电量  —— PowerShell 读 Win32_Battery，台式机没有就返回 null
 *   GPU   —— 型号取 app.getGPUInfo('basic')；利用率尝试 nvidia-smi，
 *            没有就返回 null，界面写「—」，不伪造数字
 *
 * PowerShell 脚本是常量字符串，不拼接任何用户输入，也不接收参数。
 * 任何一项失败都只影响这一项，不影响其它指标，更不会抛到主流程。
 */

import { execFile } from 'node:child_process'
import os from 'node:os'

/** CPU / 内存的采样间隔。 */
const FAST_INTERVAL_MS = 3000

/** 网速 / 电量的采样间隔。 */
const SLOW_INTERVAL_MS = 6000

/** 单次 PowerShell 调用的超时。 */
const SCRIPT_TIMEOUT_MS = 8000

/** 采样失败后多久再试，避免每拍都拉起一个进程。 */
const RETRY_AFTER_MS = 30_000

/**
 * 固定脚本：输出 `接收字节|发送字节|电量|电池状态`，缺失项留空。
 * 不含变量插值，不接受外部参数。
 */
const NET_AND_BATTERY_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$adapters = Get-NetAdapterStatistics',
  '$rx = ($adapters | Measure-Object -Property ReceivedBytes -Sum).Sum',
  '$tx = ($adapters | Measure-Object -Property SentBytes -Sum).Sum',
  '$bat = Get-CimInstance Win32_Battery | Select-Object -First 1',
  '"{0}|{1}|{2}|{3}" -f $rx, $tx, $bat.EstimatedChargeRemaining, $bat.BatteryStatus'
].join('; ')

/**
 * Win32_Battery.BatteryStatus → 是否在充电。
 *
 * 1 = 正在放电；2 = 已接交流电（可能边充边用）；3 = 充满；6~8、10 = 各种充电档。
 * 4 / 5 / 9 描述的是电量高低而不是充电状态，读不到或认不出就返回 null，
 * 让界面只显示百分比，不猜一个「使用中」糊上去。
 */
export function chargingFromStatus(status) {
  if (!Number.isFinite(status)) return null
  if (status === 1) return false
  if ([2, 3, 6, 7, 8, 10].includes(status)) return true
  return null
}

/** NVIDIA 显卡利用率；没有 nvidia-smi 时返回 null。 */
const GPU_SCRIPT = 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits'

function runPowerShell(script) {
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]
    execFile(
      'powershell.exe',
      args,
      { timeout: SCRIPT_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        resolve(String(stdout).trim())
      }
    )
  })
}

/** 累计 CPU tick：idle 与 total 一起返回，下次相减得到占用率。 */
function readCpuTicks() {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    const times = cpu.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

function cpuUsagePercent(previous, current) {
  if (previous === null) return null
  const totalDelta = current.total - previous.total
  const idleDelta = current.idle - previous.idle
  if (totalDelta <= 0) return null
  const used = ((totalDelta - idleDelta) / totalDelta) * 100
  return Math.min(100, Math.max(0, Math.round(used)))
}

/** 内存占用：已用 / 总量。 */
function readMemory() {
  const total = os.totalmem()
  const free = os.freemem()
  if (total <= 0) return { percent: null, usedMb: null, totalMb: null }
  const used = total - free
  return {
    percent: Math.min(100, Math.max(0, Math.round((used / total) * 100))),
    usedMb: Math.round(used / 1024 / 1024),
    totalMb: Math.round(total / 1024 / 1024)
  }
}

function round1(value) {
  return Math.round(value * 10) / 10
}

/**
 * @param {{
 *   app: import('electron').App,
 *   onStats?: (stats: object) => void,
 *   log?: (message: string, error?: unknown) => void
 * }} options
 */
export function createSystemStats({ app, onStats, log = () => {} }) {
  let fastTimer = null
  let slowTimer = null
  let running = false

  let previousCpu = null
  let previousNet = null
  let lastSlowAt = 0
  let slowBlockedUntil = 0

  let net = { downBps: null, upBps: null }
  let battery = { percent: null, charging: null }
  let gpu = { name: '', percent: null }
  let gpuReadAt = 0

  let latest = {
    cpuPercent: null,
    memory: { percent: null, usedMb: null, totalMb: null },
    net: { downBps: null, upBps: null },
    battery: { percent: null, charging: null },
    gpu: { name: '', percent: null },
    sampledAt: 0
  }

  /** GPU 型号只在第一次读，之后不再打 app.getGPUInfo。 */
  async function readGpuName() {
    if (gpu.name !== '') return
    try {
      const info = await app.getGPUInfo('basic')
      const list = Array.isArray(info?.gpuDevice) ? info.gpuDevice : []
      const first = list.find((item) => typeof item?.deviceString === 'string')
      gpu.name = typeof first?.deviceString === 'string' ? first.deviceString.trim() : ''
    } catch (error) {
      log('GPU 型号读取失败', error)
    }
  }

  /** GPU 利用率：6 秒缓存，读不到就保持 null，30 秒后再试。 */
  async function readGpuPercent() {
    const now = Date.now()
    if (now - gpuReadAt < SLOW_INTERVAL_MS) return
    if (now < slowBlockedUntil) return
    gpuReadAt = now

    const output = await runPowerShell(GPU_SCRIPT)
    if (output === null || output === '') {
      gpu.percent = null
      slowBlockedUntil = now + RETRY_AFTER_MS
      return
    }
    const value = Number.parseInt(output.split(/\r?\n/)[0]?.trim() ?? '', 10)
    gpu.percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
  }

  /** 网速与电量：共用一次 PowerShell，失败则整体置空并退避。 */
  async function readSlowStats() {
    const now = Date.now()
    if (now - lastSlowAt < SLOW_INTERVAL_MS) return
    if (now < slowBlockedUntil) return
    lastSlowAt = now

    const output = await runPowerShell(NET_AND_BATTERY_SCRIPT)
    if (output === null) {
      net = { downBps: null, upBps: null }
      battery = { percent: null, charging: null }
      slowBlockedUntil = now + RETRY_AFTER_MS
      return
    }

    const [rxText, txText, batteryText, statusText] = output.split('|')
    const rx = Number.parseInt(rxText ?? '', 10)
    const tx = Number.parseInt(txText ?? '', 10)
    const batteryPercent = Number.parseInt(batteryText ?? '', 10)
    // 台式机没有电池，这一段整个是空字符串；NaN 交给 chargingFromStatus 判成 null。
    const charging = chargingFromStatus(Number.parseInt(statusText ?? '', 10))

    if (Number.isFinite(rx) && Number.isFinite(tx) && previousNet !== null) {
      const seconds = (now - previousNet.at) / 1000
      if (seconds > 0) {
        net = {
          downBps: Math.max(0, round1((rx - previousNet.rx) / seconds)),
          upBps: Math.max(0, round1((tx - previousNet.tx) / seconds))
        }
      }
    }
    if (Number.isFinite(rx) && Number.isFinite(tx)) {
      previousNet = { rx, tx, at: now }
    }

    battery = Number.isFinite(batteryPercent)
      ? { percent: Math.min(100, Math.max(0, batteryPercent)), charging }
      : { percent: null, charging }
  }

  function publish() {
    latest = {
      cpuPercent: latest.cpuPercent,
      memory: latest.memory,
      net,
      battery,
      gpu,
      sampledAt: Date.now()
    }
    try {
      onStats?.(latest)
    } catch (error) {
      log('系统指标回调失败', error)
    }
  }

  async function fastTick() {
    const ticks = readCpuTicks()
    const cpuPercent = cpuUsagePercent(previousCpu, ticks)
    previousCpu = ticks

    latest = {
      ...latest,
      cpuPercent,
      memory: readMemory(),
      net,
      battery,
      gpu,
      sampledAt: Date.now()
    }
    publish()
  }

  async function slowTick() {
    await Promise.all([readSlowStats(), readGpuPercent()])
  }

  async function start() {
    if (running) return
    running = true
    previousCpu = readCpuTicks()
    await readGpuName()
    await slowTick()
    await fastTick()

    fastTimer = setInterval(() => {
      void fastTick()
    }, FAST_INTERVAL_MS)
    fastTimer.unref?.()

    slowTimer = setInterval(() => {
      void slowTick().then(() => publish())
    }, SLOW_INTERVAL_MS)
    slowTimer.unref?.()
  }

  function stop() {
    running = false
    if (fastTimer !== null) clearInterval(fastTimer)
    if (slowTimer !== null) clearInterval(slowTimer)
    fastTimer = null
    slowTimer = null
  }

  function snapshot() {
    return latest
  }

  return { start, stop, snapshot }
}
