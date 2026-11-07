import { describe, it, expect } from 'vitest'
import {
  DEFAULT_QUIET,
  createPresenceGate,
  dayKey,
  inQuietHours,
  parseClock
} from '../presence-gate.mjs'

function at(hours, minutes = 0, day = 7) {
  return new Date(2026, 10, day, hours, minutes, 0, 0)
}

describe('parseClock', () => {
  it('把时刻换成分钟数', () => {
    expect(parseClock('23:00')).toBe(1380)
    expect(parseClock('07:30')).toBe(450)
    expect(parseClock('0:05')).toBe(5)
  })

  it('格式不对时给 null，不猜', () => {
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('12:60')).toBeNull()
    expect(parseClock('abc')).toBeNull()
    expect(parseClock(null)).toBeNull()
  })
})

describe('inQuietHours', () => {
  it('跨午夜的时段，凌晨也算安静', () => {
    expect(inQuietHours(at(23, 30), DEFAULT_QUIET)).toBe(true)
    expect(inQuietHours(at(3, 27), DEFAULT_QUIET)).toBe(true)
    expect(inQuietHours(at(6, 59), DEFAULT_QUIET)).toBe(true)
  })

  it('到点就放行，边界不吞人', () => {
    expect(inQuietHours(at(7, 30), DEFAULT_QUIET)).toBe(true)
    expect(inQuietHours(at(8, 0), DEFAULT_QUIET)).toBe(false)
    expect(inQuietHours(at(12, 0), DEFAULT_QUIET)).toBe(false)
  })

  it('不跨午夜的时段按普通区间算', () => {
    const quiet = { enabled: true, start: '12:00', end: '14:00' }
    expect(inQuietHours(at(13, 0), quiet)).toBe(true)
    expect(inQuietHours(at(14, 0), quiet)).toBe(false)
  })

  it('关掉之后不再拦', () => {
    expect(inQuietHours(at(23, 30), { enabled: false })).toBe(false)
  })

  it('起止相同视为没设', () => {
    expect(inQuietHours(at(23, 30), { enabled: true, start: '08:00', end: '08:00' })).toBe(false)
  })
})

describe('createPresenceGate', () => {
  it('安静时段连手动也拦，并说清原因', () => {
    const gate = createPresenceGate({ now: () => at(23, 30) })
    const result = gate.check({ reason: 'manual', settings: {} })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('quiet-hours')
    expect(result.detail).toContain('休息')
  })

  it('时段跟着设置页的夜间不扰走', () => {
    const gate = createPresenceGate({ now: () => at(22, 30) })
    const quiet = { enabled: true, from: '22:00', to: '08:00', mode: 'urgentOnly' }
    expect(gate.check({ reason: 'auto', settings: { presence: { quiet } } }).reason).toBe(
      'quiet-hours'
    )
    expect(
      gate.check({ reason: 'auto', settings: { presence: { quiet: { ...quiet, enabled: false } } } })
        .ok
    ).toBe(true)
  })

  it('降频模式不拦，间隔交给调度层拉长', () => {
    const gate = createPresenceGate({ now: () => at(23, 30) })
    const result = gate.check({
      reason: 'auto',
      settings: { presence: { quiet: { enabled: true, from: '23:00', to: '08:00', mode: 'reduce' } } }
    })
    expect(result.ok).toBe(true)
  })

  it('手动不受每日上限影响', () => {
    const gate = createPresenceGate({ now: () => at(12, 0) })
    for (let i = 0; i < 10; i += 1) gate.noteSpoken()
    expect(gate.check({ reason: 'manual', settings: { presence: { dailyCap: 2 } } }).ok).toBe(true)
  })

  it('自动开口到每日上限就停', () => {
    const gate = createPresenceGate({ now: () => at(12, 0) })
    gate.noteSpoken()
    gate.noteSpoken()
    const result = gate.check({ reason: 'auto', settings: { presence: { dailyCap: 2 } } })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('daily-cap')
  })

  it('跨一天之后，开口次数重新算', () => {
    let current = at(12, 0, 7)
    const gate = createPresenceGate({ now: () => current })
    gate.noteSpoken()
    expect(gate.check({ reason: 'auto', settings: { presence: { dailyCap: 1 } } }).ok).toBe(false)
    current = at(12, 0, 8)
    expect(gate.check({ reason: 'auto', settings: { presence: { dailyCap: 1 } } }).ok).toBe(true)
  })

  it('三天没说话，她就不再主动找你', () => {
    const gate = createPresenceGate({ now: () => at(12, 0) })
    const result = gate.check({
      reason: 'auto',
      settings: { presence: { silenceDays: 3 } },
      lastContactAt: at(12, 0, 3)
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('silent-away')
  })

  it('刚说过话就恢复主动', () => {
    const gate = createPresenceGate({ now: () => at(12, 0) })
    const result = gate.check({
      reason: 'auto',
      settings: { presence: { silenceDays: 3 } },
      lastContactAt: at(11, 0)
    })
    expect(result.ok).toBe(true)
  })

  it('从没互动过时不按沉默处理', () => {
    const gate = createPresenceGate({ now: () => at(12, 0) })
    expect(gate.check({ reason: 'auto', settings: {}, lastContactAt: null }).ok).toBe(true)
  })

  it('日期键是本地的年月日', () => {
    expect(dayKey(at(0, 5, 7))).toBe('2026-11-07')
  })

  it('重启后接着今天的次数算，不从零开始', () => {
    const today = dayKey(at(12, 0))
    const room = createPresenceGate({ now: () => at(12, 0), initial: { day: today, spokenToday: 5 } })
    expect(room.check({ reason: 'auto', settings: { presence: { dailyCap: 6 } } }).ok).toBe(true)

    const capped = createPresenceGate({
      now: () => at(12, 0),
      initial: { day: today, spokenToday: 6 }
    })
    expect(capped.check({ reason: 'auto', settings: { presence: { dailyCap: 6 } } }).reason).toBe(
      'daily-cap'
    )
  })

  it('隔天重启，昨天的次数不带过来', () => {
    const gate = createPresenceGate({
      now: () => at(12, 0, 8),
      initial: { day: '2026-11-07', spokenToday: 6 }
    })
    expect(gate.check({ reason: 'auto', settings: { presence: { dailyCap: 6 } } }).ok).toBe(true)
  })
})
