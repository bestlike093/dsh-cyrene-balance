/**
 * 注入侧：把记忆条目压成「会被模型看见的那几行」。
 *
 * 约束：
 * - 只读条目已有字段，不新造信息；
 * - 同一条记忆的确定程度不同，前缀不同，让模型知道该不该主动提；
 * - 纯函数，不碰存储，便于单独验证。
 */
import { slotWeight } from './memory-slots.mjs'
import { MEMORY, TIME } from '../standard.mjs'
import { halfLifeDaysOf } from '../persona/traits.mjs'

/**
 * 前缀表示「这条记忆有多确定」：
 * 钉住的是她特意留的，冷掉的先放着，反复想起的不用说也懂。
 */
export function memoryLinePrefix(item) {
  if (item?.pinned === true) return '（她特意留住的）'
  if (item?.cold === true) return '（很久没提起了）'
  if (Number(item?.recallCount ?? item?.mentions ?? 0) >= MEMORY.mentionPrefixThreshold) return '（常常想起）'
  return ''
}

/* 字段缺失时按 0 处理：否则 NaN 参与比较会让整个排序失效。 */
function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

/* 只留文字：标点、空白不参与匹配，避免「猫。」和「猫」被当成两回事。 */
function normalized(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/* 中文没有天然词边界，用相邻 N 字做轻量召回；单字查询保留单字。 */
function queryGrams(query) {
  const text = normalized(query)
  if (text === '') return []
  if (text.length === 1) return [text]
  const size = Math.max(1, Math.floor(MEMORY.recallRanking.gramMinLength))
  const grams = new Set()
  for (let index = 0; index < text.length - size + 1; index += 1) {
    grams.add(text.slice(index, index + size))
  }
  return [...grams]
}

function relevanceOf(text, grams, wholeQuery) {
  if (grams.length === 0) return 0
  const haystack = normalized(text)
  if (haystack === '') return 0
  if (wholeQuery.length >= MEMORY.recallRanking.wholeQueryMinLength && haystack.includes(wholeQuery)) return 1
  let hits = 0
  for (const gram of grams) {
    if (haystack.includes(gram)) hits += 1
  }
  return hits / grams.length
}

function clamp01(value) {
  return Math.min(1, Math.max(0, toNumber(value)))
}

/* 提及次数取对数：前几次很明显，后面只做缓慢累加，不会一条老事压满全场。 */
function mentionScore(value) {
  const cap = MEMORY.ranking.mentionsCap
  if (cap <= 0) return 0
  const count = Math.min(cap, Math.max(0, toNumber(value)))
  return (Math.log10(1 + count) / Math.log10(1 + cap)) * MEMORY.ranking.mentions
}

/*
 * 时间只做分档微调；太旧的条目不再因为「日期新」占便宜。
 *
 * 人格的念旧 / 向前不改标准窗口，只把「实际年龄」按半衰期比例投影：
 * 念旧时半衰期变长，同样的 32 天在排序里按更年轻算；向前时反过来。
 * 这样记忆该不该留仍由标准决定，只有「谁先被想起」受人格影响。
 */
function recencyScore(value, bias = 0) {
  const at = toNumber(value)
  if (at <= 0) return 0
  const halfLife = halfLifeDaysOf(bias)
  const ageDays = ((Date.now() - at) / TIME.DAY) * (MEMORY.recallHalfLifeDays / halfLife)
  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > MEMORY.ranking.recencyWindowDays) {
    return 0
  }
  for (const bucket of MEMORY.ranking.recencyBuckets) {
    if (ageDays <= bucket.withinDays) return bucket.score
  }
  return MEMORY.ranking.recencyFallback
}

function lineScore(entry, bias = 0) {
  const item = entry.item
  const pinned = item?.pinned === true ? MEMORY.ranking.pinned : 0
  const relevance = entry.relevance * MEMORY.ranking.relevance
  const confidence = clamp01(item?.confidence) * MEMORY.ranking.confidence
  const slot = slotWeight(item?.slot ?? item?.kind) * MEMORY.ranking.slot
  const mentions = mentionScore(item?.recallCount ?? item?.mentions)
  const recency = recencyScore(item?.lastAt ?? item?.at, bias) * MEMORY.ranking.recency
  const cold = item?.cold === true ? MEMORY.ranking.coldPenalty : 0
  return pinned + relevance + confidence + slot + mentions + recency - cold
}

/**
 * 排序并保留每条的记忆字段：供注入行与脉络共用一次排序结果，
 * 避免「人格里看到的一行」和「脉络里判断的那条」不是同一批。
 */
export function rankMemoryEntries(items, limit = MEMORY.promptLimit, query = '', recallBias = 0) {
  const max = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : MEMORY.promptLimit)
  const grams = queryGrams(query)
  const wholeQuery = normalized(query)
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      item,
      text: String(item?.text ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((entry) => entry.text !== '')
    .map((entry) => ({
      ...entry,
      relevance: relevanceOf(entry.text, grams, wholeQuery),
    }))
    .map((entry) => ({ ...entry, score: lineScore(entry, recallBias) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        toNumber(b.item?.pinned) - toNumber(a.item?.pinned) ||
        b.relevance - a.relevance ||
        toNumber(b.item?.confidence) - toNumber(a.item?.confidence) ||
        toNumber(b.item?.mentions) - toNumber(a.item?.mentions) ||
        toNumber(b.item?.lastAt) - toNumber(a.item?.lastAt),
    )
    .slice(0, max)
}

/*
 * 排序：各项按 standard 的权重相加，分数越高越靠前。
 * 固定条目仍是硬门槛；相关度、置信度、槽权重是主项；提及与时间只做细调。
 * 先剔空再截断，避免空条目占掉名额。
 * query 为空时相关度为 0，排序退化成「固定 → 置信度 → 槽权重 → 提及 → 时间」。
 */
export function rankMemoryLines(items, limit = MEMORY.promptLimit, query = '', recallBias = 0) {
  return rankMemoryEntries(items, limit, query, recallBias).map(
    (entry) => `${memoryLinePrefix(entry.item)}${entry.text}`,
  )
}
