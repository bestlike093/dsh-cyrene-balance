/**
 * 来源规范词表（三维正交，唯一真源）。
 *
 * 历史上有三套 scope 词表并存（旧总账 SYS-007，S1），根因是三个正交维度
 * 被挤进同一个字符串：通道、归属、会话形态。任何一个新通道进来都要重排词表，
 * 分类器也因此没有拒收权 —— 写什么值都算合法。
 *
 * 2026-11-16 维护者裁定拆成三列独立字段，禁止点分串（'dsh.owner.private'）：
 * 一拼成串，party × surface 的聚合就会退化成字符串前缀匹配。
 * 记忆条目额外带一个 legacyScope 只读列，删除日期见 LEGACY_RETIRE_BY。
 */

export const CHANNELS = Object.freeze(['dsh', 'qq', 'bilibili', 'mail', 'local', 'system'])
export const PARTIES = Object.freeze(['owner', 'known', 'stranger'])
export const SURFACES = Object.freeze(['private', 'group', 'session', 'desktop'])

/** legacyScope 只读列的删除期限：过期后读取端仍兼容，写入端一律拒绝。 */
export const LEGACY_RETIRE_BY = '2026-12-15'

/**
 * 合法组合。三列全展开是 6×3×4 = 72，绝大多数没有真实语义
 * （例如「B 站 × 主人 × 桌面」），列出来的才是世界真实存在的形态。
 * 未列出的组合由 assertScopeTuple 拒收并上报，这就是分类器一直缺的拒收权。
 */
export const VALID_TUPLES = Object.freeze([
  // DSH 宿主：本机主人对话，没有群概念
  { channel: 'dsh', party: 'owner', surface: 'private', note: 'DSH 主会话' },
  { channel: 'dsh', party: 'owner', surface: 'desktop', note: 'DSH 里触发的桌面动作' },
  // QQ：主人私聊、主人所在群、他人私聊与群成员
  { channel: 'qq', party: 'owner', surface: 'private', note: '主人 QQ 私聊' },
  { channel: 'qq', party: 'owner', surface: 'group', note: '主人在群里 @ 她' },
  { channel: 'qq', party: 'known', surface: 'private', note: '熟人私聊' },
  { channel: 'qq', party: 'known', surface: 'group', note: '熟人在群里说话' },
  { channel: 'qq', party: 'stranger', surface: 'private', note: '陌生人私聊' },
  { channel: 'qq', party: 'stranger', surface: 'group', note: '群成员（未建档）' },
  // B 站：私信与公开评论，来者都不是主人本人语境
  { channel: 'bilibili', party: 'known', surface: 'private', note: 'B 站私信（已建档）' },
  { channel: 'bilibili', party: 'stranger', surface: 'private', note: 'B 站私信（首次）' },
  { channel: 'bilibili', party: 'stranger', surface: 'group', note: 'B 站公开评论 / 弹幕' },
  // 邮件：只服务主人
  { channel: 'mail', party: 'owner', surface: 'private', note: '代拟 / 代收邮件' },
  // 本机：桌宠自身的桌面语境与定时会话
  { channel: 'local', party: 'owner', surface: 'desktop', note: '桌面本机交互' },
  { channel: 'local', party: 'owner', surface: 'session', note: '本机会话监听' },
  // 系统：定时器、自检、余额轮询等无人格对话的来路
  { channel: 'system', party: 'owner', surface: 'session', note: '定时与自检事件' },
  { channel: 'system', party: 'owner', surface: 'desktop', note: '系统级桌面提示' },
])

const TUPLE_KEYS = new Set(VALID_TUPLES.map((t) => `${t.channel}|${t.party}|${t.surface}`))

export const CHANNEL_SET = new Set(CHANNELS)
export const PARTY_SET = new Set(PARTIES)
export const SURFACE_SET = new Set(SURFACES)

/** 这条三元组是不是已登记的世界形态。 */
export function isValidTuple(tuple) {
  if (!isTupleShape(tuple)) return false
  return TUPLE_KEYS.has(`${tuple.channel}|${tuple.party}|${tuple.surface}`)
}

function isTupleShape(tuple) {
  return Boolean(
    tuple &&
      typeof tuple === 'object' &&
      CHANNEL_SET.has(tuple.channel) &&
      PARTY_SET.has(tuple.party) &&
      SURFACE_SET.has(tuple.surface)
  )
}

/**
 * 落库前的闸门。拒收时给出缺哪一列或哪个组合未登记，
 * 调用方必须把这条上报（候选箱 / 日志），不许静默降级 —— 旧总账里
 * 「knowledge 静默降级、越学越脏」就是这么来的。
 *
 * @returns {{ok:true, tuple:object}|{ok:false, reason:string, missing:string[]}}
 */
export function assertScopeTuple(tuple) {
  const missing = []
  if (!CHANNEL_SET.has(tuple?.channel)) missing.push('channel')
  if (!PARTY_SET.has(tuple?.party)) missing.push('party')
  if (!SURFACES.includes(tuple?.surface)) missing.push('surface')
  if (missing.length > 0) {
    return { ok: false, reason: `三维缺列：${missing.join('/')}`, missing }
  }
  if (!TUPLE_KEYS.has(`${tuple.channel}|${tuple.party}|${tuple.surface}`)) {
    return {
      ok: false,
      reason: `未登记的组合：${tuple.channel}/${tuple.party}/${tuple.surface}`,
      missing: [],
    }
  }
  return { ok: true, tuple: { channel: tuple.channel, party: tuple.party, surface: tuple.surface } }
}

/** 已登记组合数，供测试与文档核对（72 的合法子集）。 */
export const VALID_TUPLE_COUNT = TUPLE_KEYS.size
