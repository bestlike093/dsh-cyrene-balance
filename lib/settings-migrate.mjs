/**
 * dsh-cyrene-pet — 设置迁移层（settings migrate）。
 *
 * 职责：老配置读入时的一次性迁移，全部规则表驱动，纯函数、无副作用。
 *  1. 旧开关语义转换（askEnabled/idlePose/soundEnabled 拆开的老开关合并进数值键）；
 *  2. 清废弃键（REMOVED_KEYS，A4 裁决的死字段也追加到这里）；
 *  3. 递归补缺（saved 里 undefined 的键用 defaults 填；null 是合法值，原样保留）；
 *  4. 打版本戳（schemaVersion = SCHEMA_VERSION）。
 *
 * 调用方：lib/index.js ensureLoaded（读入 pet-plugin-state.json 后）。
 * 不变式：migrateSettings 幂等——同一份结果再跑一次 changed 必须是 false。
 */

import { SCHEMA_VERSION } from './settings-schema.mjs'

/** 与 schema 版本同步的 settings 版本戳。 */
export const SETTINGS_VERSION = SCHEMA_VERSION

/**
 * 废弃键：旧版 state.json 里拆开或过时的键，读入时删除。
 * 支持点路径（如 'game.pollSeconds'），只删叶子键、不动父对象。
 * A4 裁决：renderer（渲染层按 live2dModelId 自动切换，此键无消费者）；
 * game.pollSeconds（两端都无消费，桌宠端固定 3 秒轮询本地 JSON）。
 * 桌宠侧死字段 voice.cloud / 顶层 renderMode 由桌宠端自己的默认表收敛，不在本表。
 */
export const REMOVED_KEYS = ['askEnabled', 'idlePose', 'soundEnabled', 'avatar', 'x', 'y', 'renderer', 'game.pollSeconds']

function clone(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(clone)
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = clone(item)
  return out
}

/**
 * 递归补缺：saved 优先，只有 undefined 才用 defaults 填。
 * null 是合法值（boundSessionId / intimacy.gate 等），不算缺。
 * saved 里 defaults 没有的键原样保留，不清理（清理是 REMOVED_KEYS 的事）。
 * 返回 { value, filled }，filled > 0 表示确实补了键。
 */
export function fillMissing(saved, defaults) {
  if (saved === undefined) return { value: clone(defaults), filled: 1 }
  if (defaults === undefined) return { value: saved, filled: 0 }
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return { value: saved, filled: 0 }
  if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) return { value: saved, filled: 0 }
  const out = { ...saved }
  let filled = 0
  for (const key of Object.keys(defaults)) {
    const had = out[key] !== undefined
    const result = fillMissing(out[key], defaults[key])
    if (!had) filled += 1
    else filled += result.filled
    if (!had || result.filled > 0) out[key] = result.value
  }
  return { value: out, filled }
}

/**
 * 一次性迁移入口。输入老配置对象，输出迁移后的配置与是否发生变化。
 * 幂等：对输出再跑一次，changed 必为 false。
 */
export function migrateSettings(saved, defaults) {
  const input = saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  const next = { ...input }
  let changed = false
  const mark = () => {
    changed = true
  }

  /* 旧开关语义转换：老 state 用 false 表示「关」，合并进数值键的 0。 */
  if (next.askEnabled === false && next.askEveryMinutes === undefined) {
    next.askEveryMinutes = 0
    mark()
  }
  if (next.idlePose === false && next.poseSeconds === undefined) {
    next.poseSeconds = 0
    mark()
  }
  if (next.soundEnabled === false && next.soundVolume === undefined) {
    next.soundVolume = 0
    mark()
  }
  /* 旧 state 没有向导标记 = 已经用过一阵子的人，不再弹首次卡片。 */
  if (typeof next.onboarded !== 'boolean') {
    next.onboarded = true
    mark()
  }

  /* 清废弃键；支持点路径，逐段下钻到叶子再删。 */
  for (const key of REMOVED_KEYS) {
    const segments = key.split('.')
    let target = next
    let reachable = true
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]
      if (target === null || typeof target !== 'object' || !Object.prototype.hasOwnProperty.call(target, segment)) {
        reachable = false
        break
      }
      target = target[segment]
    }
    const leaf = segments[segments.length - 1]
    if (reachable && target !== null && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, leaf)) {
      delete target[leaf]
      mark()
    }
  }

  /* 补缺：只补 undefined，null 与现有值一律不动。 */
  const filled = fillMissing(next, defaults ?? {})
  if (filled.filled > 0) mark()

  /* 版本戳：老配置没有它，或版本落后，都算一次迁移。 */
  const settings = filled.value
  if (settings.schemaVersion !== SETTINGS_VERSION) mark()
  settings.schemaVersion = SETTINGS_VERSION

  return { settings, changed }
}
