import { describe, expect, it } from 'vitest'
import { chargingFromStatus } from '../system-stats.mjs'

describe('chargingFromStatus', () => {
  it('1 是正在放电', () => {
    expect(chargingFromStatus(1)).toBe(false)
  })

  it('接上交流电与各档充电状态都算充电中', () => {
    for (const status of [2, 3, 6, 7, 8, 10]) {
      expect(chargingFromStatus(status), `status=${status}`).toBe(true)
    }
  })

  it('只描述电量高低的状态不猜成充电与否', () => {
    expect(chargingFromStatus(4)).toBeNull()
    expect(chargingFromStatus(5)).toBeNull()
    expect(chargingFromStatus(9)).toBeNull()
  })

  it('台式机没有电池：空字段解析成 NaN，结果是 null 而不是 false', () => {
    expect(chargingFromStatus(Number.parseInt('', 10))).toBeNull()
    expect(chargingFromStatus(NaN)).toBeNull()
    expect(chargingFromStatus(null)).toBeNull()
    expect(chargingFromStatus(undefined)).toBeNull()
  })
})
