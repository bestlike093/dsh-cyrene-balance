/**
 * 好感层：四维 + 事件表 + 每日上限 + 分开衰减。
 *
 * 一个数字撑不起「像人」。亲近会冷会热，信任不该因为三天没说话就掉，
 * 熟悉度是共同经历堆出来的，只增不减。
 *
 * 约束：零 Electron、零宿主依赖、纯函数为主，时间由调用方注入。
 * 规则可被外部 JSON 覆盖，方便以后调参而不改代码。
 */
export const BOND_VERSION = 2

/* 维度与取值范围：affinity 会掉到负数，trust / familiarity 不会 */
export const BOND_DIMENSIONS = {
  affinity: { min: -100, max: 100, start: 0 },
  trust: { min: 0, max: 100, start: 50 },
  familiarity: { min: 0, max: 100, start: 0 },
}

export const BOND_LEVELS = [
  { key: 'stranger', min: 0, label: '还陌生' },
  { key: 'acquaintance', min: 15, label: '认识' },
  { key: 'familiar', min: 40, label: '熟悉' },
  { key: 'close', min: 70, label: '亲近' },
]

const DAY = 24 * 60 * 60 * 1000

/**
 * 默认事件表。按 v8 方案 6.1，并把「安慰 / 道歉 / 生气被哄 / 疲惫被体贴」
 * 这四类情绪事件单列出来，让好感真的会随相处方式变化。
 *
 * dailyCap 是「每天净变化的上限」：正向封顶，负向封底（写成负数）。
 */
export const DEFAULT_BOND_RULES = [
  { id: 'initiate', dim: 'affinity', delta: 1, dailyCap: 20, label: '你主动找她说话' },
  { id: 'together', dim: 'familiarity', delta: 1, dailyCap: 3, label: '一起在 DSH 里忙了一阵' },
  { id: 'closeness', dim: 'affinity', delta: 2, dailyCap: 6, label: '贴近了一小会儿' },
  { id: 'comfort', dim: 'trust', delta: 2, dailyCap: 6, label: '她难过的时候，你安慰了她' },
  { id: 'apologize', dim: 'trust', delta: 2, dailyCap: 4, label: '她认错，你接住了' },
  { id: 'soothe', dim: 'affinity', delta: 2, dailyCap: 4, label: '她有点生气，你哄好了' },
  { id: 'care', dim: 'trust', delta: 3, dailyCap: 9, label: '你累了，她体贴了你' },
  { id: 'recall', dim: 'trust', delta: 2, dailyCap: 4, label: '她准确提起了旧事' },
  { id: 'misremember', dim: 'trust', delta: -2, dailyCap: -8, label: '她记错了要紧的事' },
  { id: 'perfunctory', dim: 'affinity', delta: -0.5, dailyCap: -3, label: '连续几句都敷衍' },
  { id: 'interrupt', dim: 'affinity', delta: -1, dailyCap: -3, label: '她话没说完就被打断' },
  { id: 'neglect', dim: 'affinity', delta: -1, dailyCap: -20, label: '很久没有联系' },
]

export function defaultBond(now = Date.now()) {
  return {
    version: BOND_VERSION,
    updatedAt: now,
    affinity: BOND_DIMENSIONS.affinity.start,
    trust: BOND_DIMENSIONS.trust.start,
    familiarity: BOND_DIMENSIONS.familiarity.start,
    affinityLocked: false,
    closenessAt: null,
    closenessCount: 0,
    counters: { day: todayOf(now), today: {}, neglect: 0 },
    lastDecayAt: now,
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

function round1(value) {
  return Math.round(value * 10) / 10
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
          delta: Number.isFinite(Number(item.delta)) ? round1(Number(item.delta)) : 0,
        }))
        .slice(-80)
    : []
  return {
    version: BOND_VERSION,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
    affinity: clamp(raw.affinity ?? base.affinity, -100, 100),
    trust: clamp(raw.trust ?? base.trust, 0, 100),
    familiarity: clamp(raw.familiarity ?? base.familiarity, 0, 100),
    affinityLocked: raw.affinityLocked === true,
    closenessAt: Number.isFinite(Number(raw.closenessAt)) ? Number(raw.closenessAt) : null,
    closenessCount: Math.max(0, Math.trunc(Number(raw.closenessCount) || 0)),
    counters: {
      day: typeof counters.day === 'string' ? counters.day.slice(0, 10) : base.counters.day,
      today,
      neglect: Math.max(0, Math.trunc(Number(counters.neglect) || 0)),
    },
    lastDecayAt: Number.isFinite(Number(raw.lastDecayAt)) ? Number(raw.lastDecayAt) : now,
    log,
  }
}

/* 关系档：用亲近度定档，信任与熟悉度作为加分项，避免只靠一个数字 */
export function bondLevel(bond) {
  const snapshot = normalizeBond(bond)
  const score = snapshot.affinity + snapshot.trust * 0.2 + snapshot.familiarity * 0.3
  let level = BOND_LEVELS[0]
  for (const item of BOND_LEVELS) if (score >= item.min) level = item
  return { ...level, score: round1(score) }
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
  next.affinity = round1(clamp(value, -100, 100))
  next.updatedAt = now
  return next
}

/* 设置页加减亲近度；结果仍夹在 -100 ~ 100 */
export function adjustAffinity(bond, delta, now = Date.now()) {
  const next = normalizeBond(bond, now)
  const amount = Number(delta)
  if (!Number.isFinite(amount) || amount === 0) return next
  next.affinity = round1(clamp(next.affinity + amount, -100, 100))
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

/**
 * 记一次事件。
 *
 * 返回 { bond, applied }，applied 里有实际变化、是否被每日上限截住，
 * 方便设置页和日记解释「今天为什么涨/跌了」。
 */
export function applyBondEvent(bond, event, { rules = DEFAULT_BOND_RULES, now = Date.now() } = {}) {
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
  let delta = rule.delta * scale

  /* neglect 允许一次结算多天，但总惩罚封顶在 -20 */
  if (rule.id === 'neglect') {
    const remaining = Math.max(0, 20 - next.counters.neglect)
    delta = -Math.min(remaining, Math.max(1, Math.trunc(rawScale)))
    next.counters.neglect += Math.abs(delta)
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
        requested: round1(delta),
        capped: true,
        locked: true,
      },
    }
  }
  const range = BOND_DIMENSIONS[dim]
  const nextValue = clamp(next[dim] + allowed, range.min, range.max)
  const real = round1(nextValue - next[dim])
  next[dim] = round1(nextValue)
  next.counters.today[rule.id] = round1(before + real)
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
      requested: round1(delta),
      capped: round1(delta) !== real,
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
  const level = bondLevel(snapshot)
  return {
    affinity: snapshot.affinity,
    trust: snapshot.trust,
    familiarity: snapshot.familiarity,
    level: level.key,
    levelLabel: level.label,
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
        delta: round1(Number(value)),
      }
    })
}

/* 便利构造器：让宿主只注入 filePath 就能读写，规则可覆盖 */
export function nextBond(current, event, options = {}) {
  return applyBondEvent(current, event, options).bond
}
