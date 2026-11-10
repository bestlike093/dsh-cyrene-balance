/**
 * 桌面状态条的系统指标采样。
 *
 * 只做采样与归一化，不碰界面：
 *   CPU   —— node:os 两次 tick 差值，3 秒一次
 *   内存  —— os.totalmem / os.freemem，跟 CPU 同一拍
 *   网速  —— PowerShell 读网卡累计字节，两次差值除以间隔
 *   电量  —— PowerShell 读 Win32_Battery，台式机没有就返回 null
 *   GPU   —— 型号取 app.getGPUInfo('basic')；利用率先试 nvidia-smi，连续失败 N 次
 *           才切 Windows 性能计数器（AMD / Intel 核显也读得到），之后每隔 10 分钟
 *           重试一次 nvidia-smi、成功即切回；两条路都不通才返回 null，界面写「—」
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

/** nvidia-smi 连续失败多少次才切 perfmon 兜底，避免一次抖动就永久降级。 */
const GPU_NVIDIA_FAIL_LIMIT = 3
/** 切到 perfmon 后，每隔这么久重试一次 nvidia-smi，成功就切回。 */
const GPU_RETRY_NVIDIA_MS = 10 * 60 * 1000

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

/** NVIDIA 显卡利用率。装了 nvidia-smi 的机器走这条，最快也最准。 */
const GPU_SCRIPT_NVIDIA =
  'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits'

/**
 * 通用回退：Windows 性能计数器。AMD、Intel 核显、没装 NVIDIA 驱动工具的机器都靠它。
 *
 * 任务管理器的 GPU 利用率读的就是 '\GPU Engine(*)\Utilization Percentage' 这组计数器。
 * 它是原始累计值，单次采样拿到的是 0，必须采两次让 PDH 自己算差值，所以用
 * -SampleInterval 1 -MaxSamples 2；整个调用约 2.5 秒，仍在 SCRIPT_TIMEOUT_MS 内。
 *
 * 实例非常多（本机 668 个，每进程每引擎各一条），只取 3D 引擎那批求和再夹到 100，
 * 量级与任务管理器一致（本机实测 SUM=45 / 单实例 MAX=20.1）。
 * 一条 3D 实例都没有时退回全部实例，免得某些驱动只暴露 VideoDecode 之类的引擎。
 *
 * 脚本是常量字符串，不拼接任何外部输入。
 */
const GPU_SCRIPT_PERFMON = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$s=Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples 2",
  'if(-not $s -or $s.Count -lt 2){exit 1}',
  '$last=$s[$s.Count-1].CounterSamples',
  "$d=$last | Where-Object { $_.InstanceName -like '*engtype_3d*' }",
  'if(-not $d){$d=$last}',
  '$v=($d | Measure-Object -Property CookedValue -Sum).Sum',
  'if(-not $v){$v=0}',
  '[int][math]::Round([math]::Min(100,$v))'
].join('; ')

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
  /** 网速 / 电量的失败退避。 */
  let slowBlockedUntil = 0
  /** GPU 自己的失败退避：与网速电量分开计时，一头的失败不会误伤另一头。 */
  let gpuBlockedUntil = 0

  let net = { downBps: null, upBps: null }
  let battery = { percent: null, charging: null }
  let gpu = { name: '', percent: null }
  let gpuReadAt = 0
  /**
   * 利用率读法：默认 'nvidia'，连续失败 GPU_NVIDIA_FAIL_LIMIT 次才切 'perfmon'。
   * 切过去不是永久的：每 GPU_RETRY_NVIDIA_MS 重试一次 nvidia-smi，成功就切回，
   * 驱动更新 / 游戏退出后还能回到更准的那条路。
   */
  let gpuMode = 'nvidia'
  /** nvidia-smi 连续失败计数，攒够上限才切 perfmon。 */
  let nvidiaFailCount = 0
  /** 切到 perfmon 的时刻，用来算下一次 nvidia 重试。 */
  let gpuModeSwitchedAt = 0

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

  /** GPU 利用率：6 秒缓存，两条路都读不到才保持 null，用自己的退避计时。 */
  async function readGpuPercent() {
    const now = Date.now()
    if (now - gpuReadAt < SLOW_INTERVAL_MS) return
    if (now < gpuBlockedUntil) return
    gpuReadAt = now

    let output = null
    // perfmon 模式下也定期重试 nvidia-smi：驱动装回来 / 游戏退出后能自己切回更准的路子。
    const tryNvidia =
      gpuMode === 'nvidia' ||
      (gpuMode === 'perfmon' && now - gpuModeSwitchedAt >= GPU_RETRY_NVIDIA_MS)
    if (tryNvidia) {
      output = await runPowerShell(GPU_SCRIPT_NVIDIA)
      if (output === null || output.trim() === '') {
        // 一次失败不立刻放弃：攒够连续失败次数才切，防止偶尔抖动把 nvidia 永久废掉。
        nvidiaFailCount += 1
        if (gpuMode === 'nvidia' && nvidiaFailCount >= GPU_NVIDIA_FAIL_LIMIT) {
          gpuMode = 'perfmon'
          gpuModeSwitchedAt = now
        }
        output = null
      } else {
        nvidiaFailCount = 0
        gpuMode = 'nvidia'
      }
    }
    if (output === null && gpuMode === 'perfmon') {
      const fallback = await runPowerShell(GPU_SCRIPT_PERFMON)
      if (fallback !== null && fallback.trim() !== '') output = fallback
    }

    if (output === null || output.trim() === '') {
      gpu.percent = null
      gpuBlockedUntil = now + RETRY_AFTER_MS
      return
    }
    /* nvidia-smi 多卡会输出多行，取最忙那张；perfmon 只有一行。
       取最大值而不是首行，多卡机器上才不会一直只显示固定的某一张卡。 */
    const values = output
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((n) => Number.isFinite(n))
    const value = values.length > 0 ? Math.max(...values) : Number.NaN
    gpu.percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
    // 有输出但解析不出数字，同样要退避，否则每拍都白跑 2.5 秒的计数器采样。
    if (!Number.isFinite(value)) gpuBlockedUntil = now + RETRY_AFTER_MS
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
