import { describe, expect, it } from 'vitest'
import { describeAnniversaries } from '../anniversary.mjs'

function at(year, month, day) {
  return new Date(year, month - 1, day, 9, 30, 0).getTime()
}

function fact(text, evidence, extra = {}) {
  return { text, evidence, confidence: 0.9, ...extra }
}

describe('纪念日：只认有原话的日子', () => {
  it('今天正好是生日（没有年份）', () => {
    const { note } = describeAnniversaries(
      [fact('旅人的生日是 11 月 7 日', '我生日是11月7日')],
      { now: at(2026, 11, 7) }
    )
    expect(note).toContain('今天是对方的生日')
    expect(note).toContain('11 月 7 日')
  })

  it('带年份时算出周年和第几天', () => {
    const { items, note } = describeAnniversaries(
      [fact('第一次见面是 2024-11-09', '我们2024年11月9日第一次见面')],
      { now: at(2026, 11, 7) }
    )
    expect(items[0].daysUntil).toBe(2)
    expect(items[0].years).toBe(2)
    expect(note).toContain('还有 2 天')
    expect(note).toContain('第 2 年')
  })

  it('日期只出现在原话里也能认出来', () => {
    const { note } = describeAnniversaries(
      [fact('对方提过搬来的日子', '我是去年 11 月 8 号搬到重庆的')],
      { now: at(2026, 11, 7) }
    )
    expect(note).toContain('搬来')
  })

  it('没有原话作证就不算', () => {
    const { items } = describeAnniversaries(
      [fact('对方生日是 11 月 7 日', '')],
      { now: at(2026, 11, 7) }
    )
    expect(items).toEqual([])
  })

  it('有日期但没有纪念词就不算', () => {
    const { items } = describeAnniversaries(
      [fact('11 月 9 日要交报告', '11月9日要交报告')],
      { now: at(2026, 11, 7) }
    )
    expect(items).toEqual([])
  })

  it('离得超过一周就不提', () => {
    const { items } = describeAnniversaries(
      [fact('生日是 11 月 20 日', '我生日11月20日')],
      { now: at(2026, 11, 7) }
    )
    expect(items).toEqual([])
  })

  it('平年的 2 月 29 日按 2 月 28 日过', () => {
    const { items } = describeAnniversaries(
      [fact('生日是 2000-02-29', '我生日是2000年2月29日')],
      { now: at(2027, 2, 25) }
    )
    expect(items[0].daysUntil).toBe(3)
    expect(items[0].month).toBe(2)
    expect(items[0].day).toBe(29)
  })

  it('同一件事记过两次时取更早的年份', () => {
    const { items } = describeAnniversaries(
      [
        fact('生日是 2004-11-07', '我生日是2004年11月7日'),
        fact('生日是 2000-11-07', '我生日是2000年11月7日')
      ],
      { now: at(2026, 11, 7) }
    )
    expect(items.length).toBe(1)
    expect(items[0].years).toBe(26)
  })

  it('按距离排序，最多在提示里说两件', () => {
    const { items, note } = describeAnniversaries(
      [
        fact('生日是 11 月 10 日', '我生日11月10日'),
        fact('第一次见面是 11 月 9 日', '我们11月9日第一次见面'),
        fact('搬来是 11 月 8 日', '11月8日搬来的')
      ],
      { now: at(2026, 11, 7) }
    )
    expect(items.map((item) => item.daysUntil)).toEqual([1, 2, 3])
    expect(note).toContain('搬来')
    expect(note).not.toContain('生日')
  })

  it('空记忆不出声', () => {
    expect(describeAnniversaries([], { now: at(2026, 11, 7) })).toEqual({ items: [], note: '' })
    expect(describeAnniversaries(null, { now: at(2026, 11, 7) }).note).toBe('')
  })
})
