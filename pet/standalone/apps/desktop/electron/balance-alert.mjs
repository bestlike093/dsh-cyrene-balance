/**
 * 余额告警判定纯函数层。
 *
 * c 刀只回答两个问题：
 * - 这一段余额算不算低额（isLow）
 * - 同一个 segment 之前响过没（shouldAlert 的 ack 参数）
 *
 * segment = 判定版本 + 本地日 + 阈值：
 * - 版本放最前，切 v2 时旧键照读，prune 自然裁掉；
 * - 本地日与 slice 的 date 对齐，跨日自然换段；
 * - 阈值进键，改阈值后旧 ack 不再命中，不需要额外失效逻辑。
 *
 * 这一层不读时间、不碰存储、不做 prune；ack 由调用方从独立 key 空间读出来再传。
 */

export const ALERT_RULE_VERSION = 'v1'
export const SEGMENT_SEPARATOR = '@'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 严格校验 YYYY-MM-DD；2 月 30 日这类写法也判非法。 */
function isValidDateKey(key) {
  if (!DATE_KEY.test(key)) return false
  const [year, month, day] = key.split('-').map(Number)
  const stamp = Date.UTC(year, month - 1, day)
  const check = new Date(stamp)
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  )
}

/** 阈值或 nil 规范化；非有限数返回 null。 */
export function normalizeThreshold(value) {
  return asFiniteNumber(value)
}

/**
 * 生成 dedup 段键：`v1@2026-11-02@20`。
 *
 * 阈值直接进键，`20` 与 `20.0` 归一成同一个段；非法日期或阈值返回 null，
 * 由调用方决定是跳过告警还是报错。
 */
export function buildSegment(date, threshold, ruleVersion = ALERT_RULE_VERSION) {
  const day = typeof date === 'string' ? date.trim() : ''
  const limit = asFiniteNumber(threshold)
  const version = typeof ruleVersion === 'string' ? ruleVersion.trim() : ''
  if (!isValidDateKey(day) || limit === null || version === '') return null
  return [version, day, String(limit)].join(SEGMENT_SEPARATOR)
}

/**
 * 解析 dedup 段键，和 buildSegment 共用同一个分隔符。
 * 只接受 `v1@YYYY-MM-DD@number` 三段；格式不对返回 null，由调用方决定 fail-open。
 */
export function parseSegment(segment) {
  if (typeof segment !== 'string') return null
  const parts = segment.split(SEGMENT_SEPARATOR)
  if (parts.length !== 3) return null
  const [version, day, rawThreshold] = parts
  const threshold = asFiniteNumber(rawThreshold)
  if (version === '' || !isValidDateKey(day) || threshold === null) return null
  return { version, date: day, threshold }
}

/**
 * 是否低额。
 *
 * slice.threshold 优先；旧切片没有阈值时用设置里的 fallback。
 * 等于阈值算低额，和 SSOT 的 `balance <= threshold` 一致。
 */
export function isLow(slice, fallbackThreshold = null) {
  const balance = asFiniteNumber(slice?.balance)
  const threshold = asFiniteNumber(slice?.threshold) ?? asFiniteNumber(fallbackThreshold)
  if (balance === null || threshold === null) return false
  return balance <= threshold
}

/**
 * 是否应该响。
 *
 * ack 为 null/undefined 表示这一段还没响过；只要 ack 已存在就不再响，
 * 不拿余额变化重新开段。ack 的形状由存储层决定，这里只判断存在性。
 */
export function shouldAlert(slice, fallbackThreshold = null, ack = null) {
  if (!isLow(slice, fallbackThreshold)) return false
  return ack === null || ack === undefined
}
