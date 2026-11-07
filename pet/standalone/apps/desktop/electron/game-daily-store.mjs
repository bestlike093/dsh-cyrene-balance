/**
 * 多游戏日常的宿主服务：读写 state.json、生成计划任务、回读运行记录。
 *
 * 这里只做“把状态搬来搬去”和“调用 scheduler”，不判断日常做没做完。
 * 完成度只看 runner 写出的 report.json。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  GAME_IDS,
  describeDailyState,
  normalizeDailyState,
  summarizeDailyState,
  updateGameConfig
} from '@pet/core/browser'
import { createDailyScheduler } from './game-daily-scheduler.mjs'

const RUNS_DIR = 'runs'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createGameDailyStore(options = {}) {
  const stateDir = options.stateDir
  if (typeof stateDir !== 'string' || stateDir === '') {
    throw new TypeError('createGameDailyStore 需要 stateDir')
  }

  const scheduler = createDailyScheduler({
    stateDir,
    runnerPath: options.runnerPath,
    projectRoot: options.projectRoot,
    nodeProgram: options.nodeProgram
  })

  const statePath = path.join(stateDir, 'state.json')
  const runsRoot = path.join(stateDir, RUNS_DIR)

  async function load() {
    let raw
    try {
      raw = await fs.readFile(statePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { state: normalizeDailyState(null), error: null }
      return { state: normalizeDailyState(null), error: error?.message ?? String(error) }
    }

    try {
      const parsed = JSON.parse(raw)
      return { state: normalizeDailyState(parsed), error: null }
    } catch (error) {
      return { state: normalizeDailyState(null), error: `state.json 不是合法 JSON：${error?.message ?? error}` }
    }
  }

  async function persist(state) {
    await fs.mkdir(stateDir, { recursive: true })
    const temp = `${statePath}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await fs.rename(temp, statePath)
  }

  function view(state) {
    return {
      state,
      summary: summarizeDailyState(state),
      description: describeDailyState(state),
      gameIds: GAME_IDS
    }
  }

  /**
   * 更新一个游戏。校验不过时原样返回旧 state，让界面只标红不吞输入。
   * `patch.gamePath` 传空字符串表示清空。
   */
  async function update(input) {
    if (!isRecord(input) || typeof input.game !== 'string' || !GAME_IDS.includes(input.game)) {
      return { ok: false, error: 'game 不在支持列表里', ...view((await load()).state) }
    }

    const { state } = await load()
    const patch = isRecord(input.patch) ? input.patch : {}
    const result = updateGameConfig(state, input.game, patch, Date.now())
    if (!result.ok) {
      return { ok: false, issues: result.issues, ...view(result.state) }
    }

    await persist(result.state)
    return { ok: true, issues: [], ...view(result.state) }
  }

  /** 生成计划（不落盘、不注册），供设置页预览或排查。 */
  async function plan() {
    const { state } = await load()
    const built = scheduler.plan(state)
    if (!built.ok) return { ok: false, code: built.code, message: built.message, ...view(state) }

    return {
      ok: true,
      ...view(state),
      nodeProgram: built.nodeProgram,
      items: built.items.map((item) => ({
        game: item.game,
        taskName: item.taskName,
        program: item.action.program,
        arguments: item.action.arguments,
        workingDirectory: item.action.workingDirectory,
        scriptPath: item.scriptPath,
        executionLimitMinutes: item.spec.executionLimitMinutes
      }))
    }
  }

  /** 注册所有已开启游戏的计划任务。是否需要提权由返回的 needsElevation 告诉界面。 */
  async function apply() {
    const { state } = await load()
    const result = await scheduler.apply(state)
    return { ...result, ...view(state) }
  }

  async function query() {
    const result = await scheduler.query()
    return result
  }

  /** 关闭指定游戏的计划任务；不传则清掉四个。 */
  async function disable(games) {
    const target = Array.isArray(games) && games.length > 0 ? games : [...GAME_IDS]
    const result = await scheduler.disable(target)
    return result
  }

  /** 最近几次运行。只读 meta.json，缺失或损坏的记录直接跳过。 */
  async function runs(game, limit = 5) {
    if (!GAME_IDS.includes(game)) return { ok: false, error: 'game 不在支持列表里', runs: [] }
    const dir = path.join(runsRoot, game)

    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: true, runs: [] }
      return { ok: false, error: error?.message ?? String(error), runs: [] }
    }

    const names = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .slice(0, Math.max(1, limit))

    const items = []
    for (const name of names) {
      try {
        const raw = await fs.readFile(path.join(dir, name, 'meta.json'), 'utf8')
        const meta = JSON.parse(raw)
        if (isRecord(meta)) items.push(meta)
      } catch {
        // 跑到一半被杀掉时没有 meta.json，不把它当成一条记录。
      }
    }
    return { ok: true, runs: items }
  }

  return { load, update, plan, apply, query, disable, runs, stateDir }
}
