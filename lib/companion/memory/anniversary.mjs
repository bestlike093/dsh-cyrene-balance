/**
 * 纪念日：只从「有原话作证」的记忆里认日期，不补、不猜。
 *
 * 认两种写法——带年的 2025-03-23 / 2025年3月23日，和只有月日的 3月23日。
 * 同时还得出现一个纪念词（生日、第一次见面、在一起、搬来、认识、结婚），
 * 否则「3 月 23 日交报告」也会被当成纪念日。
 *
 * 输出只覆盖最近几天：纪念日离得远时提它，只会变成背日历。
 */

/** 先具体、后宽泛：一句话里同时出现「生日」和「认识」时按生日算。 */
const ANCHORS = [
  { pattern: /生日/, label: '对方的生日' },
  { pattern: /(第一次|初次|头一回)(见面|见你|见到你)/, label: '第一次见面' },
  { pattern: /(在一起|确定关系|开始交往)/, label: '在一起' },
  { pattern: /(结婚|领证)/, label: '结婚' },
  { pattern: /(搬来|搬到)/, label: '搬来' },
  { pattern: /认识/, label: '认识' }
]

const FULL_DATE = /(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*[日号]?/
const MONTH_DAY = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/

/** 一年里有没有这一天：2024 是闰年，2 月 29 日能过。 */
function isValidMonthDay(month, day) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new Date(2024, month - 1, day)
  return probe.getMonth() === month - 1 && probe.getDate() === day
}

/** 平年遇到 2 月 29 日时按 2 月 28 日过，不跳到 3 月。 */
function dayInYear(year, month, day) {
  const lastDay = new Date(year, month, 0).getDate()
  const at = new Date(year, month - 1, Math.min(day, lastDay))
  at.setHours(0, 0, 0, 0)
  return at
}

function startOfDay(value) {
  const at = new Date(value)
  at.setHours(0, 0, 0, 0)
  return at
}

/** 从今天起最近的一次；今天正好是的话就是今天。 */
function nextOccurrence(month, day, today) {
  const thisYear = dayInYear(today.getFullYear(), month, day)
  if (thisYear.getTime() >= today.getTime()) return thisYear
  return dayInYear(today.getFullYear() + 1, month, day)
}

/** 从一段文字里读日期；带年的优先，避免把「2025年3月23日」只读成月日。 */
function readDate(text) {
  const full = FULL_DATE.exec(text)
  if (full !== null) {
    const year = Number(full[1])
    const month = Number(full[2])
    const day = Number(full[3])
    if (isValidMonthDay(month, day)) return { year, month, day }
  }
  const monthDay = MONTH_DAY.exec(text)
  if (monthDay !== null) {
    const month = Number(monthDay[1])
    const day = Number(monthDay[2])
    if (isValidMonthDay(month, day)) return { year: null, month, day }
  }
  return null
}

function readLabel(text) {
  for (const anchor of ANCHORS) {
    if (anchor.pattern.test(text)) return anchor.label
  }
  return ''
}

/** 一句话里既要日期，也要纪念词；缺一个都不算。 */
function readFact(fact, today, now) {
  if (fact === null || typeof fact !== 'object') return null
  // 没有原话作证的，只算模型的猜测，不拿来定日子。
  const evidence = typeof fact.evidence === 'string' ? fact.evidence.trim() : ''
  if (evidence === '') return null
  if (Number(fact.confidence) < 0.5) return null

  const text = `${fact.text ?? ''}\n${evidence}`
  const date = readDate(text)
  if (date === null) return null
  const label = readLabel(text)
  if (label === '') return null

  const occurrence = nextOccurrence(date.month, date.day, today)
  const daysUntil = Math.round((occurrence.getTime() - today.getTime()) / 86_400_000)
  const years = date.year === null ? null : occurrence.getFullYear() - date.year

  return {
    label,
    month: date.month,
    day: date.day,
    firstYear: date.year,
    years: years !== null && years > 0 ? years : null,
    daysUntil,
    dateKey: `${date.month}-${date.day}`,
    source: typeof fact.text === 'string' ? fact.text : evidence
  }
}

function describeItem(item) {
  const when = item.daysUntil === 0 ? '今天' : `还有 ${item.daysUntil} 天`
  const ordinal = item.years === null ? '' : `，第 ${item.years} 年`
  return `${when}是${item.label}（${item.month} 月 ${item.day} 日${ordinal}）`
}

/**
 * @param {Array} facts 结构化记忆（memory-facts 的 snapshot().facts）
 * @param {{ now?: number, withinDays?: number }} options
 * @returns {{ items: Array, note: string }}
 */
export function describeAnniversaries(facts, { now = Date.now(), withinDays = 7 } = {}) {
  if (!Array.isArray(facts) || facts.length === 0) return { items: [], note: '' }

  const today = startOfDay(now)
  const byKey = new Map()

  for (const fact of facts) {
    const item = readFact(fact, today, now)
    if (item === null) continue
    if (item.daysUntil < 0 || item.daysUntil > withinDays) continue

    // 同一件事被记过两次时，留更早的那个年份——它更接近「第一次」。
    const key = `${item.label}|${item.dateKey}`
    const existing = byKey.get(key)
    if (existing === undefined || (item.firstYear !== null && (existing.firstYear === null || item.firstYear < existing.firstYear))) {
      byKey.set(key, item)
    }
  }

  const items = [...byKey.values()].sort((a, b) => a.daysUntil - b.daysUntil || a.label.localeCompare(b.label))
  if (items.length === 0) return { items: [], note: '' }

  const lines = items.slice(0, 2).map(describeItem)
  return {
    items,
    note: `${lines.join('；')}。聊到相关的事可以顺口提起，没聊到不用硬转。`
  }
}
