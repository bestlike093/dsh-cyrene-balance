/**
 * 身体状态的落盘适配层。
 *
 * 状态怎么走已经收在 `body-state.mjs` 的 `BodyRuntime` 里，这一层只负责：
 *   1. 读 `body.json`，旧文件缺字段就补；
 *   2. 读回后把离线那段时间补算掉；
 *   3. 变更后防抖落盘，退出前 flush。
 *
 * 文件路径由调用方注入，核心包不读任何全局路径，也不碰 Electron。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  BodyRuntime,
  DEFAULT_SLEEP_WINDOW,
  advance,
  readState
} from './body-state.mjs'

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
  getTraits = () => null,
  now = Date.now,
  log = () => {},
  fs: io = fs
} = {}) {
  const drainOf = () => {
    const value = Number(getTraits()?.energyDrainPerHour)
    return Number.isFinite(value) ? value : 4
  }
  const runtime = new BodyRuntime({ now, getSleepWindow, getEnergyDrain: drainOf })
  let loaded = false
  let loading = null
  let saveTimer = null
  /** 读取失败且坏文件无法隔离时置真：禁止写盘，绝不覆盖证据。 */
  let writesBlocked = false

  async function ready() {
    if (loaded) return runtime.toJSON()
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (file !== null) {
          const parsed = JSON.parse(await io.readFile(file, 'utf8'))
          const state = readState(parsed, now())
          // 关机期间时间照走：读盘后立刻把这段补算掉，但不当作「刚醒」。
          runtime.replace(
            advance(state, state.updatedAt, now(), {
              sleepWindow: getSleepWindow(),
              energyDrainPerHour: drainOf(),
            })
          )
        }
      } catch (error) {
        if (error?.code === 'ENOENT') {
          // 第一次运行：没有文件是正常状态。
        } else {
          log('身体状态读取失败，从默认值开始', error)
          // 读坏的文件先隔离改名：既保留证据，也避免防抖写盘用默认值覆盖它。
          if (typeof io.rename === 'function') {
            try {
              await io.rename(file, `${file}.corrupt-${now()}`)
              log('损坏的身体状态文件已隔离，下次写入另起新文件')
            } catch (moveError) {
              writesBlocked = true
              log('损坏文件无法改名，已禁止写入以避免覆盖证据', moveError)
            }
          } else {
            writesBlocked = true
            log('文件系统不支持改名，已禁止写入以避免覆盖证据')
          }
        }
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
    if (file === null || writesBlocked || saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }

  async function persist() {
    if (file === null || writesBlocked) return
    try {
      await io.mkdir(path.dirname(file), { recursive: true })
      // 临时文件 + rename：写一半崩溃只会留下半截 .tmp，不会毁掉正本。
      const temp = `${file}.tmp`
      await io.writeFile(temp, JSON.stringify(runtime.toJSON()), 'utf8')
      await io.rename(temp, file)
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

  /** 恢复备份后重新读盘，避免内存里还是旧身体。 */
  async function reload() {
    if (file === null) return runtime.toJSON()
    try {
      const parsed = JSON.parse(await io.readFile(file, 'utf8'))
      const state = readState(parsed, now())
      runtime.replace(
        advance(state, state.updatedAt, now(), { sleepWindow: getSleepWindow() })
      )
      loaded = true
    } catch (error) {
      if (error?.code !== 'ENOENT') log('身体状态重载失败，保留当前状态', error)
    }
    return runtime.toJSON()
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
    reload,
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
