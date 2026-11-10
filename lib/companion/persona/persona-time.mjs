/**
 * 人格时区：日程、开口额度、重聚标记都按这里算。
 *
 * 用具名时区而不是机器本地时区：机器换城市不换 TZ 时应当跟着人走，
 * 而本地时区在带夏令时的地区会季节漂移，「今天」不该一年错两次。
 *
 * Asia/Shanghai 没有夏令时，取值与旧 shanghaiDay 完全一致，
 * 升级时已有的额度账本不用迁移。
 *
 * 注意：这里只统一「按日期字符串取键」的地方。由头抖动用 lastOpenAt
 * 这种绝对时间戳做种子，和时区无关，不要在改动时顺手换算。
 */

export const PERSONA_TIMEZONE = 'Asia/Shanghai'

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: PERSONA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: PERSONA_TIMEZONE,
  hour: '2-digit',
  hourCycle: 'h23',
})

/** 人格时区下的日历日；返回 null 表示这个时刻无法解析。 */
export function personaDay(now = Date.now()) {
  const parts = {}
  for (const part of DAY_FORMAT.formatToParts(new Date(now))) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') parts[part.type] = part.value
  }
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return { year, month, day, key: `${parts.year}-${parts.month}-${parts.day}` }
}

/**
 * 人格时区下的日期键 YYYY-MM-DD。
 * 额度重置、由头去重、重聚标记都用它，保证同一刻只有一种「今天」。
 */
export function personaDayKey(now = Date.now()) {
  const day = personaDay(now)
  if (day !== null) return day.key
  /* 解析失败时退回 UTC 日，宁可错一天也不要抛出去打断开口。 */
  return new Date(now).toISOString().slice(0, 10)
}

/** 人格时区下的小时 0~23，用于开口时段判断。 */
export function personaHour(now = Date.now()) {
  const value = Number(HOUR_FORMAT.format(new Date(now)))
  if (Number.isFinite(value)) return value
  return new Date(now).getHours()
}
