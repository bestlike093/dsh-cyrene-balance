import { describe, expect, it } from 'vitest'
import { describeWeatherAlert, pickWeatherAlert, ALERT_WINDOW_HOURS } from '../weather-alert.mjs'
import { fetchWeather } from '../presence.mjs'

/** 从 11 月 7 日零点起偏移几小时，拼成 open-meteo 那种不带时区的整点字符串。 */
function hourText(offset) {
  const stamp = new Date(2026, 10, 7, 0, 0, 0, 0)
  stamp.setHours(stamp.getHours() + offset)
  const month = String(stamp.getMonth() + 1).padStart(2, '0')
  const day = String(stamp.getDate()).padStart(2, '0')
  const hour = String(stamp.getHours()).padStart(2, '0')
  return `${stamp.getFullYear()}-${month}-${day}T${hour}:00`
}

/**
 * 每个点只写关心的字段，其余按「什么都没发生」补零。
 * hour 是从 7 日零点算起的偏移，跨天自动进位。
 * @param {Array<{hour:number,code?:number,precipitation?:number,wind?:number,temperature?:number,snowfall?:number}>} points
 */
function hourly(points) {
  return {
    time: points.map((point) => hourText(point.hour ?? 0)),
    weather_code: points.map((point) => point.code ?? 0),
    precipitation: points.map((point) => point.precipitation ?? 0),
    wind_speed_10m: points.map((point) => point.wind ?? 0),
    temperature_2m: points.map((point) => point.temperature ?? 20),
    snowfall: points.map((point) => point.snowfall ?? 0)
  }
}

const NOON = new Date(2026, 10, 7, 12, 0, 0, 0)

describe('pickWeatherAlert', () => {
  it('窗口内的雷雨会挑出来', () => {
    const alert = pickWeatherAlert(hourly([{ hour: 12 }, { hour: 15, code: 95 }]), { now: NOON })
    expect(alert).toMatchObject({ key: 'thunder', label: '雷雨', severity: 5 })
    expect(alert.hoursAhead).toBe(3)
  })

  it('窗口外的事不提，免得半夜说下午的雨', () => {
    const alert = pickWeatherAlert(
      hourly([{ hour: 12 }, { hour: 14 + ALERT_WINDOW_HOURS, code: 95 }]),
      { now: NOON }
    )
    expect(alert).toBeNull()
  })

  it('降水到 8 毫米才叫强降水，4 毫米只是下雨', () => {
    expect(pickWeatherAlert(hourly([{ hour: 14, precipitation: 4 }]), { now: NOON })).toBeNull()
    const alert = pickWeatherAlert(hourly([{ hour: 14, precipitation: 9.6 }]), { now: NOON })
    expect(alert).toMatchObject({ key: 'downpour', precipitation: 9.6 })
  })

  it('大风、高温各自按阈值触发', () => {
    expect(pickWeatherAlert(hourly([{ hour: 14, wind: 50 }]), { now: NOON })).toMatchObject({
      key: 'gale',
      wind: 50
    })
    expect(pickWeatherAlert(hourly([{ hour: 14, wind: 49 }]), { now: NOON })).toBeNull()
    expect(pickWeatherAlert(hourly([{ hour: 14, temperature: 35 }]), { now: NOON })).toMatchObject({
      key: 'heat',
      temperature: 35
    })
    expect(pickWeatherAlert(hourly([{ hour: 14, temperature: 34 }]), { now: NOON })).toBeNull()
  })

  it('零度加降水先报结冰，不报强降水', () => {
    const alert = pickWeatherAlert(
      hourly([{ hour: 14, temperature: -1, precipitation: 3 }]),
      { now: NOON }
    )
    expect(alert).toMatchObject({ key: 'freeze', label: '结冰' })
  })

  it('同时命中时取更严重的那个', () => {
    const alert = pickWeatherAlert(
      hourly([{ hour: 14, precipitation: 12, wind: 60, code: 0 }]),
      { now: NOON }
    )
    expect(alert.key).toBe('downpour')
  })

  it('整点已过二十分钟仍算此刻，不会漏掉正在下的雨', () => {
    const now = new Date(2026, 10, 7, 14, 20, 0, 0)
    const alert = pickWeatherAlert(hourly([{ hour: 14, precipitation: 10 }]), { now })
    expect(alert).toMatchObject({ key: 'downpour', hoursAhead: 0 })
  })

  it('没有逐小时数据就安静地不报', () => {
    expect(pickWeatherAlert(null, { now: NOON })).toBeNull()
    expect(pickWeatherAlert({}, { now: NOON })).toBeNull()
    expect(pickWeatherAlert(hourly([]), { now: NOON })).toBeNull()
  })

  it('时间串坏了只跳过那一格', () => {
    const data = hourly([{ hour: 15, precipitation: 10 }, { hour: 16, precipitation: 10 }])
    data.time[0] = 'not-a-time'
    expect(pickWeatherAlert(data, { now: NOON })).toMatchObject({ key: 'downpour', hoursAhead: 4 })
  })
})

describe('describeWeatherAlert', () => {
  it('今天的提醒说今天，并带上时段', () => {
    const alert = pickWeatherAlert(hourly([{ hour: 15, code: 95 }]), { now: NOON })
    expect(describeWeatherAlert(alert, NOON)).toBe('今天下午 3 点前后可能有雷雨，别在树下躲雨。')
  })

  it('明天的提醒说说明天', () => {
    const now = new Date(2026, 10, 7, 23, 0, 0, 0)
    const alert = pickWeatherAlert(hourly([{ hour: 32, temperature: 36 }]), { now })
    expect(describeWeatherAlert(alert, now)).toBe('明天早上 8 点前后气温可能到 36 度。')
  })

  it('更远的日子直接写日期', () => {
    const now = new Date(2026, 10, 7, 23, 0, 0, 0)
    const alert = { key: 'gale', at: new Date(2026, 10, 9, 20, 0, 0, 0), wind: 62 }
    expect(describeWeatherAlert(alert, now)).toBe('11 月 9 日晚上 8 点前后风可能很大，阵风能到 62 公里/小时。')
  })

  it('拿不到时间就整句省略', () => {
    expect(describeWeatherAlert(null, NOON)).toBe('')
    expect(describeWeatherAlert({ key: 'thunder' }, NOON)).toBe('')
  })
})

describe('fetchWeather 的提醒字段', () => {
  it('有逐小时预报时附带一句提醒', async () => {
    const result = await fetchWeather({
      city: '重庆',
      now: NOON,
      fetchImpl: async () =>
        jsonResponse({
          current: { temperature_2m: 18.4, weather_code: 61 },
          hourly: hourly([{ hour: 15, precipitation: 10 }])
        })
    })
    expect(result.ok).toBe(true)
    expect(result.alert).toMatchObject({ key: 'downpour' })
    expect(result.alertNote).toContain('今天下午 3 点前后')
  })

  it('没有逐小时预报时只少了提醒，不影响天气本身', async () => {
    const result = await fetchWeather({
      now: NOON,
      fetchImpl: async () =>
        jsonResponse({ current: { temperature_2m: 18.4, weather_code: 61 } })
    })
    expect(result).toMatchObject({ ok: true, alert: null, alertNote: '' })
    expect(result.temperature).toBe(18)
  })
})

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body
  }
}
