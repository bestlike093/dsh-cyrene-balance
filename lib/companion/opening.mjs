/**
 * 主动开口的「由头」与「话头账本」。
 *
 * 念头只管等多久，不管发不发；攒够了还得有一个理由。
 * 三条不发：派不出由头、模型否决、闸门不过。
 *
 * 这一层只回答两个问题：
 *   1. 现在有没有值得开口的由头（pickCue）
 *   2. 之前开过的口，她是接住了还是被晾着（账本）
 *
 * 约束：零 Electron、零宿主依赖，时间与数据全部注入。
 */
export const OPENING_VERSION = 1

/* 三类由头 + 记忆回访，顺序就是优先级 */
export const CUE_KINDS = ['schedule', 'unfinished', 'reunion', 'memory']

export const DEFAULT_OPENING = {
  minGapMs: 90 * 60 * 1000,
  dailyCap: 3,
  unansweredLimit: 3,
  silenceDays: 3,
  quiet: false,
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

export function defaultLedger(now = Date.now()) {
  return {
    version: OPENING_VERSION,
    updatedAt: now,
    lastOpenAt: null,
    lastUserAt: null,
    unanswered: 0,
    entries: [],
  }
}

function safeText(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function dayOf(now) {
  return new Date(now).toISOString().slice(0, 10)
}

export function normalizeLedger(raw, now = Date.now()) {
  if (raw === null || typeof raw !== 'object') return defaultLedger(now)
  const entries = Array.isArray(raw.entries)
    ? raw.entries
        .filter((item) => item !== null && typeof item === 'object' && Number.isFinite(Number(item.at)))
        .map((item) => ({
          at: Number(item.at),
          kind: CUE_KINDS.includes(item.kind) ? item.kind : 'memory',
          key: safeText(item.key, 120),
          responded: item.responded === true,
        }))
        .slice(-60)
    : []
  return {
    version: OPENING_VERSION,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
    lastOpenAt: raw.lastOpenAt !== null && Number.isFinite(Number(raw.lastOpenAt)) ? Number(raw.lastOpenAt) : null,
    lastUserAt: raw.lastUserAt !== null && Number.isFinite(Number(raw.lastUserAt)) ? Number(raw.lastUserAt) : null,
    unanswered: Math.max(0, Math.trunc(Number(raw.unanswered) || 0)),
    entries,
  }
}

/* 同一个由头一天内不重复用，避免她老是提同一件事 */
export function usedKeyRecently(ledger, key, now = Date.now(), withinMs = DAY) {
  if (safeText(key) === '') return false
  return normalizeLedger(ledger, now).entries.some(
    (entry) => entry.key === key && now - entry.at < withinMs,
  )
}

export function openingsToday(ledger, now = Date.now()) {
  const day = dayOf(now)
  return normalizeLedger(ledger, now).entries.filter((entry) => dayOf(entry.at) === day).length
}

/**
 * 选一个由头。返回 null 表示这次不发。
 *
 * agenda:      [{ at, text, key? }]      日程节点
 * unfinished:  [{ text, lastAt, key? }]  未完话题
 * lastTalkAt:  上一次和用户说话的时间
 * memories:    [{ text, weight, key? }]  够分量的记忆（可选）
 */
export function pickCue({
  now = Date.now(),
  agenda = [],
  unfinished = [],
  lastTalkAt = null,
  memories = [],
  ledger = null,
  options = {},
} = {}) {
  const config = { ...DEFAULT_OPENING, ...options }
  if (config.quiet) return null

  const state = normalizeLedger(ledger, now)
  if (state.lastOpenAt !== null && now - state.lastOpenAt < config.minGapMs) return null
  if (openingsToday(state, now) >= config.dailyCap) return null
  if (shouldGiveUp(state, { now, silenceDays: config.silenceDays, unansweredLimit: config.unansweredLimit })) {
    return null
  }

  /* 1. 日程节点：已经到点（30 分钟内）或快要到（45 分钟内） */
  const due = agenda
    .filter((item) => item !== null && typeof item === 'object')
    .map((item) => ({ ...item, at: Number(item.at) }))
    .filter((item) => Number.isFinite(item.at))
    .filter((item) => item.at - now <= 45 * 60 * 1000 && now - item.at <= 30 * 60 * 1000)
    .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))[0]
  if (due !== undefined) {
    const key = safeText(due.key) || `schedule:${due.at}`
    if (!usedKeyRecently(state, key, now)) {
      return { kind: 'schedule', key, text: safeText(due.text), reason: '日程到点了' }
    }
  }

  /* 2. 未完话题：至少放了半小时，最多一周，且今天没提过 */
  const open = unfinished
    .filter((item) => item !== null && typeof item === 'object')
    .map((item) => ({ ...item, lastAt: Number(item.lastAt) }))
    .filter((item) => Number.isFinite(item.lastAt))
    .filter((item) => now - item.lastAt >= 30 * 60 * 1000 && now - item.lastAt <= 7 * DAY)
    .sort((a, b) => b.lastAt - a.lastAt)[0]
  if (open !== undefined) {
    const key = safeText(open.key) || `unfinished:${open.text}`
    if (!usedKeyRecently(state, key, now)) {
      return { kind: 'unfinished', key, text: safeText(open.text), reason: '上次的话还没说完' }
    }
  }

  /* 3. 隔久问候：超过 8 小时没说话，且不是深夜（深夜交给闸门） */
  if (lastTalkAt !== null && Number.isFinite(Number(lastTalkAt))) {
    const gap = now - Number(lastTalkAt)
    if (gap >= 8 * HOUR) {
      const key = `reunion:${dayOf(now)}`
      if (!usedKeyRecently(state, key, now)) {
        return { kind: 'reunion', key, text: '', reason: gap >= DAY ? '隔了一天以上' : '隔了半天' }
      }
    }
  }

  /* 4. 记忆回访：只挑分量够的，且今天没提过 */
  const memory = memories
    .filter((item) => item !== null && typeof item === 'object')
    .map((item) => ({ ...item, weight: Number(item.weight) || 0 }))
    .filter((item) => item.weight >= 0.6)
    .sort((a, b) => b.weight - a.weight)[0]
  if (memory !== undefined) {
    const key = safeText(memory.key) || `memory:${memory.text}`
    if (!usedKeyRecently(state, key, now)) {
      return { kind: 'memory', key, text: safeText(memory.text), reason: '想起了一件旧事' }
    }
  }

  return null
}

/* 记一次真的发出去了；unanswered 表示连着几次没被接住 */
export function recordOpening(ledger, cue, now = Date.now()) {
  const state = normalizeLedger(ledger, now)
  const entry = {
    at: now,
    kind: CUE_KINDS.includes(cue?.kind) ? cue.kind : 'memory',
    key: safeText(cue?.key, 120),
    responded: false,
  }
  return {
    ...state,
    updatedAt: now,
    lastOpenAt: now,
    unanswered: state.unanswered + 1,
    entries: [...state.entries, entry].slice(-60),
  }
}

/* 用户说话了：接住最近一次开口，连击清零 */
export function markResponse(ledger, now = Date.now()) {
  const state = normalizeLedger(ledger, now)
  const entries = [...state.entries]
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (!entries[i].responded) {
      entries[i] = { ...entries[i], responded: true }
      break
    }
  }
  return { ...state, updatedAt: now, lastUserAt: now, unanswered: 0, entries }
}

/**
 * 连续几天不回应就主动停发。
 * unansweredLimit 次没接住 + 距上次用户说话超过 silenceDays 天。
 */
export function shouldGiveUp(ledger, { now = Date.now(), silenceDays = 3, unansweredLimit = 3 } = {}) {
  const state = normalizeLedger(ledger, now)
  if (state.unanswered < unansweredLimit) return false
  const anchor = state.lastUserAt ?? state.lastOpenAt
  if (anchor === null) return false
  return now - anchor >= silenceDays * DAY
}

/* 设置页 / 日记用的一句话 */
export function ledgerSummary(ledger, now = Date.now()) {
  const state = normalizeLedger(ledger, now)
  return {
    today: openingsToday(state, now),
    unanswered: state.unanswered,
    lastOpenAt: state.lastOpenAt,
    lastUserAt: state.lastUserAt,
    gaveUp: shouldGiveUp(state, { now }),
  }
}
