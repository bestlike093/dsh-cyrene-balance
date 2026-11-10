/**
 * 陪伴层落盘：好感、情绪、贴近时刻。
 *
 * 约束：零 Electron 依赖；存储根由调用方注入；原子写入（tmp → rename）。
 * 这一层只负责「记住发生过什么」，不决定什么时候该说话。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STORE_VERSION = 1
export const MAX_CLOSENESS = 20
export const MAX_AFFECTION = 100

const MOODS = new Set(['calm', 'happy', 'tired', 'worried', 'shy', 'focused'])

export function defaultSnapshot(now = Date.now()) {
  return {
    version: STORE_VERSION,
    updatedAt: now,
    affection: 0,
    mood: { label: 'calm', intensity: 1, at: now },
    closeness: [],
    counters: { turns: 0, days: 0, lastDay: null },
  }
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

function normalizeMood(input, now) {
  if (input === null || typeof input !== 'object') return null
  const label = typeof input.label === 'string' && MOODS.has(input.label) ? input.label : 'calm'
  return {
    label,
    intensity: Number(clamp(input.intensity ?? 1, 0, 1).toFixed(2)),
    at: Number.isFinite(Number(input.at)) ? Number(input.at) : now,
  }
}

function normalizeCloseness(list, now) {
  if (!Array.isArray(list)) return []
  return list
    .filter((item) => item !== null && typeof item === 'object')
    .map((item) => ({
      at: Number.isFinite(Number(item.at)) ? Number(item.at) : now,
      kind: typeof item.kind === 'string' ? item.kind.slice(0, 24) : 'moment',
      note: typeof item.note === 'string' ? item.note.slice(0, 200) : '',
    }))
    .slice(-MAX_CLOSENESS)
}

export function normalizeSnapshot(raw, now = Date.now()) {
  if (raw === null || typeof raw !== 'object') return defaultSnapshot(now)
  const base = defaultSnapshot(now)
  const counters = raw.counters !== null && typeof raw.counters === 'object' ? raw.counters : {}
  return {
    version: STORE_VERSION,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
    affection: clamp(raw.affection ?? base.affection, 0, MAX_AFFECTION),
    mood: normalizeMood(raw.mood, now) ?? base.mood,
    closeness: normalizeCloseness(raw.closeness, now),
    counters: {
      turns: Math.max(0, Math.trunc(Number(counters.turns) || 0)),
      days: Math.max(0, Math.trunc(Number(counters.days) || 0)),
      lastDay: typeof counters.lastDay === 'string' ? counters.lastDay.slice(0, 10) : null,
    },
  }
}

export function applyEvent(snapshot, event, now = Date.now()) {
  const next = normalizeSnapshot(snapshot, now)
  next.updatedAt = now
  if (event === null || typeof event !== 'object') return next
  const type = event.type

  if (type === 'chat') {
    next.counters.turns += 1
    const day = new Date(now).toISOString().slice(0, 10)
    if (next.counters.lastDay !== day) {
      next.counters.days += 1
      next.counters.lastDay = day
    }
    return next
  }

  if (type === 'affection') {
    next.affection = clamp(next.affection + Number(event.delta || 0), 0, MAX_AFFECTION)
    return next
  }

  if (type === 'mood') {
    const mood = normalizeMood(event.mood, now)
    if (mood !== null) next.mood = mood
    return next
  }

  if (type === 'closeness') {
    const entry = normalizeCloseness([{ at: now, kind: event.kind, note: event.note }], now)[0]
    if (entry !== null) {
      next.closeness = [...next.closeness, entry].slice(-MAX_CLOSENESS)
    }
    return next
  }

  return next
}

export function createCompanionStore({ filePath, now = () => Date.now() } = {}) {
  if (typeof filePath !== 'string' || filePath === '') {
    throw new Error('companion-store 需要注入 filePath')
  }
  let cache = null
  let writing = Promise.resolve()

  async function load() {
    if (cache !== null) return cache
    try {
      const text = await readFile(filePath, 'utf8')
      cache = normalizeSnapshot(JSON.parse(text), now())
    } catch {
      cache = defaultSnapshot(now())
    }
    return cache
  }

  async function persist(snapshot) {
    await mkdir(dirname(filePath), { recursive: true })
    const temp = `${filePath}.tmp`
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(temp, filePath)
  }

  return {
    load,
    snapshot: () => cache ?? defaultSnapshot(now()),
    async record(event) {
      const current = await load()
      const next = applyEvent(current, event, now())
      cache = next
      /* 串行写入，避免同一进程内两次记录互相覆盖 */
      writing = writing.then(() => persist(next)).catch(() => {})
      await writing
      return next
    },
    async replace(patch) {
      const current = await load()
      const next = normalizeSnapshot({ ...current, ...patch }, now())
      cache = next
      writing = writing.then(() => persist(next)).catch(() => {})
      await writing
      return next
    },
  }
}
