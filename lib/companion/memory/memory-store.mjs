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
 *
 * 作用域：主人的事 / 与某人的私聊 / 某个群里的见闻各自成桶。
 * 同一句话在不同群里出现不算重复，主人桶也不会被群聊挤占。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { halfLifeDaysOf } from '../persona/traits.mjs'

export const MEMORY_VERSION = 1
export const SLOTS = ['identity', 'preference', 'event', 'relation']
export const SOURCES = ['session', 'pet', 'manual']
/* 记忆归属：主人本人 / 某人的私聊 / 某个群 */
export const SCOPES = ['owner', 'private', 'group']
/* 这条记忆是从哪条线上来的 */
export const CHANNELS = ['qq', 'desk', 'dsh']
/* raw = 原话片段，digest = 一份压缩后的群聊摘要 */
export const KINDS = ['raw', 'digest']
export const MAX_TEXT = 400
/* 每个桶的上限：主人 400、每个私聊对象 200、每个群 600 */
export const MAX_ITEMS = 400
export const PRIVATE_ITEMS = 200
export const GROUP_ITEMS = 600
export const MAX_TOTAL = 3000
/*
 * 时间衰减半衰期：30 天没再被提起，时间分掉一半。
 * 具体形状（死区 0.15、满量程 ±1/6）的唯一实现放在 traits 里，
 * 这里 re-export 保持旧引用可用，也保证和 recallDetail.halfLifeDays 同源。
 */
export { RECALL_HALF_LIFE_DAYS as HALF_LIFE_DAYS } from '../persona/traits.mjs'
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
    /* 旧数据没有 scope，一律当作主人记忆，迁移零丢失 */
    scope: SCOPES.includes(raw.scope) ? raw.scope : 'owner',
    scopeId: safeText(raw.scopeId, 64),
    peer: safeText(raw.peer, 64),
    kind: KINDS.includes(raw.kind) ? raw.kind : 'raw',
    channel: CHANNELS.includes(raw.channel) ? raw.channel : '',
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
    items: items.slice(-MAX_TOTAL),
  }
}

/* 桶键只到「作用域 + 对象」，群里的发言人再细分也不该拥有独立容量 */
export function bucketKey(item) {
  return `${item.scope}|${item.scopeId}`
}

export function bucketLimit(scope) {
  if (scope === 'group') return GROUP_ITEMS
  if (scope === 'private') return PRIVATE_ITEMS
  return MAX_ITEMS
}

/*
 * 提及次数 → 0..1，三次左右接近饱和；时间按半衰期衰减；固定条目恒定满分。
 *
 * bias 只改衰减形状（念旧 → 半衰期更长），不碰提及次数。
 * 死区 0.15、满量程 ±1/6 都收在这里，调用点只传人格值。
 *
 * 内部裁剪（pruneMemory）绝不传 bias——它决定哪些记忆被删，那是「记忆是否存在」，
 * 不属于「想起的分量」。检索路径（scoreOf / recallFrom）接受可选 recallBias，
 * 默认 0 保持 HALF_LIFE_DAYS 原行为；要注入人格念旧偏置时由调用方显式传。
 */
export function weightOf(item, now = Date.now(), bias = 0) {
  if (item.pinned) return 1
  const mentions = Math.max(1, Math.trunc(Number(item.mentions) || 1))
  const mentionScore = 1 - Math.exp(-mentions / 3)
  const ageDays = Math.max(0, (now - Number(item.lastAt || item.at || now)) / DAY)
  /*
   * 死区内不抬不压；死区外把 0.15..1 线性铺到 0..1，
   * 再收进 ±1/6，对应半衰期 25 ~ 35 天（封顶 1.17x，偏移 ±5 天）。
   * 形状只写在 traits 里，这里取现成的。
   */
  const halfLife = halfLifeDaysOf(bias)
  const recency = Math.pow(0.5, ageDays / halfLife)
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

export function scoreOf(item, query, now = Date.now(), recallBias = 0) {
  const queryGrams = grams(query)
  if (queryGrams.size === 0) return 0
  const textGrams = grams(item.text)
  let hit = 0
  for (const gram of queryGrams) if (textGrams.has(gram)) hit += 1
  /*
   * 短 query（<4 字）只有一两个 gram，命中一个就接近 1.0，related 会压过强度与时间分。
   * 短 query 改用 dice 系数（2*命中 / 两侧 gram 数之和）归一，并把 related 权重降半，
   * 让 weightOf 的时间与提及分有话语权；长 query 保持原来的 containment 口径。
   */
  const chars = Array.from(String(query ?? '').replace(/\s+/g, '')).length
  const short = chars < 4
  const overlap = short
    ? (2 * hit) / Math.max(1, queryGrams.size + textGrams.size)
    : hit / queryGrams.size
  const relatedWeight = short ? 0.375 : 0.75
  // MEM-083：检索路径可选注入人格念旧偏置，默认 0 时与旧行为完全一致。
  return Number((overlap * relatedWeight + weightOf(item, now, recallBias) * 0.25).toFixed(4))
}

/**
 * 召回：只在指定槽里找，按「文字重合 + 衰减权重」排序。
 * query 为空时按权重返回，用于「今天还记得什么」。
 * 传了 scope / scopeId / peer / channel 就只在该作用域里找。
 */
export function recallFrom(
  memory,
  query = '',
  {
    slot = null,
    limit = 5,
    now = Date.now(),
    minScore = 0.18,
    scope = null,
    scopeId = null,
    peer = null,
    channel = null,
    // MEM-083：召回路径可注入人格念旧偏置；默认 0 保持原行为。
    recallBias = 0,
  } = {},
) {
  const source = normalizeMemory(memory, now)
  const pool = source.items.filter(
    (item) =>
      (slot === null || item.slot === slot) &&
      (scope === null || item.scope === scope) &&
      (scopeId === null || item.scopeId === scopeId) &&
      (peer === null || item.peer === peer) &&
      (channel === null || item.channel === channel),
  )
  const scored = pool
    .map((item) => ({
      item,
      weight: weightOf(item, now),
      score: query.trim() === ''
        ? weightOf(item, now, recallBias)
        : scoreOf(item, query, now, recallBias),
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

  /* 分桶裁剪：群聊再热闹也压不垮主人那一桶 */
  const buckets = new Map()
  for (const item of kept) {
    const key = bucketKey(item)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(item)
  }

  const trimmed = []
  for (const items of buckets.values()) {
    const limit = bucketLimit(items[0].scope)
    const fixed = items.filter((item) => item.pinned)
    const rest = items
      .filter((item) => !item.pinned)
      .sort((a, b) => weightOf(b, now) - weightOf(a, now))
      .slice(0, Math.max(0, limit - fixed.length))
    trimmed.push(...fixed, ...rest)
  }

  /* 全局再兜一层，防止对象数量无限增长 */
  if (trimmed.length <= MAX_TOTAL) return { ...source, items: trimmed }
  const fixed = trimmed.filter((item) => item.pinned)
  const rest = trimmed
    .filter((item) => !item.pinned)
    .sort((a, b) => weightOf(b, now) - weightOf(a, now))
    .slice(0, Math.max(0, MAX_TOTAL - fixed.length))
  return { ...source, items: [...fixed, ...rest] }
}

/**
 * 群聊摘要：按发言人聚类，每人留最近几句，压成一条 digest。
 * 纯本地规则，不调模型；返回 null 表示这批还不够压。
 */
export function buildDigest(pool, now = Date.now()) {
  const raw = pool.filter((item) => item.kind === 'raw')
  if (raw.length < 10) return null
  const byPeer = new Map()
  for (const item of raw) {
    const key = item.peer === '' ? '其他人' : item.peer
    if (!byPeer.has(key)) byPeer.set(key, [])
    byPeer.get(key).push(item)
  }
  const parts = []
  for (const [peer, items] of byPeer) {
    // 每人窗口 6 句、每句 60 字（仍是压缩摘要，但密度比 3 句 × 30 字高）；
    // 触发阈值仍是最少 10 条原话，不变。
    const recent = items
      .slice(-6)
      .map((item) => item.text.replace(/\s+/g, ' ').slice(0, 60))
      .join('；')
    parts.push(`${peer}：${recent}`)
  }
  const text = `群里最近聊到 —— ${parts.join(' / ')}`.slice(0, MAX_TEXT)
  const at = now
  return normalizeItem(
    {
      slot: 'event',
      text,
      source: 'session',
      scope: raw[0].scope,
      scopeId: raw[0].scopeId,
      peer: '',
      kind: 'digest',
      channel: 'qq',
      at,
      mentions: 1,
    },
    at,
  )
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

  /* 同一句话只在同一个作用域、同一个发言人身上去重 */
  function itemKey(item) {
    return `${item.scope}|${item.scopeId}|${item.peer}|${item.slot}|${item.text}`
  }

  return {
    load,
    snapshot: () => cache ?? defaultMemory(now()),
    async remember(input) {
      const current = await load()
      const at = now()
      const item = normalizeItem({ ...input, at: input?.at ?? at, lastAt: at }, at)
      if (item === null) return current
      const key = itemKey(item)
      const same = current.items.find(
        (existing) => existing.id === item.id || itemKey(existing) === key,
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
    /*
     * MEM-107：把条目放进提示词后应算一次「被想起」——模型在对话里引用一条记忆时，
     * 它该更牢一点，而不是只有用户原话再次出现才涨。
     * 检索消费点（把召回结果写进提示词之后）调用 touch(item.id)：
     * lastAt 推进到此刻、mentions +1，衰减与排序都会把它算作「刚被想起」。
     * 消费点在 chat.mjs / companion-runtime.mjs，不归本文件改，留这个口子给它们接。
     */
    async touch(id) {
      const current = await load()
      const target = current.items.find((item) => item.id === id)
      if (target === undefined) return { ok: false, reason: 'not-found' }
      const at = now()
      const items = current.items.map((item) =>
        item.id === id ? { ...item, lastAt: at, mentions: item.mentions + 1 } : item,
      )
      const next = pruneMemory({ ...current, updatedAt: at, items }, at)
      await queue(next)
      return { ok: true, id }
    },
    /* 观察台用：三栏树 + 计数 + 最近活动，不含条目正文 */
    async listScopes() {
      const current = await load()
      const owners = new Map()
      const privates = new Map()
      const groups = new Map()
      for (const item of current.items) {
        const lastAt = Number(item.lastAt || item.at || 0)
        if (item.scope === 'owner') {
          const entry = owners.get(item.scopeId) ?? { scopeId: item.scopeId, count: 0, lastAt: 0 }
          entry.count += 1
          entry.lastAt = Math.max(entry.lastAt, lastAt)
          owners.set(item.scopeId, entry)
        } else if (item.scope === 'private') {
          const entry = privates.get(item.scopeId) ?? { scopeId: item.scopeId, count: 0, lastAt: 0 }
          entry.count += 1
          entry.lastAt = Math.max(entry.lastAt, lastAt)
          privates.set(item.scopeId, entry)
        } else if (item.scope === 'group') {
          const entry = groups.get(item.scopeId) ?? {
            scopeId: item.scopeId,
            count: 0,
            lastAt: 0,
            peers: new Map(),
          }
          entry.count += 1
          entry.lastAt = Math.max(entry.lastAt, lastAt)
          const peerKey = item.peer === '' ? '' : item.peer
          const peerEntry = entry.peers.get(peerKey) ?? { peer: peerKey, count: 0, lastAt: 0 }
          peerEntry.count += 1
          peerEntry.lastAt = Math.max(peerEntry.lastAt, lastAt)
          entry.peers.set(peerKey, peerEntry)
          groups.set(item.scopeId, entry)
        }
      }
      /* 主人 / 私聊按 scopeId 排，群内发言人没有 scopeId，退回 peer */
      const byRecent = (a, b) => {
        const diff = b.lastAt - a.lastAt
        if (diff !== 0) return diff
        const left = String(a.scopeId ?? a.peer ?? '')
        const right = String(b.scopeId ?? b.peer ?? '')
        return left.localeCompare(right)
      }
      return {
        owners: [...owners.values()].sort(byRecent),
        privates: [...privates.values()].sort(byRecent),
        groups: [...groups.values()]
          .map((entry) => ({
            ...entry,
            peers: [...entry.peers.values()]
              .filter((peer) => peer.peer !== '')
              .sort(byRecent),
          }))
          .sort(byRecent),
      }
    },
    /* 把某个群里攒下的原话压成一条摘要，固定条目不动 */
    async digest(scope, scopeId) {
      const current = await load()
      const pool = current.items.filter(
        (item) => item.scope === scope && item.scopeId === scopeId && item.kind === 'raw' && !item.pinned,
      )
      const summary = buildDigest(pool, now())
      if (summary === null) return { changed: false, text: '', removed: 0 }
      const at = now()
      const items = current.items.filter((item) => !pool.includes(item)).concat(summary)
      const next = pruneMemory({ ...current, updatedAt: at, items }, at)
      await queue(next)
      return { changed: true, text: summary.text, removed: pool.length }
    },
  }
}
