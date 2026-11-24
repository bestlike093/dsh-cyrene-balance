/**
 * dsh-cyrene-pet — 双端设置映射表。
 *
 * 两端存储结构不同，不能整包互换：
 *   DSH  ：state.json，扁平点路径（nickname / ui / bubbleMode / speechEnabled …）
 *   桌宠 ：settings.json，深层结构（nickname / uiMode / bubble.mode / voice.enabled …）
 *
 * 这里只登记「语义确实相同」的字段，逐项转换。未登记的字段各端自理，
 * 宁可少同步几项，也不做猜测式映射。
 *
 * 密钥（apiKey / appSecret / syncToken）永远不进来。
 */

import { FIELDS as SCHEMA_FIELDS } from './settings-schema.mjs'

export const SYNC_VERSION = 1

/** schema 字段类型 → 同步表类型。 */
function syncTypeOf(field) {
  if (field.type === 'bool') return 'bool'
  if (field.type === 'seg') return 'enum'
  if (field.type === 'range' || field.type === 'number') return 'number'
  return 'string'
}

/**
 * 同步表从 settings-schema.mjs 的 petPath 派生：schema 是唯一权威，
 * 这里不再手工维护第二份表。桌宠端（pet/standalone electron 主进程）
 * 也必须 import 本文件，禁止再复制一份字段表。
 *
 * 每项形状保持旧约定：{ dsh, pet, type, values?, min?, max?, maxLength?, toPet?, toDsh? }
 * 值域、枚举与换算全部跟随 schema 声明，改字段只改 schema 一处。
 */
export const FIELDS = SCHEMA_FIELDS
  .filter((field) => typeof field.petPath === 'string' && field.petPath !== '')
  .map((field) => {
    const entry = { dsh: field.key, pet: field.petPath, type: syncTypeOf(field) }
    if (field.type === 'seg') {
      entry.values = (field.options ?? []).map(([value]) => value)
      if (Array.isArray(field.petValues) && field.petValues.length > 0) {
        const toPet = new Map(field.petValues)
        const toDsh = new Map(field.petValues.map(([dshValue, petValue]) => [petValue, dshValue]))
        entry.toPet = (value) => toPet.get(value) ?? field.petFallback ?? value
        entry.toDsh = (value) => toDsh.get(value) ?? field.default
        /* pet 侧原生值域（换算对的第二列）：pet→dsh 方向先按它收口，
           否则 OceanBlue 这类值会被 dsh 值域拦在校验处，换算永远走不到。 */
        entry.petValuesList = field.petValues.map(([, petValue]) => petValue)
      }
    }
    if (field.type === 'range' || field.type === 'number') {
      entry.min = field.min
      entry.max = field.max
    }
    if ((field.type === 'text' || field.type === 'area') && field.maxLength !== undefined) {
      entry.maxLength = field.maxLength
    }
    return entry
  })

/* ------------------------------ 路径工具 ------------------------------ */

export function readPath(source, path) {
  if (source === null || typeof source !== 'object') return undefined
  const parts = path.split('.')
  let cursor = source
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[part]
  }
  return cursor
}

export function writePath(target, path, value) {
  const parts = path.split('.')
  const last = parts.pop()
  let cursor = target
  for (const part of parts) {
    if (cursor[part] === null || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part]
  }
  cursor[last] = value
  return target
}

/* ------------------------------ 值规范化 ------------------------------ */

function clamp(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  if (field.min !== undefined && n < field.min) return field.min
  if (field.max !== undefined && n > field.max) return field.max
  return n
}

/**
 * 把一个原始值按字段声明收敛成安全值；不合法返回 undefined，表示「这次跳过」。
 * list 可选：enum 校验用的值域。两端枚举值不同（petValues）时必须按方向传入，
 * dsh 值传 field.values（dsh 值域），pet 值传 field.petValuesList（pet 值域）。
 */
export function normalizeValue(field, raw, list) {
  if (raw === undefined || raw === null) return undefined
  if (field.type === 'bool') return raw === true || raw === 'true'
  if (field.type === 'number') return clamp(raw, field)
  if (field.type === 'enum') {
    const accepted = Array.isArray(list) && list.length > 0 ? list : field.values ?? []
    return accepted.includes(raw) ? raw : undefined
  }
  const text = String(raw).slice(0, field.maxLength ?? 400)
  return text
}

/* ------------------------------ 双向读取 ------------------------------ */

/**
 * 从 DSH state 抽出可同步的字段，转成「桌宠路径 → 值」。
 * 返回 plain patch，调用方负责合并与持久化。
 */
export function dshToPetPatch(state) {
  const patch = {}
  for (const field of FIELDS) {
    const raw = readPath(state, field.dsh)
    const value = normalizeValue(field, raw, field.values)
    if (value === undefined) continue
    const converted = field.toPet ? field.toPet(value) : value
    if (converted === undefined) continue
    writePath(patch, field.pet, converted)
  }
  return patch
}

/**
 * 从桌宠 settings 抽出可同步的字段，转成「DSH 路径 → 值」。
 */
export function petToDshPatch(settings) {
  const patch = {}
  for (const field of FIELDS) {
    const raw = readPath(settings, field.pet)
    const value = normalizeValue(field, raw, field.petValuesList ?? field.values)
    if (value === undefined) continue
    const converted = field.toDsh ? field.toDsh(value) : value
    if (converted === undefined) continue
    writePath(patch, field.dsh, converted)
  }
  return patch
}

/* ------------------------------ 差异比较 ------------------------------ */

export function sameValue(a, b) {
  if (typeof a === 'object' && a !== null) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

/**
 * 比较两端同一字段，返回需要执行的动作。
 * 结果形如 { dsh: ['nickname'], pet: [] } —— 列出各自需要写入的路径。
 *
 * 语义：
 *   - 只有一边存在 → 写成另一边。
 *   - 两边都存在且不同 → 由调用方按时间戳判定谁更新；这里只报「不同」。
 */
export function compareSides(dshState, petSettings) {
  const differences = []
  for (const field of FIELDS) {
    const dshValue = readPath(dshState, field.dsh)
    const petValue = readPath(petSettings, field.pet)
    if (dshValue === undefined && petValue === undefined) continue
    if (dshValue === undefined) {
      differences.push({ field, winner: 'pet' })
      continue
    }
    if (petValue === undefined) {
      differences.push({ field, winner: 'dsh' })
      continue
    }
    const normalizedDsh = field.toPet
      ? field.toPet(normalizeValue(field, dshValue, field.values))
      : normalizeValue(field, dshValue, field.values)
    const normalizedPet = normalizeValue(field, petValue, field.petValuesList ?? field.values)
    /* 归一后某侧没有有效值：等于该侧不存在，由另一侧赢；
       两侧都无效就跳过；都有有效值且不同才报「不同」。 */
    if (normalizedDsh === undefined && normalizedPet === undefined) continue
    if (normalizedDsh === undefined) {
      differences.push({ field, winner: 'pet' })
      continue
    }
    if (normalizedPet === undefined) {
      differences.push({ field, winner: 'dsh' })
      continue
    }
    if (!sameValue(normalizedDsh, normalizedPet)) {
      differences.push({ field, winner: null })
    }
  }
  return differences
}
