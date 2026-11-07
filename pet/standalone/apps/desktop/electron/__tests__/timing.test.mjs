import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMING_LIMITS,
  assessTiming,
  describeTiming,
  emptyRhythm,
  normalizeRhythm,
  recordActivity
} from '../timing.mjs'

/** 造一个「只有这个小时有样本」的作息，其余为 0。 */
function rhythmAt(hour, count, samples = count) {
  const hours = Array(24).fill(0)
  hours[hour] = count
  return { hours, samples, updatedAt: 0 }
}

/** 某天某点的时间戳。 */
function at(hour, minute = 0) {
  return new Date(2026, 10, 7, hour, minute, 0).getTime()
}

describe('作息记录', () => {
  it('记一次就落在对应小时上，样本一起加一', () => {
    const next = recordActivity(emptyRhythm(), at(15, 30))
    expect(next.hours[15]).toBe(1)
    expect(next.samples).toBe(1)
    expect(next.updatedAt).toBe(at(15, 30))
  })

  it('样本超过上限就整体减半，旧习惯会慢慢退下去', () => {
    const full = rhythmAt(9, 400, 400)
    const next = recordActivity(full, at(9, 5))
    // 400 先加一变成 401，触发减半；9 点那一桶减半后是 201。
    expect(next.hours[9]).toBe(201)
    expect(next.samples).toBe(201)
  })

  it('坏数据当作空作息，不抛错', () => {
    const broken = normalizeRhythm({ hours: '不是数组', samples: -5, updatedAt: 'x' })
    expect(broken.hours).toHaveLength(24)
    expect(broken.hours.every((item) => item === 0)).toBe(true)
    expect(broken.samples).toBe(0)
    expect(normalizeRhythm(null).samples).toBe(0)
  })
})

describe('开口时机', () => {
  it('刚聊完就先不说话', () => {
    const now = at(15, 1)
    const verdict = assessTiming({
      now,
      lastUserSpokeAt: now - 30 * 1000,
      idleMs: 0,
      rhythm: emptyRhythm()
    })
    expect(verdict.speak).toBe(false)
    expect(verdict.reason).toBe('just_talked')
  })

  it('人离开电脑就不对着空房间说话', () => {
    const verdict = assessTiming({
      now: at(15, 0),
      lastUserSpokeAt: 0,
      idleMs: DEFAULT_TIMING_LIMITS.awayAfterMs + 1000,
      rhythm: emptyRhythm()
    })
    expect(verdict.speak).toBe(false)
    expect(verdict.reason).toBe('user_away')
  })

  it('样本不够时按老规矩：平常时段照常，深夜放慢', () => {
    const neutral = assessTiming({
      now: at(15, 0),
      lastUserSpokeAt: 0,
      idleMs: 0,
      rhythm: rhythmAt(15, 2)
    })
    expect(neutral.speak).toBe(true)
    expect(neutral.reason).toBe('neutral')
    expect(neutral.scale).toBe(1)

    const late = assessTiming({
      now: at(2, 0),
      lastUserSpokeAt: 0,
      idleMs: 0,
      rhythm: rhythmAt(2, 2)
    })
    expect(late.reason).toBe('late_night')
    expect(late.scale).toBe(DEFAULT_TIMING_LIMITS.lateNightScale)
  })

  it('到了常聊的时段可以早一点开口', () => {
    // 总样本 120，平均每小时 5；21 点有 40 条，明显高于平均。
    const rhythm = rhythmAt(21, 40, 120)
    const verdict = assessTiming({ now: at(21, 10), lastUserSpokeAt: 0, idleMs: 0, rhythm })
    expect(verdict.speak).toBe(true)
    expect(verdict.reason).toBe('active_hour')
    expect(verdict.scale).toBe(DEFAULT_TIMING_LIMITS.activeHourScale)
  })

  it('样本够了但这一小时很冷清，深夜照样放慢', () => {
    const rhythm = rhythmAt(21, 60, 120)
    const verdict = assessTiming({ now: at(3, 20), lastUserSpokeAt: 0, idleMs: 0, rhythm })
    expect(verdict.reason).toBe('late_night')
    expect(verdict.scale).toBe(DEFAULT_TIMING_LIMITS.lateNightScale)
  })

  it('idleMs 未知时不拿它拦人', () => {
    const verdict = assessTiming({
      now: at(15, 0),
      lastUserSpokeAt: 0,
      idleMs: null,
      rhythm: emptyRhythm()
    })
    expect(verdict.speak).toBe(true)
  })
})

describe('时机说明', () => {
  it('每种判断都有一句人话', () => {
    expect(describeTiming({ speak: false, reason: 'just_talked' })).toContain('刚聊过')
    expect(describeTiming({ speak: false, reason: 'user_away' })).toContain('不在')
    expect(describeTiming({ speak: true, reason: 'active_hour' })).toContain('早一点')
    expect(describeTiming({ speak: true, reason: 'late_night' })).toContain('夜深')
    expect(describeTiming(null)).toBe('还不清楚')
  })
})
