/**
 * 游戏助手宿主层。
 *
 * 和 game-daily.mjs 的分工：
 * - game-daily：排班与 dry-run，回答「什么时候跑」。
 * - game-assistant：风险门、周常积分账本、任务目录、执行器检测，回答
 *   「能不能开、这周拿了多少、还差什么、下一步做什么」。
 *
 * 默认状态是关的。confirmRisk 必须由渲染层连续调用两次，且两次都带
 * 正确短语与勾选，才会把 enabled 写成 true。磁盘上手改 enabled 不会生效。
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  GAME_ASSISTANT_TASKS,
  RISK_CONFIRM_PHRASE,
  RISK_DISCLOSURES,
  confirmRisk,
  describeWeek,
  disableRisk,
  emptyRiskGate,
  findTask,
  nextWeeklyResetAt,
  normalizeWeeklyEntry,
  planTask,
  readRiskGate,
  summarizeWeek
} from '@pet/core/browser'

const STATE_VERSION = 1
const MAX_WEEKLY_ENTRIES = 400

export function defaultState() {
  return {
    version: STATE_VERSION,
    risk: emptyRiskGate(),
    weekly: [],
    rank: { promotionLevel: 0, rankTier: 0, updatedAt: null }
  }
}

function normalizeRank(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const promotionLevel = Number(source.promotionLevel)
  const rankTier = Number(source.rankTier)
  return {
    promotionLevel:
      Number.isInteger(promotionLevel) && promotionLevel >= 0 && promotionLevel <= 999
        ? promotionLevel
        : 0,
    rankTier:
      Number.isInteger(rankTier) && rankTier >= 0 && rankTier <= 999 ? rankTier : 0,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : null
  }
}

function normalizeState(value) {
  const base = defaultState()
  if (value === null || typeof value !== 'object') return base
  const source = value
  const weekly = Array.isArray(source.weekly)
    ? source.weekly.filter(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          typeof item.weekKey === 'string' &&
          Number.isFinite(item.points)
      )
    : []
  return {
    version: STATE_VERSION,
    risk: readRiskGate(source.risk),
    weekly: weekly.slice(-MAX_WEEKLY_ENTRIES),
    rank: normalizeRank(source.rank)
  }
}

/** 执行器候选路径。全部由调用方注入 exists，测试不需要真的装软件。 */
export function executorCandidates() {
  const local = process.env.LOCALAPPDATA ?? ''
  const roaming = process.env.APPDATA ?? ''
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'

  return {
    bettergi: [
      process.env.BETTERGI_PATH,
      path.join(local, 'BetterGI', 'BetterGI.exe'),
      path.join(roaming, 'BetterGI', 'BetterGI.exe'),
      path.join(programFiles, 'BetterGI', 'BetterGI.exe'),
      'D:\\BetterGI\\BetterGI.exe',
      'E:\\BetterGI\\BetterGI.exe'
    ].filter((item) => typeof item === 'string' && item.trim() !== ''),
    march7th: [
      process.env.MARCH7TH_PATH,
      path.join(local, 'Programs', 'March7thAssistant', 'March7th Launcher.exe'),
      path.join(local, 'March7thAssistant', 'March7th Launcher.exe'),
      path.join(programFiles, 'March7thAssistant', 'March7th Launcher.exe'),
      path.join(programFilesX86, 'March7thAssistant', 'March7th Launcher.exe'),
      'D:\\March7thAssistant\\March7th Launcher.exe',
      'E:\\March7thAssistant\\March7th Launcher.exe'
    ].filter((item) => typeof item === 'string' && item.trim() !== ''),
    starrail: [
      process.env.STARRAIL_PATH,
      path.join(programFiles, 'Star Rail', 'Game', 'StarRail.exe'),
      path.join(programFiles, 'Star Rail', 'StarRail.exe'),
      'D:\\Star Rail\\Game\\StarRail.exe',
      'E:\\Star Rail\\Game\\StarRail.exe',
      'D:\\Games\\Star Rail\\Game\\StarRail.exe'
    ].filter((item) => typeof item === 'string' && item.trim() !== '')
  }
}

function pickExisting(candidates, exists) {
  for (const candidate of candidates) {
    try {
      if (exists(candidate)) return candidate
    } catch {
      // 路径探测失败就继续看下一个，不把异常抛给设置页。
    }
  }
  return null
}

export function createGameAssistantService(options = {}) {
  const filePath = options.filePath
  if (typeof filePath !== 'string' || filePath === '') {
    throw new TypeError('createGameAssistantService 需要 filePath')
  }

  const exists = typeof options.exists === 'function' ? options.exists : fs.existsSync
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const readFile =
    typeof options.readFile === 'function'
      ? options.readFile
      : (target) => fs.promises.readFile(target, 'utf8')
  const writeFile =
    typeof options.writeFile === 'function'
      ? options.writeFile
      : (target, content) => fs.promises.writeFile(target, content, 'utf8')

  let state = defaultState()
  let loaded = false

  async function load() {
    if (loaded) return state
    try {
      const raw = await readFile(filePath)
      state = normalizeState(JSON.parse(raw))
    } catch (error) {
      // 文件不存在、被截断、手改坏了，都回到「默认关闭」，不阻断设置页。
      if (error?.code !== 'ENOENT') state = defaultState()
    }
    loaded = true
    return state
  }

  async function persist() {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`)
  }

  function summary() {
    return summarizeWeek(state.weekly, now())
  }

  function detectExecutors() {
    const candidates = executorCandidates()
    return {
      bettergi: { path: pickExisting(candidates.bettergi, exists), candidates: candidates.bettergi },
      march7th: { path: pickExisting(candidates.march7th, exists), candidates: candidates.march7th },
      starrail: { path: pickExisting(candidates.starrail, exists), candidates: candidates.starrail }
    }
  }

  async function status() {
    await load()
    const weekly = summary()
    return {
      version: STATE_VERSION,
      risk: {
        ...state.risk,
        phrase: RISK_CONFIRM_PHRASE,
        disclosures: RISK_DISCLOSURES,
        remainingConfirmations: state.risk.enabled
          ? 0
          : Math.max(0, 2 - state.risk.confirmations)
      },
      weekly,
      weeklyText: describeWeek(weekly),
      nextResetAt: nextWeeklyResetAt(now()),
      tasks: GAME_ASSISTANT_TASKS,
      executors: detectExecutors(),
      rank: state.rank
    }
  }

  /** 连续两次确认；每次调用只前进一步。 */
  async function confirm(input) {
    await load()
    const result = confirmRisk(state.risk, input ?? {}, now())
    if (result.ok) {
      state.risk = result.state
      await persist()
    }
    return {
      ok: result.ok,
      stage: result.stage,
      message: result.message,
      risk: {
        ...state.risk,
        remainingConfirmations: state.risk.enabled
          ? 0
          : Math.max(0, 2 - state.risk.confirmations)
      }
    }
  }

  async function disable() {
    await load()
    state.risk = disableRisk(state.risk, now())
    await persist()
    return { ok: true, risk: state.risk }
  }

  /** 只接受人工记录：桌宠不会替用户编造一次通关。 */
  async function recordRun(input) {
    await load()
    const normalized = normalizeWeeklyEntry(input, now())
    if (!normalized.ok) {
      return { ok: false, error: normalized.error }
    }
    const entry = normalized.entry
    if (state.weekly.some((item) => item.id === entry.id)) {
      return { ok: false, error: `记录 ${entry.id} 已存在` }
    }

    state.weekly.push(entry)
    if (state.weekly.length > MAX_WEEKLY_ENTRIES) {
      state.weekly = state.weekly.slice(-MAX_WEEKLY_ENTRIES)
    }
    await persist()

    const weekly = summary()
    return { ok: true, entry, weekly, weeklyText: describeWeek(weekly) }
  }

  async function claim(id) {
    await load()
    const index = state.weekly.findIndex((item) => item.id === id)
    if (index < 0) return { ok: false, error: '找不到这条记录' }

    const entry = state.weekly[index]
    if (entry.completed !== true) return { ok: false, error: '未完整通关，先核对积分' }
    if (entry.points <= 0) return { ok: false, error: '这条记录没有可领取的积分' }

    state.weekly[index] = { ...entry, claimed: true }
    await persist()

    const weekly = summary()
    return { ok: true, entry: state.weekly[index], weekly, weeklyText: describeWeek(weekly) }
  }

  async function setRank(input) {
    await load()
    const next = normalizeRank({ ...(input ?? {}), updatedAt: now() })
    state.rank = next
    await persist()
    return { ok: true, rank: next }
  }

  /**
   * 任务预览。风险门没开时直接拒绝，让「默认关闭」在行为上成立，
   * 而不是只在界面上灰掉。
   */
  async function plan(taskId) {
    await load()
    if (!state.risk.enabled) {
      return {
        ok: false,
        code: 'risk-gate-closed',
        message: '游戏助手默认关闭。完成两次风险确认后才能生成任务计划。'
      }
    }
    const task = findTask(taskId)
    if (task === null) return { ok: false, code: 'unknown-task', message: '没有这个任务' }
    return { ok: true, task, plan: planTask(taskId) }
  }

  return {
    load,
    status,
    confirm,
    disable,
    recordRun,
    claim,
    setRank,
    plan
  }
}
