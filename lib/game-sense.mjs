/**
 * 游戏感知：只读地看一眼「现在有没有游戏在跑」，以及外部游戏工具的状态。
 *
 * 三条边界：
 *   1. 只读进程名，不启动、不注入、不改任何游戏；
 *   2. dsh-launcher 与三月七小助手都按「可选」处理，没装 / 没配就返回 missing；
 *   3. 结果缓存 8 秒，避免设置页轮询把 tasklist 刷爆。
 */

import { execFile } from 'node:child_process'

/* 只认进程名，不认窗口标题——标题里有角色名、也可能是别的程序起的同名窗口。 */
export const KNOWN_GAMES = Object.freeze([
  { id: 'starrail', name: '崩坏：星穹铁道', short: '星铁', processes: ['StarRail.exe', 'StarRailBeta.exe'] },
  { id: 'genshin', name: '原神', short: '原神', processes: ['GenshinImpact.exe', 'YuanShen.exe'] },
  { id: 'zzz', name: '绝区零', short: '绝区零', processes: ['ZenlessZoneZero.exe'] },
  { id: 'hi3', name: '崩坏3', short: '崩3', processes: ['BH3.exe'] },
])

const CACHE_MS = 8000
let cache = null
let cacheAt = 0
let pending = null

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      windowsHide: true,
      timeout: 6000,
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          reason: error.killed === true ? 'timeout' : 'exec-failed',
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        })
        return
      }
      resolve({ ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/* 只取进程名，不碰命令行和路径——够判断「在不在跑」，也少看一点别人的东西。 */
async function readProcessNames() {
  const result = await run('tasklist', ['/FO', 'CSV', '/NH'])
  if (!result.ok) return { ok: false, reason: result.reason, names: new Set(), total: 0 }
  const names = new Set()
  for (const line of result.stdout.split(/\r?\n/)) {
    const first = line.split(',')[0] ?? ''
    const name = first.replace(/^"|"$/g, '').trim().toLowerCase()
    if (name !== '') names.add(name)
  }
  return { ok: true, names, total: names.size }
}

export function matchRunning(names) {
  const running = []
  for (const game of KNOWN_GAMES) {
    const hit = game.processes.find((name) => names.has(name.toLowerCase()))
    if (hit) {
      running.push({ id: game.id, name: game.name, short: game.short, process: hit })
    }
  }
  return running
}

export async function detectGames({ force = false } = {}) {
  const now = Date.now()
  if (!force && cache !== null && now - cacheAt < CACHE_MS) return cache
  if (pending !== null && !force) return pending
  pending = (async () => {
    const scanned = await readProcessNames()
    const value = {
      ok: scanned.ok,
      reason: scanned.ok ? '' : scanned.reason,
      running: scanned.ok ? matchRunning(scanned.names) : [],
      processCount: scanned.total ?? 0,
      checkedAt: new Date().toISOString(),
    }
    cache = value
    cacheAt = Date.now()
    return value
  })()
  try {
    return await pending
  } finally {
    pending = null
  }
}

/* dsh-launcher：只读它的 /state，不代替它做任何事。 */
export async function readLauncherState(baseUrl) {
  const base = String(baseUrl ?? '').trim()
  if (base === '') return { ok: false, reason: 'not-configured' }
  const url = `${base.replace(/\/+$/, '')}/dsh-launcher/api/state`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const payload = await response.json()
    if (!payload || payload.ok !== true) return { ok: false, reason: 'bad-response' }
    const data = payload.data ?? {}
    const instances = Array.isArray(data.instances) ? data.instances : []
    const running = instances
      .filter((item) => item && (item.running === true || item.status === 'running'))
      .map((item) => ({ id: String(item.id ?? ''), name: String(item.name ?? item.game ?? '未命名实例') }))
    return { ok: true, running, total: instances.length }
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/* 三月七小助手：m7a.exe --status 直接吐 JSON。 */
export async function readM7aStatus(exePath) {
  const exe = String(exePath ?? '').trim()
  if (exe === '') return { ok: false, reason: 'not-configured' }
  const result = await run(exe, ['--status'], { timeout: 10000 })
  if (!result.ok) return { ok: false, reason: result.reason }
  const text = result.stdout.trim()
  if (text === '') return { ok: false, reason: 'empty' }
  try {
    const data = JSON.parse(text)
    return {
      ok: true,
      installed: data.game_path_exists === true,
      firstRunCompleted: data.first_run_completed === true,
      running: data.active_run ?? null,
    }
  } catch {
    return { ok: false, reason: 'bad-json' }
  }
}

export async function collectGameState(options = {}) {
  const [games, launcher, m7a] = await Promise.all([
    detectGames({ force: options.force === true }),
    readLauncherState(options.launcherUrl),
    readM7aStatus(options.m7aPath),
  ])
  return { games, launcher, m7a, at: new Date().toISOString() }
}
