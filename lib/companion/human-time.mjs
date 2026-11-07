/**
 * 把时间说成人话。
 *
 * 近几天用「今天 / 昨天 / 前天 / 大前天」，往后用「明天 / 后天 / 大后天」；
 * 再远一点按周说「上周三 / 上上周三」；
 * 更远只说到「月初 / 中旬 / 月底」，不报具体哪一天。
 *
 * 她记住一件事的时候，更该记得是「前天你说要交东西」，
 * 而不是「2026-11-05T13:40:00Z」。
 */

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function asStamp(value) {
  const ms = Number(value)
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** 当天零点，用来按「天」求差，不受具体时刻影响。 */
function dayStart(ms) {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** 这一周的周一零点；周日算上一周的结尾。 */
function weekStart(ms) {
  const start = dayStart(ms)
  const weekday = new Date(start).getDay()
  const offset = weekday === 0 ? 6 : weekday - 1
  return start - offset * DAY_MS
}

/** 一个月里只说三段，够用了。 */
function monthPhase(day) {
  if (day <= 5) return '初'
  if (day >= 25) return '底'
  return '中旬'
}

/** 「周三」→「三」，用来拼「上周三」而不是「上周周三」。 */
function weekdayShort(ms) {
  const label = WEEKDAYS[new Date(ms).getDay()]
  const short = label.slice(1)
  return short === '日' ? '日' : short
}

/**
 * 只说到「哪一天」这一层，不带时刻。
 * @param {number|string} stamp 目标时间（毫秒）
 * @param {number} now 参照时间（毫秒），默认现在
 */
export function humanDay(stamp, now = Date.now()) {
  const ms = asStamp(stamp)
  const base = asStamp(now) || Date.now()
  if (ms === 0) return ''

  const diff = Math.round((dayStart(ms) - dayStart(base)) / DAY_MS)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  if (diff === -2) return '前天'
  if (diff === -3) return '大前天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === 3) return '大后天'

  const weeks = Math.round((weekStart(ms) - weekStart(base)) / (7 * DAY_MS))
  if (weeks === 0) return WEEKDAYS[new Date(ms).getDay()]
  if (weeks === -1) return `上周${weekdayShort(ms)}`
  if (weeks === -2) return `上上周${weekdayShort(ms)}`
  if (weeks === 1) return `下周${weekdayShort(ms)}`
  if (weeks === 2) return `下下周${weekdayShort(ms)}`

  const date = new Date(ms)
  const sameYear = date.getFullYear() === new Date(base).getFullYear()
  const prefix = sameYear ? '' : '去年 '
  return `${prefix}${date.getMonth() + 1} 月${monthPhase(date.getDate())}`
}

/** 一天里的说法规矩：口语里先说到时段，再说到钟点。 */
function periodOf(hour) {
  if (hour < 5) return '凌晨'
  if (hour < 9) return '早上'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 20) return '傍晚'
  return '晚上'
}

/** 这些日子离得近，钟点和时段一起说才像人话。 */
const NEAR_DAYS = new Set(['今天', '昨天', '前天', '大前天', '明天', '后天', '大后天'])

/**
 * 「今天早上 8:03」「昨晚 11:05」这种说法。
 * 远一点的日子仍然带 24 小时制时刻，看得清又不绕。
 * @param {number|string} stamp 目标时间（毫秒）
 * @param {number} now 参照时间（毫秒），默认现在
 */
export function humanTime(stamp, now = Date.now()) {
  const ms = asStamp(stamp)
  if (ms === 0) return ''
  const day = humanDay(ms, now)
  if (day === '') return ''

  const date = new Date(ms)
  const hour = date.getHours()
  const minute = String(date.getMinutes()).padStart(2, '0')
  if (!NEAR_DAYS.has(day)) {
    return `${day} ${String(hour).padStart(2, '0')}:${minute}`
  }

  const period = periodOf(hour)
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${minute}`
  // 「昨天 + 晚上」说成「昨晚」，其余照常拼。
  const head = day === '昨天' && period === '晚上' ? '昨晚' : `${day}${period}`
  return `${head} ${clock}`
}
