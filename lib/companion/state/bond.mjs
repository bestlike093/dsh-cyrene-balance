/**
 * 好感层：三维（亲近度 + 信任 + 熟悉度）+ 事件表 + 每日上限 + 分开衰减。
 *
 * 一个数字撑不起「像人」。亲近会冷会热，信任不该因为三天没说话就掉，
 * 熟悉度是共同经历堆出来的，只增不减。
 *
 * 约束：零 Electron、零宿主依赖、纯函数为主，时间由调用方注入。
 * 规则可被外部 JSON 覆盖，方便以后调参而不改代码。
 */
/* v3：主人起步 60 以上；重要/次重要各有起点；路人看前十句话。 */
export const BOND_VERSION = 3

/* 阶段判档只在这里做一次，快照和提示词都从这里取。 */
import { resolveRelationStage } from './relationship-stage.mjs'

/* 维度与取值范围：affinity 会掉到负数，trust / familiarity 不会 */
export const BOND_DIMENSIONS = {
  affinity: { min: -100, max: 100, start: 0 },
  trust: { min: 0, max: 100, start: 50 },
  familiarity: { min: 0, max: 100, start: 0 },
}

/* 关系档只留 policy 一份（relationship-stage.mjs）。
 * 这里原本还有一张按加权分切档的表，口径与阶段表不一致，已经撤掉。 */

const DAY = 24 * 60 * 60 * 1000

/* 同一件事的「新鲜度」：半小时内重复，份量逐次衰减。 */
const NOVELTY_WINDOW_MS = 30 * 60 * 1000
const NOVELTY_STEPS = [1, 0.5, 0.3, 0.2]

function noveltyScale(bond, rule, now) {
  if (rule.novelty === false) return 1
  const recent = bond.log.filter(
    (item) => item.type === rule.id && now - item.at >= 0 && now - item.at < NOVELTY_WINDOW_MS,
  ).length
  return NOVELTY_STEPS[Math.min(recent, NOVELTY_STEPS.length - 1)]
}

/**
 * 默认事件表。
 *
 * 分级原则（tier）：
 *   micro  日常微互动，每次只挪一点点，靠次数和陪伴累积
 *   small  一次互动里能感到分量的小事
 *   medium 被理解、被接住、被记住
 *   moment 特殊时刻：生日、纪念日、第一次说出心里话
 *   hurt   受伤；deep-hurt 是信任层面的裂口
 *
 * 「像人」的两个约束：
 *   - 日常不能猛涨：micro / small 的 delta 加起来一天也不该越过一次 moment
 *   - 特殊时刻允许大跳：moment 一次可以顶十几句闲聊，这是记忆锚点
 *
 * noveltyWindow 内重复同一事件会递减（见 applyBondEvent），
 * 连夸三次的快乐不该等于夸三次。
 *
 * dailyCap 是「每天净变化的上限」：正向封顶，负向封底（写成负数）。
 */
export const DEFAULT_BOND_RULES = [
  /* ---- 日常微互动：一次 0.01 ~ 0.03 ----
     好感总量只有 100，日常必须小到几乎察觉不到，靠次数慢慢攒。 */
  { id: 'greet', dim: 'affinity', delta: 0.02, dailyCap: 0.02, tier: 'micro', label: '你跟她打了招呼' },
  { id: 'initiate', dim: 'affinity', delta: 0.03, dailyCap: 0.06, tier: 'micro', label: '你主动找她说话' },
  { id: 'reply', dim: 'affinity', delta: 0.01, dailyCap: 0.03, tier: 'micro', label: '你认真回了她一句' },
  { id: 'thanks', dim: 'affinity', delta: 0.02, dailyCap: 0.04, tier: 'micro', label: '你跟她说了谢谢' },

  /* ---- 小型正面：一次 0.03 ~ 0.08 ---- */
  { id: 'together', dim: 'familiarity', delta: 0.05, dailyCap: 0.2, tier: 'small', label: '一起在 DSH 里忙了一阵' },
  { id: 'seen', dim: 'familiarity', delta: 0.03, dailyCap: 0.12, tier: 'small', label: '又见到这个人说话' },
  { id: 'praise', dim: 'affinity', delta: 0.06, dailyCap: 0.12, tier: 'small', label: '你夸了她' },
  { id: 'teased', dim: 'affinity', delta: 0.04, dailyCap: 0.12, tier: 'small', label: '你把她逗笑了' },
  { id: 'shareJoy', dim: 'affinity', delta: 0.06, dailyCap: 0.18, tier: 'small', label: '你把好消息告诉了她' },
  { id: 'sharePain', dim: 'trust', delta: 0.08, dailyCap: 0.24, tier: 'small', label: '你跟她说了难过的事' },
  { id: 'lateNight', dim: 'affinity', delta: 0.05, dailyCap: 0.1, tier: 'small', label: '很晚了还在一起' },
  { id: 'quietCompany', dim: 'affinity', delta: 0.04, dailyCap: 0.12, tier: 'small', label: '安安静静陪着，没有出声' },

  /* ---- 中型：被理解、被接住、被记住 ---- */
  { id: 'comfort', dim: 'trust', delta: 0.16, dailyCap: 0.48, tier: 'medium', label: '她难过的时候，你安慰了她' },
  { id: 'apologize', dim: 'trust', delta: 0.16, dailyCap: 0.32, tier: 'medium', label: '她认错，你接住了' },
  { id: 'soothe', dim: 'affinity', delta: 0.14, dailyCap: 0.28, tier: 'medium', label: '她有点生气，你哄好了' },
  { id: 'care', dim: 'trust', delta: 0.2, dailyCap: 0.6, tier: 'medium', label: '你累了，她体贴了你' },
  { id: 'recall', dim: 'trust', delta: 0.16, dailyCap: 0.32, tier: 'medium', label: '她准确提起了旧事' },
  { id: 'recallPraise', dim: 'affinity', delta: 0.22, dailyCap: 0.44, tier: 'medium', label: '你记得她随口说过的小事' },
  { id: 'corrected', dim: 'trust', delta: 0.14, dailyCap: 0.28, tier: 'medium', label: '你指出她错了，她听进去了' },
  { id: 'comeBack', dim: 'affinity', delta: 0.35, dailyCap: 0.7, tier: 'medium', label: '隔了很久，你又回来了' },
  { id: 'longSession', dim: 'familiarity', delta: 0.3, dailyCap: 0.6, tier: 'medium', label: '陪她熬过一段很长的活' },

  /* ---- 特殊时刻：一次 0.8 ~ 2.2，仍然高于一整天的日常 ---- */
  { id: 'closeness', dim: 'affinity', delta: 0.16, dailyCap: 0.48, tier: 'medium', label: '贴近了一小会儿' },
  { id: 'firstTime', dim: 'familiarity', delta: 0.8, dailyCap: 1.6, tier: 'moment', label: '第一次一起做成一件事' },
  { id: 'promise', dim: 'trust', delta: 1, dailyCap: 2, tier: 'moment', label: '你们约定了以后' },
  { id: 'deepTalk', dim: 'affinity', delta: 1.4, dailyCap: 2.8, tier: 'moment', label: '聊到了心里很深的地方' },
  { id: 'shareSecret', dim: 'trust', delta: 1.8, dailyCap: 3.6, tier: 'moment', label: '第一次把没跟别人说过的事告诉了她' },
  { id: 'anniversary', dim: 'affinity', delta: 2.2, dailyCap: 4.4, tier: 'moment', label: '一起过的日子被记住了' },
  { id: 'birthday', dim: 'affinity', delta: 1.8, dailyCap: 3.6, tier: 'moment', label: '她的生日，你在' },

  /* ---- 负面：小事几乎不动，裂口才扣得深 ---- */
  { id: 'perfunctory', dim: 'affinity', delta: -0.02, dailyCap: -0.1, tier: 'micro', label: '连续几句都敷衍' },
  { id: 'interrupt', dim: 'affinity', delta: -0.04, dailyCap: -0.12, tier: 'small', label: '她话没说完就被打断' },
  { id: 'ignoredQuestion', dim: 'affinity', delta: -0.06, dailyCap: -0.18, tier: 'small', label: '她问了话，没有等到回答' },
  { id: 'rejected', dim: 'affinity', delta: -0.06, dailyCap: -0.18, tier: 'small', label: '她凑过来，被推开了' },
  { id: 'coldReply', dim: 'affinity', delta: -0.06, dailyCap: -0.18, tier: 'small', label: '她认真说话，只收到冷淡' },
  { id: 'misremember', dim: 'trust', delta: -0.12, dailyCap: -0.36, tier: 'medium', label: '她记错了要紧的事' },
  { id: 'brokenPromise', dim: 'trust', delta: -0.3, dailyCap: -0.9, tier: 'medium', label: '说好的事没有做到' },
  { id: 'mockTrust', dim: 'trust', delta: -0.5, dailyCap: -1, tier: 'hurt', label: '她认真说过的事被拿来开玩笑' },
  { id: 'harshWords', dim: 'affinity', delta: -0.8, dailyCap: -1.6, tier: 'hurt', label: '对她说了很重的话' },
  { id: 'betray', dim: 'trust', delta: -1.6, dailyCap: -3.2, tier: 'deep-hurt', label: '信任被辜负了' },
  { id: 'neglect', dim: 'affinity', delta: -0.05, dailyCap: -1.5, tier: 'small', label: '很久没有联系' },
]


/* ------------------------------------------------------------------ *
 * 关系起点：不是所有人都该从 0 开始认识她。
 * 主人一进门就有 60+ 的亲近度——这是「你是谁」的身份起点；
 * 但熟悉度只有 30~40：共同经历要真的一起攒出来，不能一见面就满。
 * 这样好感事件才能继续推动最上面两档（很亲近 / 相依），
 * 关系阶段不会退化成一页日历。重要/次重要由主人在设置里点名；
 * 路过的群友看完前十句话才知道该站在哪儿。
 * ------------------------------------------------------------------ */

export const BOND_TIERS = {
  owner: { affinity: [60, 70], familiarity: [30, 40], label: '主人' },
  important: { affinity: [50, 60], familiarity: [50, 60], label: '重要的人' },
  secondary: { affinity: [30, 40], familiarity: [30, 40], label: '次重要的人' },
  guest: { affinity: [0, 0], familiarity: [0, 0], label: '路过的人' },
}

/* 用「档位 + 键名」做种子：同一个人的起点稳定，不会刷新一次换一个数。 */
function seededUnit(seedText) {
  let seed = 2166136261
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  return ((seed >>> 0) % 1000) / 1000
}

/** 某个档位的起始好感：在区间里取一个稳定的点。 */
export function startValueOf(tier, seedText = '') {
  const band = BOND_TIERS[tier] ?? BOND_TIERS.guest
  const [min, max] = band.affinity
  if (max <= min) return round2(min)
  return round2(min + (max - min) * seededUnit(`${tier}:${seedText}`))
}

const IMPRESSION_GOOD = ['谢谢', '你好', '请问', '麻烦', '辛苦', '喜欢', '厉害', '可爱', '感谢', '棒', '哈哈']
const IMPRESSION_BAD = ['滚', '闭嘴', '烦死', '傻', '蠢', '讨厌', '别烦我', '垃圾', '无聊']

/**
 * 前十句话定第一印象，落在 0~10。
 * 基准 5：礼貌、愿意多说两句的往上走，带刺的往下掉。
 * 只算这一次，之后靠事件累积，不再回头改起点。
 */
export function scoreFirstImpression(lines = []) {
  const sample = (Array.isArray(lines) ? lines : [])
    .filter((line) => typeof line === 'string' && line.trim() !== '')
    .slice(0, 10)
  if (sample.length === 0) return 0
  let total = 0
  for (const line of sample) {
    const text = line.trim()
    let delta = 0
    const good = IMPRESSION_GOOD.filter((word) => text.includes(word)).length
    const bad = IMPRESSION_BAD.filter((word) => text.includes(word)).length
    delta += Math.min(1.5, good * 0.7)
    delta -= Math.min(3, bad * 1.5)
    if (text.length >= 8) delta += 0.3
    if (/[?？]/.test(text)) delta += 0.2
    total += delta
  }
  return round2(clamp(5 + total / sample.length, 0, 10))
}

/** 前十句话攒齐后一次性定档；没攒齐就原样返回。 */
export function settleFirstImpression(bond, now = Date.now()) {
  const next = normalizeBond(bond, now)
  if (next.probe.done === true || next.probe.lines.length < 10) {
    return { bond: next, settled: false, score: 0 }
  }
  const score = scoreFirstImpression(next.probe.lines)
  next.affinity = round2(Math.max(next.affinity, score))
  next.familiarity = round2(Math.max(next.familiarity, round2(score * 0.6)))
  next.probe = { lines: [], done: true }
  next.updatedAt = now
  next.log = [...next.log, { at: now, type: 'firstImpression', dim: 'affinity', delta: next.affinity }].slice(-80)
  return { bond: next, settled: true, score }
}

export function defaultBond(now = Date.now(), tier = 'guest', seedText = '') {
  const seed = `${tier}:${seedText}`
  return {
    version: BOND_VERSION,
    updatedAt: now,
    /* 认识的第一天。关系阶段要拿它算天数，只写一次，之后不再动。 */
    firstMetAt: now,
    affinity: startValueOf(tier, seed),
    trust: BOND_DIMENSIONS.trust.start,
    familiarity: startValueOf(tier, `${seed}:familiarity`),
    affinityLocked: false,
    closenessAt: null,
    closenessCount: 0,
    counters: { day: todayOf(now), today: {}, neglect: 0 },
    lastDecayAt: now,
    /* probe：前十条消息的原文。攒满十句定第一次档，之后清空。 */
    probe: { lines: [], done: tier !== 'guest' },
    log: [],
  }
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

/* 每日累计按本地日期切，避免国内在早上 8 点才重置 */
function todayOf(now) {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/* 两位小数：日常一次只该挪 0.02 这种量级，一位小数会被舍成 0。 */
function round2(value) {
  return Math.round(value * 100) / 100
}

/*
 * 老存档没有 firstMetAt：退到最早一条记录，再退到 updatedAt。
 * 只推导、不写回，等下一次真正写盘时才落成固定日期。
 * log 只留 80 条，所以这个值是「能追到的最早」，不是绝对的第一天。
 */
function resolveFirstMet(raw, log, now) {
  const direct = Number(raw?.firstMetAt)
  if (Number.isFinite(direct) && direct > 0 && direct <= now) return direct
  let earliest = null
  for (const item of log) {
    if (earliest === null || item.at < earliest) earliest = item.at
  }
  if (earliest !== null) return Math.min(earliest, now)
  const updated = Number(raw?.updatedAt)
  if (Number.isFinite(updated) && updated > 0 && updated <= now) return updated
  return now
}

export function normalizeBond(raw, now = Date.now()) {
  const base = defaultBond(now)
  if (raw === null || typeof raw !== 'object') return base
  const counters = raw.counters !== null && typeof raw.counters === 'object' ? raw.counters : {}
  const today = counters.today !== null && typeof counters.today === 'object' ? counters.today : {}
  const log = Array.isArray(raw.log)
    ? raw.log
        .filter((item) => item !== null && typeof item === 'object')
        .map((item) => ({
          at: Number.isFinite(Number(item.at)) ? Number(item.at) : now,
          type: typeof item.type === 'string' ? item.type.slice(0, 32) : 'unknown',
          dim: item.dim === 'trust' || item.dim === 'familiarity' ? item.dim : 'affinity',
          delta: Number.isFinite(Number(item.delta)) ? round2(Number(item.delta)) : 0,
        }))
        .slice(-80)
    : []
  return {
    version: BOND_VERSION,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
    firstMetAt: resolveFirstMet(raw, log, now),
    affinity: clamp(raw.affinity ?? base.affinity, -100, 100),
    trust: clamp(raw.trust ?? base.trust, 0, 100),
    familiarity: clamp(raw.familiarity ?? base.familiarity, 0, 100),
    affinityLocked: raw.affinityLocked === true,
    /* 主人起步价只补一次；之后就算手动调低，也不会被反复拉回去。 */
    ownerStartApplied: raw.ownerStartApplied === true,
    closenessAt: Number.isFinite(Number(raw.closenessAt)) ? Number(raw.closenessAt) : null,
    closenessCount: Math.max(0, Math.trunc(Number(raw.closenessCount) || 0)),
    counters: {
      day: typeof counters.day === 'string' ? counters.day.slice(0, 10) : base.counters.day,
      today,
      neglect: round2(Math.max(0, Number(counters.neglect) || 0)),
    },
    lastDecayAt: Number.isFinite(Number(raw.lastDecayAt)) ? Number(raw.lastDecayAt) : now,
    /* 老数据没有 probe：视为已完成，不拿旧记录回头重算第一印象。 */
    probe: {
      lines: Array.isArray(raw.probe?.lines)
        ? raw.probe.lines.filter((line) => typeof line === 'string' && line.trim() !== '').slice(-10)
        : [],
      done: typeof raw.probe?.done === 'boolean' ? raw.probe.done : true,
    },
    log,
  }
}

/* 分数仍按三维加权算，但不再自己分档——档位交给阶段表。 */
export function bondLevel(bond) {
  const snapshot = normalizeBond(bond)
  const score = snapshot.affinity + snapshot.trust * 0.2 + snapshot.familiarity * 0.3
  return { score: round2(score) }
}

/**
 * 关系阶段：把 bond 折算成 0~100 分，再交给阶段表。
 *
 * bondLevel 的分数是给内部排序用的，量纲是 -100~150；
 * 阶段表的门槛按 0~100 定，所以先钳住再判。
 * 快照、提示词、试演都走这一个入口，不再各自算一套。
 */
export function relationStageOf(bond, now = Date.now()) {
  const normalized = normalizeBond(bond, now)
  const level = bondLevel(normalized)
  return resolveRelationStage({
    score: Math.min(100, Math.max(0, level.score)),
    firstMetAt: normalized.firstMetAt,
    now,
  })
}

/* 一周掉 1 点亲近度，信任与熟悉度不动 */
export function decayBond(bond, now = Date.now()) {
  const next = normalizeBond(bond, now)
  const weeks = Math.floor((now - next.lastDecayAt) / (7 * DAY))
  if (weeks <= 0) return next
  if (next.affinityLocked !== true) next.affinity = clamp(next.affinity - weeks, -100, 100)
  /* 锁定期间也推进结算点，解锁后不会一次性补扣 */
  next.lastDecayAt = next.lastDecayAt + weeks * 7 * DAY
  next.updatedAt = now
  return next
}

/* 设置页手动设定亲近度；不影响信任与熟悉度，也不触发事件记账 */
export function setAffinity(bond, value, now = Date.now()) {
  const next = normalizeBond(bond, now)
  next.affinity = round2(clamp(value, -100, 100))
  next.updatedAt = now
  return next
}

/* 设置页加减亲近度；结果仍夹在 -100 ~ 100 */
export function adjustAffinity(bond, delta, now = Date.now()) {
  const next = normalizeBond(bond, now)
  const amount = Number(delta)
  if (!Number.isFinite(amount) || amount === 0) return next
  next.affinity = round2(clamp(next.affinity + amount, -100, 100))
  next.updatedAt = now
  return next
}

/* 锁定后自动涨落与衰减都跳过亲近度，手动设定仍然可用 */
export function setAffinityLocked(bond, locked, now = Date.now()) {
  const next = normalizeBond(bond, now)
  next.affinityLocked = locked === true
  next.updatedAt = now
  return next
}

function findRule(rules, type) {
  return rules.find((rule) => rule.id === type) ?? null
}

/* 幅度抖动：同一件事，今天的分量和昨天本来就该有点差别。
   用事件名 + 10 分钟时间片做种子——同一时间片内稳定，不会一刷新就跳。
   输出 0.8 ~ 1.2，±20%；想让某条规则绝对固定就给它加 jitter: false。 */
function jitterOf(rule, now) {
  if (rule.jitter === false) return 1
  const slot = Math.floor(now / (10 * 60 * 1000))
  const key = `${rule.id}:${slot}`
  let seed = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    seed ^= key.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  return 0.8 + (((seed >>> 0) % 1000) / 1000) * 0.4
}

/**
 * 记一次事件。
 *
 * 返回 { bond, applied }，applied 里有实际变化、是否被每日上限截住，
 * 方便设置页和日记解释「今天为什么涨/跌了」。
 */
export function applyBondEvent(bond, event, { rules = DEFAULT_BOND_RULES, now = Date.now(), gainScale = null } = {}) {
  const next = decayBond(bond, now)
  if (event === null || typeof event !== 'object') return { bond: next, applied: null }

  const type = typeof event.type === 'string' ? event.type : ''
  const rule = findRule(rules, type)
  if (rule === null) return { bond: next, applied: null }

  /* 新的一天：重置当日累计；neglect 的总量跨天保留，避免天天刷同一条 */
  const day = todayOf(now)
  if (next.counters.day !== day) {
    next.counters.day = day
    next.counters.today = {}
  }

  const amount = Number(event.amount)
  const rawScale = Number.isFinite(amount) && amount > 0 ? amount : 1
  const scale = Math.min(rawScale, 10)
  let delta = rule.delta * scale * noveltyScale(next, rule, now) * jitterOf(rule, now)

  /* neglect 按天数结算：每天 -0.05，总和封顶 -1.5（约 30 天没联系） */
  if (rule.id === 'neglect') {
    const remaining = Math.max(0, 1.5 - next.counters.neglect)
    const days = Math.max(1, Math.round(rawScale))
    delta = -Math.min(remaining, days * 0.05)
    next.counters.neglect = round2(next.counters.neglect + Math.abs(delta))
  }

  /* 性格决定的好感/熟悉涨速：只缩放正向事件，惩罚不因为性子软就变轻。 */
  if (delta > 0 && gainScale !== null && typeof gainScale === 'object') {
    const factor = Number(gainScale[rule.dim])
    if (Number.isFinite(factor) && factor > 0) {
      delta *= Math.min(1.6, Math.max(0.6, factor))
    }
  }

  const before = Number(next.counters.today[rule.id] ?? 0)
  const cap = Number(rule.dailyCap ?? 0)
  let allowed = delta
  if (cap > 0) {
    allowed = Math.min(delta, Math.max(0, cap - before))
  } else if (cap < 0) {
    allowed = Math.max(delta, Math.min(0, cap - before))
  }
  if (rule.id === 'neglect') allowed = delta

  const dim = rule.dim
  if (dim === 'affinity' && next.affinityLocked === true) {
    return {
      bond: next,
      applied: {
        id: rule.id,
        label: rule.label,
        dim,
        delta: 0,
        requested: round2(delta),
        capped: true,
        locked: true,
      },
    }
  }
  const range = BOND_DIMENSIONS[dim]
  const nextValue = clamp(next[dim] + allowed, range.min, range.max)
  const real = round2(nextValue - next[dim])
  next[dim] = round2(nextValue)
  next.counters.today[rule.id] = round2(before + real)
  next.updatedAt = now

  if (rule.id === 'closeness' && real > 0) {
    next.closenessAt = now
    next.closenessCount += 1
  }

  if (real !== 0) {
    next.log = [...next.log, { at: now, type: rule.id, dim, delta: real }].slice(-80)
  }

  return {
    bond: next,
    applied: {
      id: rule.id,
      label: rule.label,
      dim,
      delta: real,
      requested: round2(delta),
      capped: round2(delta) !== real,
    },
  }
}

/**
 * 当前心情：只从最近 45 分钟的事件和关系档推出来，给立绘换姿态用。
 * 优先级从「需要被看见」到「日常」：疏远 / 亲近 / 被哄 / 被照顾 / 一起忙 / 平静。
 */
export function bondMood(bond, now = Date.now()) {
  const snapshot = decayBond(bond, now)
  const window = 45 * 60 * 1000
  const recent = new Set(
    snapshot.log.filter((item) => now - item.at >= 0 && now - item.at < window).map((item) => item.type),
  )
  if (recent.has('neglect') || snapshot.affinity <= -10) return 'serious'
  if (snapshot.closenessAt !== null && now - snapshot.closenessAt < DAY) return 'love'
  if (snapshot.affinity >= 60) return 'love'
  if (recent.has('soothe') || recent.has('closeness')) return 'happy'
  if (recent.has('care') || recent.has('comfort') || recent.has('apologize')) return 'gentle'
  if (recent.has('together')) return 'focused'
  return 'calm'
}

/* 设置页 / 日记用：三个数 + 关系档 + 最近一次贴近 */
export function bondSummary(bond, now = Date.now()) {
  const snapshot = decayBond(bond, now)
  const stage = relationStageOf(snapshot, now)
  return {
    affinity: snapshot.affinity,
    trust: snapshot.trust,
    familiarity: snapshot.familiarity,
    level: stage.key,
    levelLabel: stage.label,
    closenessAt: snapshot.closenessAt,
    closenessCount: snapshot.closenessCount,
    today: snapshot.counters.today,
  }
}

/* 日记：把当天的事件翻译成人话，不暴露公式 */
export function explainToday(bond, now = Date.now()) {
  const snapshot = normalizeBond(bond, now)
  const day = todayOf(now)
  if (snapshot.counters.day !== day) return []
  return Object.entries(snapshot.counters.today)
    .filter(([, value]) => Number(value) !== 0)
    .map(([id, value]) => {
      const rule = findRule(DEFAULT_BOND_RULES, id)
      return {
        id,
        label: rule === null ? id : rule.label,
        delta: round2(Number(value)),
      }
    })
}

/* 便利构造器：让宿主只注入 filePath 就能读写，规则可覆盖 */
export function nextBond(current, event, options = {}) {
  return applyBondEvent(current, event, options).bond
}

/* ------------------------------------------------------------------ *
 * 多对象好感：主人 / 每个私聊的人 / 群里每个发言人各一份。
 * 桌面沿用原来的单一 bond，键固定为 desktop，旧数据不需要迁移。
 * ------------------------------------------------------------------ */

export const PEER_BOND_LIMIT = 200

/** 一个人在哪儿说话，就对应一把好感键。群里必须带上发言人，否则整个群共用一份好感。 */
export function peerKeyOf(scope, source) {
  if (source?.channel !== 'qq') return 'desktop'
  const chatId = typeof source.openId === 'string' ? source.openId.trim() : ''
  if (source.chatType === 'group') {
    const sender = typeof source.senderOpenId === 'string' ? source.senderOpenId.trim() : ''
    if (chatId === '') return 'qq:group'
    return sender === '' ? `qq:group:${chatId}` : `qq:group:${chatId}#${sender}`
  }
  if (chatId !== '') return `qq:private:${chatId}`
  const fallback = typeof scope === 'string' && scope !== '' ? scope : 'qq:private'
  return fallback
}

/** 取某个键的好感；没有就按这个人的身份给起点，不写回。 */
export function peerBondOf(bonds, key, now = Date.now(), { tier = 'guest' } = {}) {
  const map = bonds !== null && typeof bonds === 'object' ? bonds : {}
  const raw = map[key]
  if (raw === undefined) return defaultBond(now, tier, key)
  return normalizeBond(raw, now)
}

/** 写回某个键；超过上限时丢掉最久没动过的，避免群里人越多文件越大。 */
export function withPeerBond(bonds, key, bond, now = Date.now()) {
  const map = bonds !== null && typeof bonds === 'object' ? { ...bonds } : {}
  map[key] = normalizeBond(bond, now)
  const keys = Object.keys(map)
  if (keys.length > PEER_BOND_LIMIT) {
    keys
      .sort((a, b) => Number(map[a]?.updatedAt ?? 0) - Number(map[b].updatedAt ?? 0))
      .slice(0, keys.length - PEER_BOND_LIMIT)
      .forEach((stale) => delete map[stale])
  }
  return map
}

/** 观察台用：每个人一条摘要，按最近活动排序。 */
export function peerBondSummaries(bonds, now = Date.now()) {
  const map = bonds !== null && typeof bonds === 'object' ? bonds : {}
  return Object.entries(map)
    .map(([key, raw]) => ({ key, ...bondSummary(raw, now), updatedAt: Number(raw?.updatedAt ?? 0) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/* ------------------------------------------------------------------ *
 * 烦躁度：短时情绪，不是关系。攒起来会自己消，不需要每日上限。
 * ------------------------------------------------------------------ */

export const IRRITATION_HALF_LIFE_MS = 20 * 60 * 1000

/* 余怒比火头缠得久：60 以上按原半衰期，跌破 60 之后半衰期拉长。
   不这么做的话，一次吵架过一夜就归零，第二天提起像没发生过。 */
export const IRRITATION_TAIL_BOUNDARY = 60
export const IRRITATION_TAIL_FACTOR = 1.8

/*
 * 连续衰减，不是整段跳。
 * 原来用 floor(elapsed / span) 数「过了几个半衰期」，20 分钟内数值一动不动，
 * 第 20 分钟忽然减半；现在按指数走，任何时刻读到的都是当下该有的值。
 */
function decayIrritation(value, elapsed, span) {
  if (elapsed <= 0) return value
  const boundary = IRRITATION_TAIL_BOUNDARY
  const tailSpan = span * IRRITATION_TAIL_FACTOR
  if (value <= boundary) return value * Math.pow(0.5, elapsed / tailSpan)
  const timeToBoundary = span * Math.log2(value / boundary)
  if (elapsed <= timeToBoundary) return value * Math.pow(0.5, elapsed / span)
  return boundary * Math.pow(0.5, (elapsed - timeToBoundary) / tailSpan)
}

/** 按半衰期回落到 0~100 的整数。半衰期由性格参数传入，缺省用旧值。 */
export function irritationOf(state, now = Date.now(), halfLifeMs = IRRITATION_HALF_LIFE_MS) {
  const value = Number(state?.value)
  if (!Number.isFinite(value) || value <= 0) return 0
  const at = Number(state?.at)
  const elapsed = Number.isFinite(at) ? Math.max(0, now - at) : 0
  const span = Number.isFinite(Number(halfLifeMs)) ? Math.max(60_000, Number(halfLifeMs)) : IRRITATION_HALF_LIFE_MS
  const decayed = decayIrritation(Math.min(100, value), elapsed, span)
  return Math.round(Math.min(100, Math.max(0, decayed)))
}

/* 挨骂之后的头十分钟，安抚只能带走一点点：还在气头上，听不进去。
   过了这段时间，道歉才真的管用。 */
export const IRRITATION_COOLDOWN_MS = 10 * 60 * 1000
export const IRRITATION_RELIEF = { apology: 0.3, comfort: 0.15, soothe: 0.2 }
/* 再怎么道歉，也留一点余温；一句「对不起」不该像按了清零键。 */
export const IRRITATION_FLOOR = 8

/**
 * 道歉 / 安慰的即时回温。时间是另一条路，交给 irritationOf。
 * 返回 { state, cooling, relieved }：state 直接写回，另外两个给日记和调试看。
 */
export function easeIrritation(
  state,
  { kind = 'comfort', now = Date.now(), halfLifeMs = IRRITATION_HALF_LIFE_MS } = {},
) {
  const current = irritationOf(state, now, halfLifeMs)
  const at = Number(state?.at)
  const since = Number.isFinite(at) ? Math.max(0, now - at) : Number.POSITIVE_INFINITY
  const cooling = since < IRRITATION_COOLDOWN_MS
  const baseRatio = IRRITATION_RELIEF[kind] ?? IRRITATION_RELIEF.comfort
  const ratio = cooling ? baseRatio * 0.3 : baseRatio
  if (current <= IRRITATION_FLOOR) {
    return { state: { value: current, at: now }, cooling, relieved: 0 }
  }
  /* 比例降温，但至少留 IRRITATION_FLOOR，也只能带走现有的量。 */
  const relieved = Math.min(current - IRRITATION_FLOOR, current * ratio)
  return {
    state: { value: Math.round(Math.max(IRRITATION_FLOOR, current - relieved)), at: now },
    cooling,
    relieved: Math.round(relieved),
  }
}

/** 烦躁 +delta；返回新的 { value, at }，值域 0~100。 */
export function bumpIrritation(state, delta, now = Date.now(), halfLifeMs = IRRITATION_HALF_LIFE_MS) {
  const amount = Number(delta)
  const base = irritationOf(state, now, halfLifeMs)
  const next = Number.isFinite(amount) ? base + amount : base
  return { value: Math.round(Math.min(100, Math.max(0, next))), at: now }
}
