/**
 * 游戏日常的宿主层：检测、配置、演练预览。
 *
 * 内测边界：只做「检测 + 排班 + dry-run 预览 + 风险说明」，不启动 BetterGI、
 * 不写计划任务、不注册真实执行器。渲染侧传 mode: 'real' 也会降级成 dry。
 *
 * 纯规则（校验、任务规格、下一次时间）都来自 @pet/core 的 game 模块；
 * 这一层只负责文件与进程边界的探测，方便测试时替换 exists / readFile / writeConfig。
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_TIMEOUT_MINUTES,
  GAME_IDS,
  KNOWN_DEPENDENCIES,
  candidateExecutables,
  nextRunAt,
  pickExisting,
  summarizeDependencies,
  toTaskSpec,
  validateConfig
} from '@pet/core/browser'

export const DEFAULT_GAME_DAILY_CONFIG = Object.freeze({
  game: 'genshin',
  enabled: false,
  time: '04:00',
  days: [],
  timeoutMinutes: DEFAULT_TIMEOUT_MINUTES.genshin,
  mode: 'dry',
  catchUp: false,
  reportSession: false
})

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function normalizeConfig(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const game = GAME_IDS.includes(source.game) ? source.game : DEFAULT_GAME_DAILY_CONFIG.game
  const timeout = Number.isInteger(source.timeoutMinutes)
    ? source.timeoutMinutes
    : DEFAULT_TIMEOUT_MINUTES[game]
  const days = Array.isArray(source.days)
    ? [...new Set(source.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : []

  const config = {
    game,
    enabled: source.enabled === true,
    time: typeof source.time === 'string' ? source.time : DEFAULT_GAME_DAILY_CONFIG.time,
    days,
    timeoutMinutes: timeout,
    // 内测版只有演练；真实执行器等单独一期。
    mode: 'dry',
    catchUp: source.catchUp === true,
    reportSession: source.reportSession === true
  }

  if (typeof source.gamePath === 'string' && source.gamePath.trim() !== '') {
    config.gamePath = source.gamePath.trim()
  }

  return config
}

function betterGiCandidates() {
  const local = process.env.LOCALAPPDATA
  const roaming = process.env.APPDATA
  return [
    process.env.BETTERGI_PATH,
    'C:\\Program Files\\BetterGI\\BetterGI.exe',
    'D:\\BetterGI\\BetterGI.exe',
    'E:\\BetterGI\\BetterGI.exe',
    local === undefined ? null : path.join(local, 'BetterGI', 'BetterGI.exe'),
    roaming === undefined ? null : path.join(roaming, 'BetterGI', 'BetterGI.exe')
  ].filter((candidate) => typeof candidate === 'string' && candidate.trim() !== '')
}

function formatDays(days) {
  if (days.length === 0) return '每天'
  return `周${days.map((day) => WEEKDAY_LABELS[day] ?? String(day)).join('、周')}`
}

function buildDependencies(config, detected) {
  const gamePath = config.gamePath ?? detected.games[config.game]?.path ?? null
  const items = [
    {
      ...KNOWN_DEPENDENCIES.bettergi,
      status: detected.bettergi.path === null ? 'missing' : 'ok',
      detail: detected.bettergi.path ?? '未找到 BetterGI.exe'
    },
    {
      ...KNOWN_DEPENDENCIES.gamePath,
      status: gamePath === null ? 'missing' : 'ok',
      detail: gamePath ?? '未找到游戏本体'
    },
    {
      ...KNOWN_DEPENDENCIES.dshCli,
      // 演练不启动真实执行，dsh 只作为将来执行器的提示，不参与本轮阻塞。
      required: false,
      status: 'unknown',
      detail: '内测版不启动真实执行，未检测 dsh'
    },
    {
      ...KNOWN_DEPENDENCIES.reportDir,
      required: false,
      status: 'ok',
      detail: '演练只预览，不写报告'
    }
  ]
  return summarizeDependencies(items)
}

export function createGameDailyService(options = {}) {
  const filePath = options.filePath
  if (typeof filePath !== 'string' || filePath === '') {
    throw new TypeError('createGameDailyService 需要 filePath')
  }

  const exists = typeof options.exists === 'function' ? options.exists : fs.existsSync
  const readFile =
    typeof options.readFile === 'function'
      ? options.readFile
      : (target) => fs.promises.readFile(target, 'utf8')
  const writeConfig =
    typeof options.writeConfig === 'function'
      ? options.writeConfig
      : (target, config) =>
          fs.promises.writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const drives = Array.isArray(options.drives) ? options.drives : ['C:', 'D:', 'E:']

  function detect() {
    const games = {}
    for (const game of GAME_IDS) {
      const candidates = candidateExecutables(game, { drives })
      games[game] = { path: pickExisting(candidates, exists), candidates }
    }

    const candidates = betterGiCandidates()
    return {
      bettergi: { path: pickExisting(candidates, exists), candidates },
      games
    }
  }

  async function load() {
    try {
      const raw = await readFile(filePath)
      const parsed = JSON.parse(raw)
      return { config: normalizeConfig(parsed), error: null }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { config: normalizeConfig(null), error: null }
      }
      return { config: normalizeConfig(null), error: error?.code ?? 'read-failed' }
    }
  }

  async function save(input) {
    const config = normalizeConfig(input)
    const issues = validateConfig(config)
    if (issues.length > 0) return { ok: false, issues }

    try {
      await writeConfig(filePath, config)
      return { ok: true, config }
    } catch (error) {
      return {
        ok: false,
        issues: [{ field: 'file', message: `配置写不进去：${error?.code ?? 'write-failed'}` }]
      }
    }
  }

  function dryRun(input) {
    const config = normalizeConfig(input)
    const issues = validateConfig(config)
    if (issues.length > 0) return { ok: false, issues }

    const detected = detect()
    const spec = toTaskSpec(config)
    const at = nextRunAt(config, now())

    return {
      ok: true,
      config,
      spec,
      nextRunAt: at,
      nextRunLabel: at === null ? '无' : new Date(at).toLocaleString('zh-CN', { hour12: false }),
      dependencies: buildDependencies(config, detected),
      preview: `${spec.name} · ${formatDays(spec.days)} ${spec.time} · 上限 ${spec.executionLimitMinutes} 分钟 · 演练`,
      risk: '演练只生成预览，不会启动游戏或 BetterGI；真实执行本轮不开放。'
    }
  }

  return { load, save, detect, dryRun }
}
