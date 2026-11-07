/**
 * 天气提醒。
 *
 * open-meteo 是免费预报接口，没有气象台那种带编号的预警。这里做的是
 * 「看一眼接下来几小时的数字，把值得说的事挑出来」，所以对外只说预报，
 * 不冒充官方预警，也不把可能说成一定。
 *
 * 只挑一条：气泡里说不了两件事，多了会变成念报告。
 * 同一条时间窗里，严重度高的优先；一样严重就取更早的那个小时。
 */

const HOUR_MS = 60 * 60 * 1000

/** 看未来多少小时。太长会把明天下午的事也拽进现在。 */
export const ALERT_WINDOW_HOURS = 12

/**
 * 规则表。severity 只用于排序，没有对外含义。
 * 阈值取的是「出门会受影响」的保守线，不到线就不提。
 */
const RULES = [
  {
    key: 'thunder',
    label: '雷雨',
    severity: 5,
    match: (hour) => hour.code === 95 || hour.code === 96 || hour.code === 99
  },
  {
    key: 'freeze',
    label: '结冰',
    severity: 5,
    match: (hour) => hour.temperature <= 0 && hour.precipitation > 0
  },
  {
    key: 'downpour',
    label: '强降水',
    severity: 4,
    match: (hour) => hour.precipitation >= 8
  },
  {
    key: 'snow',
    label: '下雪',
    severity: 4,
    match: (hour) => hour.snowfall >= 1.5
  },
  {
    key: 'gale',
    label: '大风',
    severity: 3,
    match: (hour) => hour.wind >= 50
  },
  {
    key: 'heat',
    label: '高温',
    severity: 2,
    match: (hour) => hour.temperature >= 35
  },
  {
    key: 'cold',
    label: '严寒',
    severity: 2,
    match: (hour) => hour.temperature <= -10
  }
]

function parseTime(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const stamp = new Date(value).getTime()
  return Number.isFinite(stamp) ? new Date(stamp) : null
}

function numberAt(list, index) {
  const value = Array.isArray(list) ? Number(list[index]) : NaN
  return Number.isFinite(value) ? value : 0
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function dayText(at, now) {
  if (isSameDay(at, now)) return '今天'
  const tomorrow = new Date(now.getTime())
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (isSameDay(at, tomorrow)) return '明天'
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日`
}

function periodText(hour) {
  if (hour < 6) return '凌晨'
  if (hour < 9) return '早上'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  return '晚上'
}

function clockText(hour) {
  const shown = hour % 12 === 0 ? 12 : hour % 12
  return `${periodText(hour)} ${shown} 点`
}

/** 把一条提醒写成一句能直接放进提示词的话。 */
export function describeWeatherAlert(alert, now = new Date()) {
  if (alert === null || typeof alert !== 'object') return ''
  const at = alert.at instanceof Date ? alert.at : parseTime(alert.at)
  if (at === null) return ''

  const when = `${dayText(at, now)}${clockText(at.getHours())}前后`
  switch (alert.key) {
    case 'thunder':
      return `${when}可能有雷雨，别在树下躲雨。`
    case 'freeze':
      return `${when}地面可能结冰，走路慢一点。`
    case 'downpour':
      return `${when}雨会下得很急，一小时可能有 ${Math.round(alert.precipitation)} 毫米。`
    case 'snow':
      return `${when}可能下雪，一小时积 ${alert.snowfall.toFixed(1)} 厘米。`
    case 'gale':
      return `${when}风可能很大，阵风能到 ${Math.round(alert.wind)} 公里/小时。`
    case 'heat':
      return `${when}气温可能到 ${Math.round(alert.temperature)} 度。`
    case 'cold':
      return `${when}会很冷，气温可能到 ${Math.round(alert.temperature)} 度。`
    default:
      return ''
  }
}

/**
 * 从 open-meteo 的 hourly 里挑一条提醒。
 *
 * @param {object|null} hourly open-meteo 返回的 hourly 对象
 * @param {{ now?: Date, hours?: number }} options
 * @returns {null | {key:string,label:string,severity:number,at:Date,hoursAhead:number,
 *   precipitation:number,temperature:number,wind:number,snowfall:number,code:number}}
 */
export function pickWeatherAlert(hourly, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const hours = Number.isFinite(options.hours) ? Math.max(1, Math.floor(options.hours)) : ALERT_WINDOW_HOURS
  const times = Array.isArray(hourly?.time) ? hourly.time : []
  if (times.length === 0) return null

  // 允许一点回溯：接口给的是整点，此刻是 15:20 时，15:00 那格仍算「现在」。
  const start = now.getTime() - 30 * 60 * 1000
  const end = now.getTime() + hours * HOUR_MS

  let best = null
  for (let index = 0; index < times.length; index += 1) {
    const at = parseTime(times[index])
    if (at === null) continue
    const stamp = at.getTime()
    if (stamp < start || stamp > end) continue

    const hour = {
      at,
      code: numberAt(hourly.weather_code, index),
      precipitation: numberAt(hourly.precipitation, index),
      temperature: numberAt(hourly.temperature_2m, index),
      wind: numberAt(hourly.wind_speed_10m, index),
      snowfall: numberAt(hourly.snowfall, index)
    }

    for (const rule of RULES) {
      if (!rule.match(hour)) continue
      const candidate = {
        key: rule.key,
        label: rule.label,
        severity: rule.severity,
        at,
        hoursAhead: Math.max(0, Math.round((stamp - now.getTime()) / HOUR_MS)),
        precipitation: hour.precipitation,
        temperature: hour.temperature,
        wind: hour.wind,
        snowfall: hour.snowfall,
        code: hour.code
      }
      if (best === null || candidate.severity > best.severity) best = candidate
      // 同一小时里只留最严重的那个；severity 相同就保留先命中的。
      break
    }
  }

  return best
}
