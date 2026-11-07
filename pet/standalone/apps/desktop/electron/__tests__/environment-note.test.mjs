import { describe, expect, it } from 'vitest'
import {
  describeBalance,
  describeEnvironment,
  describeSystem,
  STALE_MS
} from '../environment-note.mjs'

const NOW = new Date(2026, 10, 7, 0, 20, 0).getTime()

function systemOf(overrides = {}) {
  return {
    cpuPercent: 30,
    memory: { percent: 60, usedMb: 9000, totalMb: 16000 },
    battery: { percent: 80, charging: true },
    sampledAt: NOW,
    ...overrides
  }
}

describe('余额提示', () => {
  it('正常余额只给事实，不催促', () => {
    const line = describeBalance({ amount: 412.37, threshold: 20 })
    expect(line).toContain('412.37')
    expect(line).not.toContain('提醒线')
  })

  it('低于提醒线时明说，并提醒别撺掇花钱', () => {
    const line = describeBalance({ amount: 12.3, threshold: 20 })
    expect(line).toContain('12.3')
    expect(line).toContain('20')
    expect(line).toContain('别撺掇')
  })

  it('整数金额不带多余小数', () => {
    expect(describeBalance({ amount: 100, threshold: 0 })).toContain('100 元')
  })

  it('金额缺失或为负时不出声', () => {
    expect(describeBalance(null)).toBe('')
    expect(describeBalance({ amount: Number.NaN })).toBe('')
    expect(describeBalance({ amount: -1 })).toBe('')
  })
})

describe('电脑状态提示', () => {
  it('低电量且没插电才提', () => {
    const line = describeSystem(systemOf({ battery: { percent: 12, charging: false } }), NOW)
    expect(line).toContain('12%')
    expect(line).toContain('没插电')
  })

  it('低电量但正在充电不提', () => {
    expect(describeSystem(systemOf({ battery: { percent: 12, charging: true } }), NOW)).toBe('')
  })

  it('充电状态未知也不催', () => {
    expect(describeSystem(systemOf({ battery: { percent: 8, charging: null } }), NOW)).toBe('')
  })

  it('内存快满时提一句', () => {
    const line = describeSystem(
      systemOf({ memory: { percent: 93, usedMb: 15000, totalMb: 16000 } }),
      NOW
    )
    expect(line).toContain('93%')
  })

  it('采样过期就当作没看见', () => {
    const old = systemOf({ battery: { percent: 5, charging: false } })
    expect(describeSystem(old, NOW + STALE_MS + 1)).toBe('')
  })

  it('没有采样过时不出声', () => {
    expect(describeSystem(systemOf({ sampledAt: 0 }), NOW)).toBe('')
    expect(describeSystem(null, NOW)).toBe('')
  })

  it('低电量和内存满可以同时出现', () => {
    const line = describeSystem(
      systemOf({
        battery: { percent: 15, charging: false },
        memory: { percent: 95, usedMb: 15000, totalMb: 16000 }
      }),
      NOW
    )
    expect(line).toContain('15%')
    expect(line).toContain('95%')
  })
})

describe('合在一起', () => {
  it('两段都有时按顺序拼起来', () => {
    const line = describeEnvironment({
      balance: { amount: 30, threshold: 20 },
      system: systemOf({ battery: { percent: 10, charging: false } }),
      now: NOW
    })
    expect(line).toContain('30 元')
    expect(line).toContain('10%')
  })

  it('什么都没有时返回空串', () => {
    expect(describeEnvironment({ now: NOW })).toBe('')
  })
})
