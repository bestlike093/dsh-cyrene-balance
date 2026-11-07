/**
 * 记忆层落盘：四槽（身份 / 偏好 / 事件 / 关系）+ 来源 + 衰减 + 固定 + 召回。
 *
 * 约束与 companion-store 保持一致：
 *   - 零 Electron 依赖；
 *   - 存储根由调用方注入；
 *   - 原子写入（tmp → rename）；
 *   - 坏文件回落空记忆，不抛到调用方。
 *
 * 这一层只负责「记住什么、还能不能想起来」，不决定什么时候该主动提。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const MEMORY_VERSION = 1
export const SLOTS = ['identity', 'preference', 'event', 'relation']
export const SOURCES = ['session', 'pet', 'manual']
export const MAX_ITEMS = 400
export const MAX_TEXT = 400
/* 时间衰减半衰期：30 天没再被提起，时间分掉一半 */
export const HALF_LIFE_DAYS = 30
/* 低于这个权重、又超过 KEEP_DAYS 的未固定条目，会在 prune 时清掉 */
export const MIN_WEIGHT = 0.2
export const KEEP_DAYS = 180

const DAY = 24 * 60 * 60 * 1000

export function defaultMemory(now = Date.now()) {
  return { version: MEMORY_VERSION, updatedAt: now, items: [] }
}

function safeText(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeItem(raw, now) {
  if (raw === null || typeof raw !== 'object') return null
  const slot = SLOTS.includes(raw.slot) ? raw.slot : null
  const text = safeText(raw.text)
  if (slot === null || text === '') return null
  const at = Number.isFinite(Number(raw.at)) ? Number(raw.at) : now
  const lastAt = Number.isFinite(Number(raw.lastAt)) ? Number(raw.lastAt) : at
  return {
    id: safeText(raw.id, 64) || `m-${at}-${Math.random().toString(36).slice(2, 8)}`,
    slot,
    text,
    source: SOURCES.includes(raw.source) ? raw.source : 'session',
    at,
    lastAt,
    mentions: Math.max(1, Math.trunc(Number(raw.mentions) || 1)),
    pinned: raw.pinned === true,
  }
}

export function normalizeMemory(raw, now = Date.now()) {
  if (raw === null || typeof raw !== 'object') return defaultMemory(now)
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => normalizeItem(item, now)).filter((item) => item !== null)
    : []
  return {
    version: MEMORY_VERSION,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
    items: items.slice(-MAX_ITEMS),
  }
}

/* 提及次数 → 0..1，三次左右接近饱和；时间按半衰期衰减；固定条目恒定满分 */
export function weightOf(item, now = Date.now()) {
  if (item.pinned) return 1
  const mentions = Math.max(1, Math.trunc(Number(item.mentions) || 1))
  const mentionScore = 1 - Math.exp(-mentions / 3)
  const ageDays = Math.max(0, (now - Number(item.lastAt || item.at || now)) / DAY)
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
  return Number((0.55 * mentionScore + 0.45 * recency).toFixed(4))
}

/* 中文没有空格：用两字切片做粗粒度重合，英文/数字按空格词处理 */
function grams(text) {
  const lower = String(text).toLowerCase()
  const set = new Set()
  for (const word of lower.split(/\s+/)) {
    if (word.length >= 2) set.add(word)
  }
  const chars = Array.from(lower.replace(/\s+/g, ''))
  for (let i = 0; i < chars.length - 1; i += 1) set.add(chars[i] + chars[i + 1])
  return set
}

export function scoreOf(item, query, now = Date.now()) {
  const queryGrams = grams(query)
  if (queryGrams.size === 0) return 0
  const textGrams = grams(item.text)
  let hit = 0
  for (const gram of queryGrams) if (textGrams.has(gram)) hit += 1
  const overlap = hit / queryGrams.size
  return Number((overlap * 0.75 + weightOf(item, now) * 0.25).toFixed(4))
}

/**
 * 召回：只在指定槽里找，按「文字重合 + 衰减权重」排序。
 * query 为空时按权重返回，用于「今天还记得什么」。
 */
export function recallFrom(memory, query = '', { slot = null, limit = 5, now = Date.now(), minScore = 0.18 } = {}) {
  const source = normalizeMemory(memory, now)
  const pool = slot === null ? source.items : source.items.filter((item) => item.slot === slot)
  const scored = pool
    .map((item) => ({
      item,
      weight: weightOf(item, now),
      score: query.trim() === '' ? weightOf(item, now) : scoreOf(item, query, now),
    }))
    .filter((entry) => entry.score >= minScore || entry.item.pinned)
    .sort((a, b) => b.score - a.score || b.weight - a.weight || b.item.lastAt - a.item.lastAt)
    .slice(0, Math.max(1, limit))
  return scored.map((entry) => ({ ...entry.item, weight: entry.weight, score: entry.score }))
}

/* 清掉又久又轻、且没有固定的条目；固定与近期的一律保留 */
export function pruneMemory(memory, now = Date.now()) {
  const source = normalizeMemory(memory, now)
  const kept = source.items.filter((item) => {
    if (item.pinned) return true
    const ageDays = (now - Number(item.lastAt || item.at || now)) / DAY
    return !(ageDays > KEEP_DAYS && weightOf(item, now) < MIN_WEIGHT)
  })
  /* 超上限时先丢权重最低的非固定条目 */
  if (kept.length > MAX_ITEMS) {
    const fixed = kept.filter((item) => item.pinned)
    const rest = kept
      .filter((item) => !item.pinned)
      .sort((a, b) => weightOf(b, now) - weightOf(a, now))
      .slice(0, Math.max(0, MAX_ITEMS - fixed.length))
    return { ...source, items: [...fixed, ...rest] }
  }
  return { ...source, items: kept }
}

export function createMemoryStore({ filePath, readText, writeText, now = () => Date.now() } = {}) {
  const viaAdapter = typeof readText === 'function' && typeof writeText === 'function'
  if (!viaAdapter && (typeof filePath !== 'string' || filePath === '')) {
    throw new Error('memory-store 需要注入 filePath，或 readText / writeText')
  }
  let cache = null
  let writing = Promise.resolve()

  async function load() {
    if (cache !== null) return cache
    try {
      const text = viaAdapter ? await readText() : await readFile(filePath, 'utf8')
      cache = typeof text === 'string' && text.trim() !== ''
        ? normalizeMemory(JSON.parse(text), now())
        : defaultMemory(now())
    } catch {
      cache = defaultMemory(now())
    }
    return cache
  }

  async function persist(memory) {
    const text = `${JSON.stringify(memory, null, 2)}\n`
    if (viaAdapter) {
      await writeText(text)
      return
    }
    await mkdir(dirname(filePath), { recursive: true })
    const temp = `${filePath}.tmp`
    await writeFile(temp, text, 'utf8')
    await rename(temp, filePath)
  }

  function queue(next) {
    cache = next
    /* 串行写入，同一进程内的多次记录不会互相覆盖 */
    writing = writing.then(() => persist(next)).catch(() => {})
    return writing
  }

  return {
    load,
    snapshot: () => cache ?? defaultMemory(now()),
    async remember(input) {
      const current = await load()
      const at = now()
      const item = normalizeItem({ ...input, at: input?.at ?? at, lastAt: at }, at)
      if (item === null) return current
      const same = current.items.find(
        (existing) => existing.id === item.id || (existing.slot === item.slot && existing.text === item.text),
      )
      let items
      if (same !== undefined) {
        items = current.items.map((existing) =>
          existing === same
            ? {
                ...existing,
                lastAt: at,
                mentions: existing.mentions + 1,
                pinned: existing.pinned || item.pinned,
              }
            : existing,
        )
      } else {
        items = [...current.items, item]
      }
      const next = pruneMemory({ ...current, updatedAt: at, items }, at)
      await queue(next)
      return next
    },
    async pin(id, pinned = true) {
      const current = await load()
      const next = normalizeMemory(
        {
          ...current,
          updatedAt: now(),
          items: current.items.map((item) => (item.id === id ? { ...item, pinned } : item)),
        },
        now(),
      )
      await queue(next)
      return next
    },
    async forget(id) {
      const current = await load()
      const next = { ...current, updatedAt: now(), items: current.items.filter((item) => item.id !== id) }
      await queue(next)
      return next
    },
    /* 恢复备份：整份替换，仍然走 normalize 与清理，旧 id 保持不变 */
    async replace(input) {
      const next = normalizeMemory(
        { ...input, version: MEMORY_VERSION, updatedAt: now() },
        now(),
      )
      await queue(pruneMemory(next, now()))
      return cache
    },
    async recall(query, options = {}) {
      const current = await load()
      return recallFrom(current, query, { ...options, now: options.now ?? now() })
    },
  }
}
