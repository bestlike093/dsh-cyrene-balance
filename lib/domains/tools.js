/**
 * dsh-cyrene-pet/tools —— 余额与工具 组件行（M6，已从主插件拆出）。
 *
 * 本行只装「要花钱、要采样的东西」：
 *   - 余额账本（ledger.json）与日/周消费曲线（ability.json）；
 *   - DeepSeek 余额查询（Key 经 cyrene/kernel.resolveApiKey() 取，本行不存明文）；
 *   - 系统采样（CPU/内存/GPU/电量/网速），6 秒缓存，供 live.json 的状态栏读。
 *
 * 不做的事：不碰模型请求、不改别的插件的状态、不注册全局副作用；
 * 行内失败只降级自己（查不到余额就让状态栏显示「还没连上」）。
 * 游戏/陪看/弹幕留在主行（它们属于 live 文件域，随 pet-live 行在 M5 走）。
 *
 * 拆分蓝图与里程碑见 docs/component-split.md（第十节，执行版修订在此文件头）。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { cpus, freemem, totalmem } from 'node:os'
import { join } from 'node:path'

import { normalizeAbility, playRound, summarizeAbility } from '../ability.mjs'

export const name = 'dsh-cyrene-pet/tools'
export const inject = ['webServer', 'systemPrompt', 'cyrene/kernel']

const ROUTE_PREFIX = '/cyrene-pet'
const MAX_BODY_BYTES = 32 * 1024
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const HUD_TTL = 6 * 1000

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`请求体超过 ${limit} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error(`JSON 解析失败：${error?.message ?? String(error)}`))
      }
    })
    req.on('error', reject)
  })
}

function beijingDayKey(now = new Date()) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000)
  const y = bj.getUTCFullYear()
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0')
  const d = String(bj.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

/* 进程内状态：余额与系统采样的缓存、冷却与并发去重。 */
let ledgerCache = null
let balanceCache = null
let balanceAt = 0
let balancePending = null
let balanceError = ''

let hudCache = null
let hudAt = 0
let hudPending = null
let hudRetryAt = 0
let cpuSample = null
let netSample = null

/* ------------------------------ 系统采样 ------------------------------ */

const SYS_PROBE_PS = [
  '$r=[ordered]@{}',
  '$net=@(Get-NetAdapterStatistics -ErrorAction SilentlyContinue)',
  'if($net.Count){$r.net=@{r=[double](($net|Measure-Object ReceivedBytes -Sum).Sum);s=[double](($net|Measure-Object SentBytes -Sum).Sum)}}else{$r.net=$null}',
  '$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue|Select-Object -First 1',
  'if($b){$r.bat=@{p=[int]$b.EstimatedChargeRemaining;charging=[bool]($b.BatteryStatus -eq 2 -or $b.BatteryStatus -ge 6)}}else{$r.bat=$null}',
  '$g=Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue|Measure-Object -Property UtilizationPercentage -Sum',
  'if($g.Sum -ne $null){$r.gpu=[math]::Round([double]$g.Sum,1)}else{$r.gpu=$null}',
  'ConvertTo-Json -InputObject $r -Compress -Depth 4',
].join('; ')

function runPowerShell(script, timeout) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout, windowsHide: true },
      (error, stdout) => resolve(error ? '' : String(stdout || '')),
    )
  })
}

function sampleCpu() {
  let idle = 0
  let total = 0
  for (const cpu of cpus()) {
    const t = cpu.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  const sample = { idle, total, at: Date.now() }
  let percent = null
  if (cpuSample !== null && sample.at > cpuSample.at) {
    const idleDelta = sample.idle - cpuSample.idle
    const totalDelta = sample.total - cpuSample.total
    if (totalDelta > 0) percent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)))
  }
  cpuSample = sample
  return percent
}

function memoryInfo() {
  const total = totalmem()
  const free = freemem()
  const used = Math.max(0, total - free)
  return {
    percent: total > 0 ? Math.round((used / total) * 100) : 0,
    usedGB: Math.round((used / 1024 ** 3) * 10) / 10,
    totalGB: Math.round((total / 1024 ** 3) * 10) / 10,
  }
}

async function probeHud() {
  const now = Date.now()
  if (hudCache !== null && now - hudAt < HUD_TTL) return hudCache
  if (hudPending !== null) return hudPending
  if (now < hudRetryAt) return hudCache

  const cpu = sampleCpu()
  const memory = memoryInfo()

  hudPending = (async () => {
    let extra = null
    const out = await runPowerShell(SYS_PROBE_PS, 8000)
    if (out.trim() === '') {
      hudRetryAt = Date.now() + 30000
    } else {
      try {
        extra = JSON.parse(out)
      } catch {
        hudRetryAt = Date.now() + 30000
      }
    }

    let netDown = null
    let netUp = null
    if (extra?.net && typeof extra.net.r === 'number') {
      const sample = { r: extra.net.r, s: extra.net.s, at: Date.now() }
      if (netSample !== null && sample.at > netSample.at) {
        const dt = (sample.at - netSample.at) / 1000
        if (dt > 0.2) {
          netDown = Math.max(0, Math.round(((sample.r - netSample.r) / dt) * 10) / 10)
          netUp = Math.max(0, Math.round(((sample.s - netSample.s) / dt) * 10) / 10)
        }
      }
      netSample = sample
    }

    hudCache = {
      cpu,
      mem: memory.percent,
      memUsedGB: memory.usedGB,
      memTotalGB: memory.totalGB,
      gpu: typeof extra?.gpu === 'number' ? Math.max(0, Math.min(100, Math.round(extra.gpu))) : null,
      netDown,
      netUp,
      battery: typeof extra?.bat?.p === 'number' ? extra.bat.p : null,
      charging: Boolean(extra?.bat?.charging),
      at: Date.now(),
    }
    hudAt = Date.now()
    return hudCache
  })()

  try {
    return await hudPending
  } finally {
    hudPending = null
  }
}

export function apply(ctx) {
  /* DSH 的 cordis 只把 (ctx, config) 传给 apply；注入的服务一律经 ctx.get 取。 */
  const kernel = ctx.get('cyrene/kernel')
  if (kernel === null || kernel === undefined) {
    throw new Error('dsh-cyrene-pet/tools：cyrene/kernel 未提供，本行无法启动')
  }

  const log = (message, error) => {
    if (error === undefined) ctx.logger?.warn?.(`${name}: ${message}`)
    else ctx.logger?.warn?.(`${name}: ${message}`, error)
  }

  const LEDGER_PATH = join(kernel.stateDir, 'ledger.json')
  const ABILITY_PATH = join(kernel.stateDir, 'ability.json')

  /* ------------------------------ 余额与记账 ------------------------------ */

  async function readLedger() {
    if (ledgerCache !== null) return { ...ledgerCache, history: { ...(ledgerCache.history ?? {}) } }
    try {
      const raw = await readFile(LEDGER_PATH, 'utf8')
      const parsed = JSON.parse(raw)
      ledgerCache = {
        day: typeof parsed?.day === 'string' ? parsed.day : beijingDayKey(),
        spent: money(parsed?.spent),
        recharge: money(parsed?.recharge),
        last: typeof parsed?.last === 'number' ? parsed.last : null,
        at: typeof parsed?.at === 'number' ? parsed.at : 0,
        history: parsed?.history && typeof parsed.history === 'object' ? parsed.history : {},
      }
    } catch {
      ledgerCache = { day: beijingDayKey(), spent: 0, recharge: 0, last: null, at: 0, history: {} }
    }
    return { ...ledgerCache, history: { ...ledgerCache.history } }
  }

  async function writeLedger(ledger) {
    ledgerCache = ledger
    await mkdir(kernel.stateDir, { recursive: true })
    const temp = `${LEDGER_PATH}.tmp`
    await writeFile(temp, JSON.stringify(ledger, null, 2), 'utf8')
    await rename(temp, LEDGER_PATH)
  }

  async function readAbility() {
    try {
      const raw = await readFile(ABILITY_PATH, 'utf8')
      return normalizeAbility(JSON.parse(raw))
    } catch {
      return normalizeAbility(null)
    }
  }

  async function writeAbility(stats) {
    await mkdir(kernel.stateDir, { recursive: true })
    const temp = `${ABILITY_PATH}.tmp`
    await writeFile(temp, JSON.stringify(normalizeAbility(stats), null, 2), 'utf8')
    await rename(temp, ABILITY_PATH)
  }

  async function observe(balance) {
    const day = beijingDayKey()
    const ledger = await readLedger()

    if (ledger.day !== day) {
      ledger.history[ledger.day] = { spent: ledger.spent, recharge: ledger.recharge }
      const keys = Object.keys(ledger.history).sort()
      while (keys.length > 7) delete ledger.history[keys.shift()]
      ledger.day = day
      ledger.spent = 0
      ledger.recharge = 0
    }

    if (typeof ledger.last === 'number') {
      const delta = money(ledger.last - balance.total)
      if (delta > 0.0001) ledger.spent = money(ledger.spent + delta)
      else if (delta < -0.0001) ledger.recharge = money(ledger.recharge - delta)
    }

    ledger.last = balance.total
    ledger.at = Date.now()
    await writeLedger(ledger)
    return ledger
  }

  async function fetchBalance() {
    const key = await kernel.resolveApiKey()
    if (key === '') throw new Error('还没有设置 DeepSeek API Key')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(BALANCE_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: controller.signal,
      })
      if (res.status === 401 || res.status === 403) {
        throw new Error(`API Key 无效或没有权限（HTTP ${res.status}）`)
      }
      if (!res.ok) throw new Error(`余额接口返回 HTTP ${res.status}`)
      const body = await res.json()
      const info = Array.isArray(body?.balance_infos) ? body.balance_infos[0] ?? {} : {}
      return {
        available: Boolean(body?.is_available),
        currency: String(info.currency || 'CNY'),
        total: money(info.total_balance),
        granted: money(info.granted_balance),
        toppedUp: money(info.topped_up_balance),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function queryBalance(force = false) {
    const now = Date.now()
    const stateNow = kernel.readState()
    const ttl = Math.max(15000, Math.min(300000, (Number(stateNow.refreshSeconds) || 30) * 1000))
    if (!force && balanceCache !== null && now - balanceAt < ttl) return balanceCache
    if (balancePending !== null) return balancePending

    balancePending = (async () => {
      try {
        const balance = await fetchBalance()
        const ledger = await observe(balance)
        balanceError = ''
        balanceCache = {
          ...balance,
          spent: ledger.spent,
          recharge: ledger.recharge,
          day: ledger.day,
          at: ledger.at,
          threshold: stateNow.balanceThreshold,
          dailyLimit: stateNow.dailyLimit,
          overThreshold:
            stateNow.balanceThreshold > 0 && balance.total < stateNow.balanceThreshold,
          overBudget: stateNow.dailyLimit > 0 && ledger.spent > stateNow.dailyLimit,
        }
        balanceAt = Date.now()
        return balanceCache
      } catch (error) {
        balanceError = error?.message ?? String(error)
        throw error
      } finally {
        balancePending = null
      }
    })()

    return balancePending
  }

  function invalidateBalance() {
    balanceCache = null
    balanceAt = 0
  }

  function invalidateLedger() {
    ledgerCache = null
  }

  async function restoreAbility(value) {
    await writeAbility(value)
  }

  ctx.provide('cyrene/tools', {
    queryBalance,
    /* live.json 用：失败回落到上一份缓存，比 null 更有用。 */
    getBalance: () => queryBalance(false).catch(() => balanceCache),
    getHud: () => probeHud().catch(() => hudCache),
    invalidateBalance,
    invalidateLedger,
    restoreAbility,
    balanceError: () => balanceError,
  })

  /* ---------------- 余额与能力 web 端点（exact 注册，先于主行 prefix 命中） ---------------- */

  ctx.effect(() => {
    const disposeBalance = ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/balance`,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这个路由' } })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const force = url.searchParams.get('force') === '1'
        try {
          const value = await queryBalance(force)
          sendJson(res, 200, { ok: true, value })
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            value: balanceCache,
            error: { code: 'balance-failed', message: error?.message ?? String(error) },
          })
        }
      },
    })

    const abilityHandler = async (req, res) => {
      if (req.method === 'GET') {
        const stats = await readAbility()
        sendJson(res, 200, { ok: true, stats, summary: summarizeAbility(stats) })
        return
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        const current = await readAbility()
        const played = playRound(current, body?.choice)
        if (played === null) {
          sendJson(res, 400, {
            ok: false,
            error: { code: 'bad-choice', message: '出拳只能是 rock / paper / scissors' },
          })
          return
        }
        await writeAbility(played.stats)
        sendJson(res, 200, {
          ok: true,
          stats: played.stats,
          summary: summarizeAbility(played.stats),
          round: played.round,
        })
        return
      }
      sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这个路由' } })
    }
    const disposeAbility = ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/companion/ability`,
      handler: abilityHandler,
    })

    log('余额/能力端点已注册')
    return () => {
      disposeBalance()
      disposeAbility()
    }
  }, `${name}: routes`)
}
