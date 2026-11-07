import { describe, expect, it } from 'vitest'
import {
  ALERT_RULE_VERSION,
  SEGMENT_SEPARATOR,
  buildSegment,
  isLow,
  normalizeThreshold,
  parseSegment,
  shouldAlert
} from '../balance-alert.mjs'

describe('余额告警 segment', () => {
  it('版本在最前：v1@日期@阈值', () => {
    expect(buildSegment('2026-11-02', 20)).toBe(`v1${SEGMENT_SEPARATOR}2026-11-02${SEGMENT_SEPARATOR}20`)
  })

  it('阈值写法归一：20 / 20.0 / "20.00" 是同一段', () => {
    const first = buildSegment('2026-11-02', 20)
    expect(buildSegment('2026-11-02', '20.0')).toBe(first)
    expect(buildSegment('2026-11-02', 20.0)).toBe(first)
  })

  it('小数与负数序列化稳定，不因写法多开一段', () => {
    expect(buildSegment('2026-11-02', 20.5)).toBe(buildSegment('2026-11-02', '20.50'))
    expect(buildSegment('2026-11-02', -5)).toBe(buildSegment('2026-11-02', '-5.0'))
  })

  it('改阈值换段，旧 ack 不再命中', () => {
    expect(buildSegment('2026-11-02', 20)).not.toBe(buildSegment('2026-11-02', 50))
  })

  it('跨日换段，新一天重新开段', () => {
    expect(buildSegment('2026-11-02', 20)).not.toBe(buildSegment('2026-11-03', 20))
  })

  it('非法日期 / 阈值 / 版本返回 null', () => {
    expect(buildSegment('2026-11-31', 20)).toBeNull()
    expect(buildSegment('2026/11/02', 20)).toBeNull()
    expect(buildSegment('2026-11-02', null)).toBeNull()
    expect(buildSegment('2026-11-02', Number.NaN)).toBeNull()
    expect(buildSegment('2026-11-02', 20, '')).toBeNull()
  })

  it('parseSegment 与 buildSegment 使用同一分隔符往返', () => {
    const segment = buildSegment('2026-11-02', 20.5)
    expect(parseSegment(segment)).toEqual({
      version: ALERT_RULE_VERSION,
      date: '2026-11-02',
      threshold: 20.5
    })
  })

  it('parseSegment 拒绝段数不对 / 日期非法 / 阈值非数', () => {
    expect(parseSegment('v1@2026-11-02')).toBeNull()
    expect(parseSegment('v1@2026-11-31@20')).toBeNull()
    expect(parseSegment('v1@2026-11-02@abc')).toBeNull()
    expect(parseSegment('')).toBeNull()
    expect(parseSegment(null)).toBeNull()
  })
})

describe('余额低额判定', () => {
  it('等于阈值算低额', () => {
    expect(isLow({ balance: 20, threshold: 20 })).toBe(true)
  })

  it('高于阈值不算低额', () => {
    expect(isLow({ balance: 20.01, threshold: 20 })).toBe(false)
  })

  it('切片没有阈值时用设置项兜底', () => {
    expect(isLow({ balance: 19, threshold: null }, 20)).toBe(true)
    expect(isLow({ balance: 21, threshold: null }, 20)).toBe(false)
  })

  it('切片阈值优先于设置项', () => {
    expect(isLow({ balance: 25, threshold: 30 }, 20)).toBe(true)
  })

  it('余额或阈值缺失时不误报', () => {
    expect(isLow({ balance: null, threshold: 20 })).toBe(false)
    expect(isLow({ balance: 10, threshold: null }, null)).toBe(false)
  })
})

describe('余额告警去重', () => {
  const low = { balance: 18, threshold: 20 }

  it('低额且这一段没有 ack 时响', () => {
    expect(shouldAlert(low, 20, null)).toBe(true)
  })

  it('低额但这一段已有 ack 时不再响', () => {
    expect(shouldAlert(low, 20, { at: '2026-11-02T09:00:00+08:00', level: 'shown' })).toBe(false)
  })

  it('不低额时即使没有 ack 也不响', () => {
    expect(shouldAlert({ balance: 21, threshold: 20 }, 20, null)).toBe(false)
  })

  it('ack 为 undefined 与 null 等价', () => {
    expect(shouldAlert(low, 20, undefined)).toBe(true)
  })

  it('阈值快照回归：用 slice.threshold 算段，改成当前设置 50 也不会重开一段', () => {
    const slice = { balance: 18, threshold: 20 }
    const ackedSegment = buildSegment('2026-11-02', slice.threshold)
    const currentSettingSegment = buildSegment('2026-11-02', 50)

    expect(ackedSegment).not.toBe(currentSettingSegment)
    expect(shouldAlert(slice, 50, { at: '2026-11-02T10:00:00+08:00', level: 'shown' })).toBe(false)
  })
})

describe('阈值规范化', () => {
  it('有限数通过，空值与非有限数落 null', () => {
    expect(normalizeThreshold('20')).toBe(20)
    expect(normalizeThreshold('')).toBeNull()
    expect(normalizeThreshold(null)).toBeNull()
    expect(normalizeThreshold(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
