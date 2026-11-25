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
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'

/* 默认走真实文件系统；companion-runtime 会注入密封层，把每个文件先加密再落盘。 */
const defaultIO = { mkdir, readdir, readFile, rename, unlink, writeFile }
import { dirname } from 'node:path'
import { MEMORY as MEMORY_STANDARD, TIME } from '../standard.mjs'
import { halfLifeDaysOf } from '../persona/traits.mjs'
/* B2-006：整行只剩媒体占位标记的句子不算一条记忆正文；识别式与生成侧同源。 */
import { isMediaNoteOnly } from './media-note.mjs'
/* 13 槽声明表是分类唯一事实源：词表、中文名、启用态都从这里派生。 */
import {
  ENABLED_SLOT_IDS,
  ALL_SLOT_IDS,
  migrateSlotId
} from './memory-slots.mjs'
/* B2-001：脱敏单点。QQ 链不经抽取直接写记忆，那道闸必须由写入边界自己站住，
 * 与 memory-extract 共用同一份实现，不留第二份。 */
import { scrub } from './scrub.mjs'

export const MEMORY_VERSION = 1
/* 可落盘的槽 = 13 槽里的启用 7；旧 relation 条目在读取时迁移进 relationship 保留。 */
export const SLOTS = [...ENABLED_SLOT_IDS]
export const SOURCES = ['session', 'pet', 'manual']
/* 记忆归属：主人本人 / 某人的私聊 / 某个群 */
export const SCOPES = ['owner', 'private', 'group']
/* 这条记忆是从哪条线上来的 */
export const CHANNELS = ['qq', 'desk', 'dsh']
/* raw = 原话片段，digest = 一份压缩后的群聊摘要 */
export const KINDS = ['raw', 'digest']
/* 容量与正文上限统一取自 standard；这里只做常量导出兼容旧引用。 */
export const MAX_TEXT = MEMORY_STANDARD.textLimit
export const MAX_ITEMS = MEMORY_STANDARD.ownerItems
export const PRIVATE_ITEMS = MEMORY_STANDARD.privateItems
export const GROUP_ITEMS = MEMORY_STANDARD.groupItems
export const MAX_TOTAL = MEMORY_STANDARD.totalItems
/*
 * 时间衰减半衰期：30 天没再被提起，时间分掉一半。
 * 具体形状（死区 0.15、满量程 ±1/6）的唯一实现放在 traits 里，
 * 标准值放在 standard，这里保持旧导出名可用。
 */
export const HALF_LIFE_DAYS = MEMORY_STANDARD.recallHalfLifeDays
/* 低于这个权重、又超过 KEEP_DAYS 的未固定条目，会在 prune 时清掉 */
export const MIN_WEIGHT = MEMORY_STANDARD.minWeight
export const KEEP_DAYS = MEMORY_STANDARD.keepDays

const DAY = TIME.DAY

export function defaultMemory(now = Date.now()) {
  return { version: MEMORY_VERSION, updatedAt: now, items: [] }
}

function safeText(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeItem(raw, now) {
  if (raw === null || typeof raw !== 'object') return null
  /* 读取走迁移：旧键 relation → relationship；13 槽（含备用）都保留，未知槽丢。 */
  const migrated = migrateSlotId(raw.slot)
  const slot = ALL_SLOT_IDS.includes(migrated) ? migrated : null
  /* 群摘要是一条压缩记录，允许比普通原话更长；普通条目仍用统一正文上限。 */
  const textLimit = raw.kind === 'digest' ? MEMORY_STANDARD.recallRanking.digestTotalLimit : MAX_TEXT
  /* B2-001：脱敏走在截断前面——反过来会把长串里的敏感信息切成不匹配的残片留在库里。
   * QQ 链不经抽取直接写记忆，这道闸由写入边界自己站住，与抽取链共用 scrub.mjs 那一份。 */
  const text = safeText(scrub(raw.text), textLimit)
  /* B2-006：整行只有 [图片] / [图片x3] 的句子没有可记的话，落库只会让召回与提示词
   * 多出一条空壳；图文混排（「真好看 [图片]」）仍照旧收下。 */
  if (slot === null || text === '' || isMediaNoteOnly(text)) return null
  const at = Number.isFinite(Number(raw.at)) ? Number(raw.at) : now
  const lastAt = Number.isFinite(Number(raw.lastAt)) ? Number(raw.lastAt) : at
  return {
    id: safeText(raw.id, MEMORY_STANDARD.idTextLimit) || `m-${at}-${Math.random().toString(36).slice(2, 2 + MEMORY_STANDARD.idRandomLength)}`,
    slot,
    text,
    source: SOURCES.includes(raw.source) ? raw.source : 'session',
    /* 旧数据没有 scope，一律当作主人记忆，迁移零丢失 */
    scope: SCOPES.includes(raw.scope) ? raw.scope : 'owner',
    scopeId: safeText(raw.scopeId, MEMORY_STANDARD.idTextLimit),
    peer: safeText(raw.peer, MEMORY_STANDARD.idTextLimit),
    kind: KINDS.includes(raw.kind) ? raw.kind : 'raw',
    channel: CHANNELS.includes(raw.channel) ? raw.channel : '',
    at,
    lastAt,
    mentions: Math.max(MEMORY_STANDARD.mentionMin, Math.trunc(Number(raw.mentions) || MEMORY_STANDARD.mentionMin)),
    pinned: raw.pinned === true,
    /* 冷记忆只在读取时判定，不落盘：固定的条目永不算冷。 */
    cold: raw.pinned !== true && now - lastAt >= MEMORY_STANDARD.coldAfterDays * DAY,
    /* 抽取侧给的证据与置信度跟着落盘：注入层和候选分流都要用，不能在这一层丢掉。 */
    confidence: Number.isFinite(Number(raw.confidence))
      ? Math.min(1, Math.max(0, Number(raw.confidence)))
      : null,
    evidence: safeText(scrub(raw.evidence), MEMORY_STANDARD.evidenceTextLimit),
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
  const mentions = Math.max(MEMORY_STANDARD.mentionMin, Math.trunc(Number(item.mentions) || MEMORY_STANDARD.mentionMin))
  const mentionScore = 1 - Math.exp(-mentions / MEMORY_STANDARD.recallRanking.mentionSaturation)
  const ageDays = Math.max(0, (now - Number(item.lastAt || item.at || now)) / DAY)
  /*
   * 死区内不抬不压；死区外把 0.15..1 线性铺到 0..1，
   * 再收进 ±1/6，对应半衰期 25 ~ 35 天（封顶 1.17x，偏移 ±5 天）。
   * 形状只写在 traits 里，这里取现成的。
   */
  const halfLife = halfLifeDaysOf(bias)
  const recency = Math.pow(0.5, ageDays / halfLife)
  const mix = MEMORY_STANDARD.recallRanking
  return Number((mix.mentionWeight * mentionScore + mix.recencyWeight * recency).toFixed(MEMORY_STANDARD.scoreDecimals))
}

/* 中文没有空格：用两字切片做粗粒度重合，英文/数字按空格词处理 */
function grams(text) {
  const lower = String(text).toLowerCase()
  const set = new Set()
  const minLength = MEMORY_STANDARD.recallRanking.gramMinLength
  for (const word of lower.split(/\s+/)) {
    if (word.length >= minLength) set.add(word)
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
   *
   * 权重与精度仍从 MEMORY_STANDARD.recallRanking 取，不在函数里写死——
   * 远端那版的 0.75 / 0.25 / 4 与本配置同值，合并后只保留配置这一处来源。
   */
  const chars = Array.from(String(query ?? '').replace(/\s+/g, '')).length
  const short = chars < 4
  const overlap = short
    ? (2 * hit) / Math.max(1, queryGrams.size + textGrams.size)
    : hit / queryGrams.size
  const mix = MEMORY_STANDARD.recallRanking
  const relatedWeight = short ? mix.overlapWeight / 2 : mix.overlapWeight
  // MEM-083：检索路径可选注入人格念旧偏置，默认 0 时与旧行为完全一致。
  return Number((overlap * relatedWeight + weightOf(item, now, recallBias) * mix.weightWeight).toFixed(MEMORY_STANDARD.scoreDecimals))
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
    limit = MEMORY_STANDARD.recallLimit,
    now = Date.now(),
    minScore = MEMORY_STANDARD.recallMinScore,
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
    .slice(0, Math.max(MEMORY_STANDARD.recallMinLimit, limit))
  return scored.map((entry) => ({ ...entry.item, weight: entry.weight, score: entry.score }))
}

/* 清掉又久又轻、且没有固定的条目；固定与近期的一律保留 */
export function pruneMemory(memory, now = Date.now()) {
  const source = normalizeMemory(memory, now)
  const kept = source.items.filter((item) => {
    if (item.pinned) return true
    /* 久且轻才清；关掉的槽只影响注入与显示，能不能留下仍按同一条标准判。 */
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
  const mix = MEMORY_STANDARD.recallRanking
  if (raw.length < mix.digestMinRaw) return null
  /* 摘要只能压同一个物理桶：跨群或群聊混私聊时宁可不压，也不把别人的话带出去。 */
  const scope = raw[0].scope
  const scopeId = raw[0].scopeId
  if (raw.some((item) => item.scope !== scope || item.scopeId !== scopeId)) return null
  const byPeer = new Map()
  for (const item of raw) {
    const key = item.peer === '' ? '其他人' : item.peer
    if (!byPeer.has(key)) byPeer.set(key, [])
    byPeer.get(key).push(item)
  }
  const parts = []
  /* 先按最后一句的时间排人：摘要长度有限时，至少让最近说话的人留下来。
     远端把每人窗口从 3 句 × 30 字抬到 6 句 × 60 字，方向一致；
     这里保留排序与限人结构，密度走 recallRanking.digestRecent / digestTextLimit，
     两个值已在 standard.mjs 对齐到远端那一档。 */
  const peers = [...byPeer.entries()]
    .map(([peer, items]) => {
      const ordered = items
        .slice()
        .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
      return {
        peer,
        items: ordered,
        lastAt: Number(ordered[ordered.length - 1]?.at) || 0,
      }
    })
    .sort((a, b) => b.lastAt - a.lastAt)
  const selected = peers.slice(0, mix.digestPeerLimit)
  for (const { peer, items } of selected) {
    const recent = items
      .slice(-mix.digestRecent)
      .map((item) => item.text.replace(/\s+/g, ' ').slice(0, mix.digestTextLimit))
      .join('；')
    parts.push(`${peer}：${recent}`)
  }
  const others = peers.length - selected.length
  const header = `群里最近聊到 —— 共 ${raw.length} 条 / ${peers.length} 人：`
  const tail = others > 0 ? ` / 另有 ${others} 人` : ''
  const text = `${header}${parts.join(' / ')}${tail}`.slice(0, mix.digestTotalLimit)
  const at = now
  return normalizeItem(
    {
      slot: 'event',
      text,
      source: 'session',
      scope,
      scopeId,
      peer: '',
      kind: 'digest',
      channel: 'qq',
      at,
      mentions: 1,
    },
    at,
  )
}

/* ------------------------------------------------------------------ *
 * 物理分区
 *
 * 主文件是完整快照，方便迁移与恢复；分区文件是落盘隔离层：
 * 主人、每个私聊对象、每个群各自一个文件，互不覆盖。加载时按清单合并，
 * 单个桶写坏只会少那一个桶，不会把内容串进别的桶。
 * 文件名只用哈希，不把 openid 直接写进路径。
 * ------------------------------------------------------------------ */

function hashKey(text) {
  let hash = 0x811c9dc5
  const source = String(text ?? '')
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 把一份完整记忆拆成物理桶；只读，不落盘。 */
export function splitMemoryBuckets(memory) {
  const buckets = new Map()
  for (const item of Array.isArray(memory?.items) ? memory.items : []) {
    const scope = item.scope ?? 'owner'
    const key = scope === 'owner' ? 'owner' : `${scope}:${item.scopeId ?? ''}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(item)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, items]) => ({ key, items }))
}

export function partitionFileName(key) {
  if (key === MEMORY_STANDARD.partition.owner) return `${MEMORY_STANDARD.partition.owner}.json`
  const [scope, ...rest] = String(key).split(':')
  const id = rest.join(':')
  if (scope === 'private') return `${MEMORY_STANDARD.partition.privatePrefix}${hashKey(id)}.json`
  if (scope === 'group') return `${MEMORY_STANDARD.partition.groupPrefix}${hashKey(id)}.json`
  return `${scope}-${hashKey(id)}.json`
}

/** 每个桶单独原子写入；写完后删掉已经空掉的旧桶文件，避免旧数据留在盘上。 */
export async function persistPartitions(dir, memory, io = defaultIO) {
  await io.mkdir(dir, { recursive: true })
  const expected = new Set()
  const keys = []
  for (const bucket of splitMemoryBuckets(memory)) {
    const name = partitionFileName(bucket.key)
    expected.add(name)
    keys.push(bucket.key)
    const target = `${dir}/${name}`
    const payload = {
      version: memory?.version ?? MEMORY_VERSION,
      key: bucket.key,
      updatedAt: memory?.updatedAt ?? Date.now(),
      items: bucket.items,
    }
    const temp = `${target}.tmp`
    await io.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await io.rename(temp, target)
  }

  /*
   * 清单最后写：只有所有桶都落盘成功，才把这次更新标成「可读」。
   * 半途失败时旧清单还在，加载会按时间戳回落到主文件，不会读到半份数据。
   */
  const manifest = {
    version: memory?.version ?? MEMORY_VERSION,
    updatedAt: memory?.updatedAt ?? Date.now(),
    keys,
  }
  const manifestTemp = `${dir}/_manifest.json.tmp`
  await io.writeFile(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await io.rename(manifestTemp, `${dir}/_manifest.json`)

  /* 只清理这个目录里由本模块生成的桶文件；别的文件不碰。 */
  let names = []
  try {
    names = await io.readdir(dir)
  } catch {
    return
  }
  const ownerFile = `${MEMORY_STANDARD.partition.owner}.json`
  const isPartitionFile = (name) => {
    if (name === ownerFile) return true
    const prefixes = [
      MEMORY_STANDARD.partition.privatePrefix,
      MEMORY_STANDARD.partition.groupPrefix,
    ]
    return prefixes.some((prefix) => {
      if (!name.startsWith(prefix) || !name.endsWith('.json')) return false
      const hash = name.slice(prefix.length, -'.json'.length)
      return /^[0-9a-f]{8}$/.test(hash)
    })
  }
  for (const name of names) {
    if (!isPartitionFile(name)) continue
    if (expected.has(name)) continue
    try {
      await io.unlink(`${dir}/${name}`)
    } catch {
      /* 单个旧文件删不掉，不影响这次写入。 */
    }
  }
}

/**
 * 从分区文件恢复一份完整记忆。
 *
 * 只认带清单的目录：清单是「上一次完整写入」的凭据，没有它就不猜，
 * 让调用方回落到主文件。这样单个桶写坏时不会把半份记忆当成全部。
 */
export async function loadPartitions(dir, now = Date.now(), io = defaultIO) {
  let manifest
  try {
    manifest = JSON.parse(await io.readFile(`${dir}/_manifest.json`, 'utf8'))
  } catch {
    return null
  }
  if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.keys)) return null
  const items = []
  for (const key of manifest.keys) {
    /* 清单只认三种桶；防止坏清单把路径带到目录外。 */
    const text = String(key)
    const valid = text === MEMORY_STANDARD.partition.owner ||
      /^(private|group):.+/.test(text)
    if (!valid) continue
    const name = partitionFileName(text)
    try {
      const payload = JSON.parse(await io.readFile(`${dir}/${name}`, 'utf8'))
      if (Array.isArray(payload?.items)) items.push(...payload.items)
    } catch {
      /* 单个桶坏了就跳过；清单仍在，至少其他桶还能读。 */
    }
  }
  return normalizeMemory(
    {
      version: manifest.version ?? MEMORY_VERSION,
      updatedAt: manifest.updatedAt,
      items,
    },
    now,
  )
}

export function createMemoryStore({ filePath, partitionDir = '', readText, writeText, io = defaultIO, now = () => Date.now() } = {}) {
  const viaAdapter = typeof readText === 'function' && typeof writeText === 'function'
  if (!viaAdapter && (typeof filePath !== 'string' || filePath === '')) {
    throw new Error('memory-store 需要注入 filePath，或 readText / writeText')
  }
  let cache = null
  let writing = Promise.resolve()

  async function load() {
    if (cache !== null) return cache

    if (viaAdapter) {
      try {
        const text = await readText()
        cache = typeof text === 'string' && text.trim() !== ''
          ? normalizeMemory(JSON.parse(text), now())
          : defaultMemory(now())
      } catch {
        cache = defaultMemory(now())
      }
      return cache
    }

    let fromMain = null
    try {
      const text = await io.readFile(filePath, 'utf8')
      if (typeof text === 'string' && text.trim() !== '') {
        fromMain = normalizeMemory(JSON.parse(text), now())
      }
    } catch {
      /* 主文件丢了或坏了，继续看分区；两边都没有才回空记忆。 */
    }

    const fromPartitions = partitionDir === '' ? null : await loadPartitions(partitionDir, now(), io)
    if (
      fromPartitions !== null &&
      (fromMain === null || Number(fromPartitions.updatedAt) >= Number(fromMain.updatedAt))
    ) {
      cache = fromPartitions
    } else {
      cache = fromMain ?? defaultMemory(now())
    }
    return cache
  }

  async function persist(memory) {
    const text = `${JSON.stringify(memory, null, 2)}\n`
    if (viaAdapter) {
      await writeText(text)
      return
    }
    await io.mkdir(dirname(filePath), { recursive: true })
    const temp = `${filePath}.tmp`
    await io.writeFile(temp, text, 'utf8')
    await io.rename(temp, filePath)
    /* 分区文件是「物理隔离」那一层：每个桶单独一个文件，互不覆盖。 */
    if (partitionDir !== '') {
      try {
        await persistPartitions(partitionDir, memory, io)
      } catch {
        /* 分区写失败不回滚主文件：主文件仍是一份完整快照。 */
      }
    }
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
      /* 新写入只收启用槽；旧键先迁移（relation → relationship 属备用槽，新写不再收）。 */
      const slot = migrateSlotId(input?.slot)
      if (!ENABLED_SLOT_IDS.includes(slot)) return current
      const item = normalizeItem({ ...input, slot, at: input?.at ?? at, lastAt: at }, at)
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
                /* 重复命中取更高置信度；旧条目没有证据时补上这次的原话。 */
                confidence:
                  existing.confidence === null || item.confidence === null
                    ? (existing.confidence ?? item.confidence)
                    : Math.max(existing.confidence, item.confidence),
                evidence: existing.evidence !== '' ? existing.evidence : item.evidence,
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
    /* 恢复备份保留原样：清理只在日常写入时发生，导入历史不该被悄悄删掉。 */
    async replace(input) {
      const next = normalizeMemory(
        { ...input, version: MEMORY_VERSION, updatedAt: now() },
        now(),
      )
      await queue(next)
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
