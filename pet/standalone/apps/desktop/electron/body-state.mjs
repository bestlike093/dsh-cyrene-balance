/**
 * 身体状态（桌面端适配层）。
 *
 * 状态怎么走已经收在 `@pet/core/browser` 的 `BodyRuntime` 里，
 * 这一层只负责三件事：
 *   1. 读 `body.json`，旧文件缺字段就补；
 *   2. 读回后把离线那段时间补算掉；
 *   3. 变更后防抖落盘，退出前 flush。
 *
 * 这样桌面端、QQ 和内置模块读到的是同一套身体，不再各写一份阈值。
 */
import fs from 'node:fs/promises'

import {
  BodyRuntime,
  DEFAULT_SLEEP_WINDOW,
  advance,
  bodyFlags,
  cyclePhase,
  describeBody,
  freshState,
  inSleepWindow,
  readState,
  toMinute
} from '@pet/core/browser'

// 保持原有的导入面：调用方与测试继续从 `./body-state.mjs` 取这些名字。
export {
  DEFAULT_SLEEP_WINDOW,
  advance,
  bodyFlags,
  cyclePhase,
  describeBody,
  freshState,
  inSleepWindow,
  readState,
  toMinute
}

const SAVE_DEBOUNCE_MS = 1_000

/**
 * @param {object} options
 * @param {string|null} [options.file]
 * @param {() => {start: string, end: string}} [options.getSleepWindow]
 * @param {() => number} [options.now]
 * @param {(message: string, error?: unknown) => void} [options.log]
 */
export function createBodyService({
  file = null,
  getSleepWindow = () => DEFAULT_SLEEP_WINDOW,
  now = Date.now,
  log = () => {}
} = {}) {
  const runtime = new BodyRuntime({ now, getSleepWindow })
  let loaded = false
  let loading = null
  let saveTimer = null

  async function ready() {
    if (loaded) return runtime.toJSON()
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (file !== null) {
          const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
          const state = readState(parsed, now())
          // 关机期间时间照走：读盘后立刻把这段补算掉，但不当作「刚醒」。
          runtime.replace(
            advance(state, state.updatedAt, now(), { sleepWindow: getSleepWindow() })
          )
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') log('身体状态读取失败，从默认值开始', error)
      } finally {
        loaded = true
        loading = null
      }
      scheduleSave()
      return runtime.toJSON()
    })()
    return loading
  }

  function scheduleSave() {
    if (file === null || saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }

  async function persist() {
    if (file === null) return
    try {
      await fs.mkdir(file.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
      await fs.writeFile(file, JSON.stringify(runtime.toJSON()), 'utf8')
    } catch (error) {
      log('身体状态写入失败', error)
    }
  }

  async function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await persist()
  }

  /** 推进到此刻；内部幂等。 */
  async function tick(at = now()) {
    await ready()
    const snapshot = runtime.tick(at)
    scheduleSave()
    return snapshot
  }

  /** 睡着时收到消息：记一笔，醒来会知道自己被打断过。 */
  async function markInterrupted(at = now()) {
    await ready()
    const count = runtime.markInterrupted(at)
    scheduleSave()
    return count
  }

  async function eat(amount = 55, at = now()) {
    await ready()
    const snapshot = runtime.eat(amount, at)
    scheduleSave()
    return snapshot
  }

  /** 一次对话的社交消耗；冷却期内不重复扣。 */
  async function noteChat(cost = 2, at = now()) {
    await ready()
    const snapshot = runtime.noteChat(cost, at)
    scheduleSave()
    return snapshot
  }

  /** 醒来：结算梦，重置清醒起点，被打断过就留一句。 */
  async function wake(at = now()) {
    await ready()
    const result = runtime.wake(at)
    scheduleSave()
    return result
  }

  function snapshot() {
    return runtime.snapshot()
  }

  function describe() {
    return runtime.describe()
  }

  function stats() {
    return runtime.stats()
  }

  return {
    ready,
    tick,
    snapshot,
    describe,
    stats,
    eat,
    noteChat,
    markInterrupted,
    wake,
    flush
  }
}
