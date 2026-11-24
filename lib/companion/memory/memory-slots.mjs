/**
 * 记忆 13 槽单一声明表。
 *
 * 启用 7（identity / preference / knowledge / project / promise / event / lesson）
 * 备用 6（relationship / habit / emotion / boundary / goal / ritual）
 *
 * 消费方：
 * - memory-facts（DSH 与桌宠两套副本）：KINDS 由此派生，旧 kind 由此迁移；
 * - inner-state（两端）：抽取提示词与白名单由此派生；
 * - 记忆台 / 设置页「她的记忆」：按此表展示槽位开关与说明。
 *
 * 约定：
 * - 槽 id 全仓唯一，启用槽才能落盘；备用槽预注册不启用；
 * - 旧 6 类数据迁移映射唯一实现在这里（person → identity，其余同名）；
 * - weight 只给启用槽用，召回排序时的分类权重；备用槽填 0。
 */

/** @type {{id:string,name:string,description:string,weight:number,enabled:boolean,reserved:boolean}[]} */
export const MEMORY_SLOTS = [
  {
    id: 'identity',
    name: '她是谁',
    description: '主人的身份、背景，以及你们之间的关系事实。',
    weight: 0.4,
    enabled: true,
    reserved: false
  },
  {
    id: 'preference',
    name: '你的偏好',
    description: '喜欢什么、讨厌什么、习惯怎么选。',
    weight: 0.3,
    enabled: true,
    reserved: false
  },
  {
    id: 'knowledge',
    name: '学到的知识',
    description: '对方教给你的、或你自己学到的、以后还用得上的知识。',
    weight: 0.4,
    enabled: true,
    reserved: false
  },
  {
    id: 'project',
    name: '正在做的事',
    description: '主人的项目、工作与进展，改口时由新事实归档旧说法。',
    weight: 0.5,
    enabled: true,
    reserved: false
  },
  {
    id: 'promise',
    name: '说好的事',
    description: '约定、承诺、答应过的安排。',
    weight: 0.6,
    enabled: true,
    reserved: false
  },
  {
    id: 'event',
    name: '一起经历的事',
    description: '发生过的、值得记住的事件与场合。',
    weight: 0.35,
    enabled: true,
    reserved: false
  },
  {
    id: 'lesson',
    name: '纠正过的事',
    description: '被对方纠正过、不该再犯的教训。',
    weight: 0.8,
    enabled: true,
    reserved: false
  },
  {
    id: 'relationship',
    name: '关系',
    description: '与某个人之间的关系脉络。',
    weight: 0,
    enabled: false,
    reserved: true
  },
  {
    id: 'habit',
    name: '习惯',
    description: '作息与行为习惯。',
    weight: 0,
    enabled: false,
    reserved: true
  },
  {
    id: 'emotion',
    name: '情绪',
    description: '情绪状态与变化。',
    weight: 0,
    enabled: false,
    reserved: true
  },
  {
    id: 'boundary',
    name: '边界',
    description: '不能碰的话题与红线。',
    weight: 0,
    enabled: false,
    reserved: true
  },
  {
    id: 'goal',
    name: '目标',
    description: '长期目标与心愿。',
    weight: 0,
    enabled: false,
    reserved: true
  },
  {
    id: 'ritual',
    name: '纪念与仪式',
    description: '纪念日与小仪式。',
    weight: 0,
    enabled: false,
    reserved: true
  }
]

/** @type {Record<string, {id:string,name:string,description:string,weight:number,enabled:boolean,reserved:boolean}>} */
export const SLOT_BY_ID = Object.fromEntries(MEMORY_SLOTS.map((slot) => [slot.id, slot]))

export const ENABLED_SLOTS = MEMORY_SLOTS.filter((slot) => slot.enabled)
export const RESERVED_SLOTS = MEMORY_SLOTS.filter((slot) => slot.reserved)
export const ENABLED_SLOT_IDS = ENABLED_SLOTS.map((slot) => slot.id)
export const ALL_SLOT_IDS = MEMORY_SLOTS.map((slot) => slot.id)

/* 旧键 → 13 槽的迁移映射：facts 的 person 并入 identity，记忆条目的 relation 并入 relationship。 */
export const LEGACY_KIND_MAP = { person: 'identity', relation: 'relationship' }

/** 只做旧键迁移，不回落：person → identity，其余原样返回。导入/校验用。 */
export function migrateSlotId(kind) {
  const value = typeof kind === 'string' ? kind.trim() : ''
  return LEGACY_KIND_MAP[value] ?? value
}

/**
 * 把任意来源的 kind 收口成合法槽 id：
 * - 旧键走 LEGACY_KIND_MAP 迁移；
 * - 13 槽内的启用槽原样通过；
 * - 其余一律回落到 preference（与旧行为一致：宁丢分类也不丢内容）。
 */
export function normalizeSlotId(kind) {
  const migrated = migrateSlotId(kind)
  const slot = SLOT_BY_ID[migrated]
  if (slot !== undefined && slot.enabled) return slot.id
  return 'preference'
}

/** 槽中文名：旧键先迁移，未知槽回落「还记得」。 */
export function slotLabel(kind) {
  return SLOT_BY_ID[migrateSlotId(kind)]?.name ?? '还记得'
}

/** 槽排序权重：旧键先迁移，未知槽按 0.3。 */
export function slotWeight(kind) {
  return SLOT_BY_ID[migrateSlotId(kind)]?.weight ?? 0.3
}

/** 导入/校验用：kind（旧键先迁移）是不是可落盘的启用槽。 */
export function isEnabledSlot(kind) {
  const slot = SLOT_BY_ID[migrateSlotId(kind)]
  return slot !== undefined && slot.enabled
}


/**
 * 唯一权威源归一：state.memorySlots（逐槽布尔自定义）叠在声明表默认上。
 * 陪伴面板（lib/index.js activeMemorySlotIds）与观察抽屉（insight.mjs 经 live.json
 * 的 memorySlotIds 注入）都从本函数产物派生 enabled，不许长出第二份归一逻辑
 * （check-memory-slot-source.mjs G4 盯着）。
 * 规则与 lib/index.js 历史实现一致：键在取 custom===true，键不在取声明表默认。
 */
export function effectiveSlotIds(custom) {
  const map = custom !== null && typeof custom === 'object' ? custom : {}
  return MEMORY_SLOTS.filter((slot) => (slot.id in map ? map[slot.id] === true : slot.enabled)).map((slot) => slot.id)
}