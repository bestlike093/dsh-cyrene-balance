/**
 * 余额账本 v1。
 *
 * 切片按本地日切：`date` 只写 YYYY-MM-DD，`tz` 记 IANA 时区名。
 * 不把日期存成时间戳，跨时区机器上「最近 7 天」才不会滑成 6~8 天。
 *
 * `fetchedAt` 是本次查询的 epoch 毫秒；旧 v0 账本没有这个字段，迁移时写 0 表示未知。
 * `acknowledgedAt` / `lastAlertedAt` 是 ISO 字符串或 null。
 *
 * 告警契约（c 刀使用）：
 * shouldAlert = balance <= threshold && !acknowledgedAt && lastAlertedAt == null
 * 同一段低额只响一次；新的一天重建切片后 acknowledgedAt 自然清空。
 */

export const LEDGER_VERSION = 1
export const LEDGER_WINDOW_DAYS = 7

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asIsoOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/** 严格校验 YYYY-MM-DD，返回 UTC 日序号；非法日期返回 null。 */
function dayNumber(key) {
  if (!DATE_KEY.test(key)) return null
  const [year, month, day] = key.split('-').map(Number)
  const stamp = Date.UTC(year, month - 1, day)
  const check = new Date(stamp)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return Math.floor(stamp / DAY_MS)
}

export function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** 指定时区的本地日期串；时区名非法时回退到系统本地日。 */
export function dateKeyInTimeZone(now = new Date(), timeZone = systemTimeZone()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now)
    const pick = (type) => parts.find((part) => part.type === type)?.value ?? ''
    const year = pick('year')
    const month = pick('month')
    const day = pick('day')
    if (year !== '' && month !== '' && day !== '') return `${year}-${month}-${day}`
  } catch {
    // 非法时区名不阻断账本读取，退回系统本地日。
  }
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createEmptyLedger() {
  return { version: LEDGER_VERSION, slices: {} }
}

function normalizeSlice(key, raw, timeZone) {
  if (!isRecord(raw)) return null
  const balance = asFiniteNumber(raw.balance)
  if (balance === null) return null
  return {
    date: key,
    tz: typeof raw.tz === 'string' && raw.tz !== '' ? raw.tz : timeZone,
    fetchedAt: asFiniteNumber(raw.fetchedAt) ?? 0,
    balance,
    threshold: asFiniteNumber(raw.threshold),
    acknowledgedAt: asIsoOrNull(raw.acknowledgedAt),
    lastAlertedAt: asIsoOrNull(raw.lastAlertedAt)
  }
}

/**
 * 写入时裁剪：只保留 [今天 - (days - 1), 今天] 的切片。
 * query 侧只读，不在这里计算窗口边界。
 */
export function pruneSlices(slices, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const timeZone = options.timeZone ?? systemTimeZone()
  const days =
    Number.isInteger(options.days) && options.days > 0 ? options.days : LEDGER_WINDOW_DAYS
  const today = dayNumber(dateKeyInTimeZone(now, timeZone))
  if (today === null) return {}

  const cutoff = today - (days - 1)
  const kept = {}
  for (const [key, value] of Object.entries(isRecord(slices) ? slices : {})) {
    const day = dayNumber(key)
    if (day === null || day < cutoff || day > today) continue
    kept[key] = value
  }
  return kept
}

/**
 * 裁剪 ack：窗口与 slice 使用同一把 `dateKeyInTimeZone`，避免一个按本地日、
 * 一个按 UTC 日算，跨时区时出现「slice 没了、ack 还在」。
 *
 * `at` 必须是可解析的 ISO 字符串；解析不了或落在窗口外的 ack 直接丢弃。
 * level 只保留 shown / confirmed，其余降级成 shown。
 */
export function pruneAcks(acks, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const timeZone = options.timeZone ?? systemTimeZone()
  const days =
    Number.isInteger(options.days) && options.days > 0 ? options.days : LEDGER_WINDOW_DAYS
  const today = dayNumber(dateKeyInTimeZone(now, timeZone))
  if (today === null) return {}

  const cutoff = today - (days - 1)
  const kept = {}
  for (const [segment, ack] of Object.entries(isRecord(acks) ? acks : {})) {
    if (!isRecord(ack) || typeof ack.at !== 'string' || ack.at === '') continue
    const at = new Date(ack.at)
    if (Number.isNaN(at.getTime())) continue
    const day = dayNumber(dateKeyInTimeZone(at, timeZone))
    if (day === null || day < cutoff || day > today) continue
    kept[segment] = {
      at: ack.at,
      level: ack.level === 'confirmed' ? 'confirmed' : 'shown'
    }
  }
  return kept
}

/**
 * v0（{ date, opening, latest } 单日覆盖）→ v1（slices）。
 * 已经是 v1 时只做字段收敛与裁剪，不重写用户值。
 */
export function migrateLedger(raw, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const timeZone = options.timeZone ?? systemTimeZone()
  if (!isRecord(raw)) return createEmptyLedger()

  if (raw.version === LEDGER_VERSION && isRecord(raw.slices)) {
    const slices = {}
    for (const [key, value] of Object.entries(raw.slices)) {
      if (dayNumber(key) === null) continue
      const slice = normalizeSlice(key, value, timeZone)
      if (slice !== null) slices[key] = slice
    }
    const acks = pruneAcks(raw.acks, { now, timeZone })
    return {
      version: LEDGER_VERSION,
      slices: pruneSlices(slices, { now, timeZone }),
      ...(Object.keys(acks).length === 0 ? {} : { acks })
    }
  }

  const date = typeof raw.date === 'string' && dayNumber(raw.date) !== null ? raw.date : null
  const latest = asFiniteNumber(raw.latest)
  if (date === null || latest === null) return createEmptyLedger()

  const slices = {
    [date]: {
      date,
      tz: timeZone,
      fetchedAt: 0,
      balance: latest,
      threshold: null,
      acknowledgedAt: null,
      lastAlertedAt: null
    }
  }
  return { version: LEDGER_VERSION, slices: pruneSlices(slices, { now, timeZone }) }
}

/** 只读：不计算窗口、不修改账本。 */
export function readSlices(ledger) {
  if (!isRecord(ledger) || !isRecord(ledger.slices)) return []
  return Object.values(ledger.slices)
    .filter((slice) => isRecord(slice) && typeof slice.date === 'string')
    .sort((left, right) => left.date.localeCompare(right.date))
}
