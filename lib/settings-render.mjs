/**
 * dsh-cyrene-pet — 设置页渲染引擎（Settings render）。
 *
 * schema 驱动的纯逻辑层：把 settings-schema.mjs 的字段声明换算成
 * 控件规格、值收敛、patch 构造与可见性判定。不碰 DOM——
 * client.js 的适配层把本模块的返回转成实际控件。
 *
 * 单一事实源：FIELDS/GROUPS 在 settings-schema.mjs 一份声明，
 * 这里只做「schema → 控件」的换算，不重复登记任何字段。
 */

import { GROUPS, FIELDS } from './settings-schema.mjs'

/** 支持的全部控件 kind，与 schema 的 type 一一对应 */
const TYPE_TO_KIND = {
  bool: 'toggle',
  text: 'text',
  area: 'textarea',
  seg: 'select',
  range: 'range',
  number: 'number',
}

/**
 * 控件规格：schema 条目 → 渲染层需要的全部信息。
 * 不含当前值——值由页面从 state 读，规格只管形态。
 *
 * @param {object} field settings-schema FIELDS 里的条目
 * @returns {object} { kind, key, label, hint, effect, danger, writeGroup, ...kind 专属字段 }
 */
export function controlSpec(field) {
  const kind = TYPE_TO_KIND[field.type]
  if (!kind) throw new Error(`settings-render: 未知字段类型 ${field.type}（key=${field.key}）`)
  const spec = {
    kind,
    key: field.key,
    label: field.label,
    hint: field.hint ?? '',
    effect: field.effect ?? 'live',
    danger: field.danger === true,
    writeGroup: Array.isArray(field.writeGroup) ? field.writeGroup : [],
    deps: Array.isArray(field.deps) ? field.deps : [],
  }
  if (kind === 'select') {
    spec.options = (field.options ?? []).map((pair) => ({ value: pair[0], label: pair[1] }))
  }
  if (kind === 'range' || kind === 'number') {
    spec.min = Number(field.min ?? 0)
    spec.max = Number(field.max ?? 100)
    spec.step = field.step === undefined ? null : Number(field.step)
  }
  if (kind === 'text' || kind === 'textarea') {
    spec.maxLength = field.maxLength === undefined ? null : Number(field.maxLength)
    spec.placeholder = field.placeholder ?? ''
  }
  return spec
}

/**
 * 值收敛：控件产出的原始值 → 允许落库的合法值。
 * 出界、类型不对、不在值域里的值全部回到 schema default，
 * 不让脏值经 patch 流进后端。
 *
 * @param {object} field schema 条目
 * @param {unknown} raw 控件给的值
 * @returns {unknown} 合法值（类型与 schema default 同形）
 */
export function coerceValue(field, raw) {
  const spec = controlSpec(field)
  switch (spec.kind) {
    case 'toggle':
      return raw === true
    case 'select': {
      const legal = spec.options.map((opt) => opt.value)
      return legal.includes(raw) ? raw : field.default
    }
    case 'range':
    case 'number': {
      const num = Number(raw)
      if (!Number.isFinite(num)) return field.default
      const clamped = Math.min(spec.max, Math.max(spec.min, num))
      if (spec.step !== null && spec.step > 0) {
        /* 对齐到离 min 最近的 step 刻度，再按 10 位小数收口浮点尾巴 */
        const ticks = Math.round((clamped - spec.min) / spec.step)
        return Number((spec.min + ticks * spec.step).toFixed(10))
      }
      return clamped
    }
    case 'text':
    case 'textarea': {
      let text = raw === null || raw === undefined ? '' : String(raw)
      if (spec.maxLength !== null && text.length > spec.maxLength) text = text.slice(0, spec.maxLength)
      return text
    }
    default:
      return field.default
  }
}

/**
 * patch 构造：单项改动要提交给后端的平铺对象。
 * writeGroup 不在这里展开——那需要页面侧的当前值，
 * 由调用方拿到本结果后自行补同组其它字段。
 *
 * @param {object} field schema 条目
 * @param {unknown} value 已收敛的值
 * @returns {object} { [field.key]: value }
 */
export function buildPatch(field, value) {
  return { [field.key]: value }
}

/**
 * 恢复默认：单项的 reset patch，默认值直接来自 schema。
 *
 * @param {object} field schema 条目
 * @returns {object} { [field.key]: field.default }
 */
export function resetPatch(field) {
  return { [field.key]: field.default }
}

/**
 * 可见性判定：deps 全部满足才显示。
 *  - deps 元素为 string：该 key 当前值为 true 才显示
 *  - deps 元素为 { key, equals }：该 key 当前值等于 equals 才显示
 *  - deps 为空数组：恒显示
 *
 * @param {object} field schema 条目
 * @param {object} values 当前设置值（平铺 key → 值）
 * @returns {boolean}
 */
export function depsVisible(field, values = {}) {
  const spec = controlSpec(field)
  return spec.deps.every((dep) => {
    if (typeof dep === 'string') return values[dep] === true
    return values[dep.key] === dep.equals
  })
}

/**
 * 板块分组：FIELDS 声明顺序 → [{ group, sections: [{ title, fields }] }]。
 * section 顺序按字段首次出现顺序，不进 FIELDS 的板块不出现在结果里。
 *
 * @param {Array<object>} fields 默认用 FIELDS
 * @returns {Array<object>}
 */
export function groupFields(fields = FIELDS) {
  const result = GROUPS.map((group) => ({ group, sections: [] }))
  const byGroup = new Map(result.map((entry) => [entry.group.id, entry]))
  for (const field of fields) {
    const entry = byGroup.get(field.group)
    if (!entry) continue
    let section = entry.sections.find((s) => s.title === field.section)
    if (!section) {
      section = { title: field.section, fields: [] }
      entry.sections.push(section)
    }
    section.fields.push(field)
  }
  return result.filter((entry) => entry.sections.length > 0)
}

/** 按 key 找字段；找不到返回 undefined（宁可少渲染，不瞎猜） */
export function fieldByKey(key, fields = FIELDS) {
  return fields.find((field) => field.key === key)
}

/** 恢复默认的 path 白名单（后端 /settings/reset 用它校验） */
export function resetableKeys(fields = FIELDS) {
  return fields.map((field) => field.key)
}
