import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildDailyReview,
  isSameLocalDay,
  localDateKey,
  renderSummary,
  writeDailyReview
} from '../daily-review.mjs'

describe('每日巡视：日期与统计', () => {
  it('只把本地同一天的时间算进来', () => {
    const now = new Date(2026, 10, 1, 18, 0, 0)
    expect(isSameLocalDay(now.toISOString(), '2026-11-01')).toBe(true)
    expect(isSameLocalDay(now.toISOString(), '2026-10-31')).toBe(false)
    expect(isSameLocalDay('not-a-date', '2026-11-01')).toBe(false)
  })

  it('本地日期不受 UTC 跨日影响', () => {
    expect(localDateKey(new Date(2026, 10, 1, 23, 30, 0))).toBe('2026-11-01')
  })

  it('没有对话时不说成“聊了 0 轮”', () => {
    const review = buildDailyReview({
      now: new Date(2026, 10, 1, 22, 30, 0),
      turns: [],
      memoryBefore: 10,
      memoryAfter: 10
    })
    expect(review.rounds).toBe(0)
    expect(review.memoryDelta).toBe(0)
    expect(renderSummary(review)).toContain('没怎么说话')
  })

  it('按用户消息计轮数，助手消息不重复计', () => {
    const at = new Date(2026, 10, 1, 12, 0, 0).toISOString()
    const review = buildDailyReview({
      now: new Date(2026, 10, 1, 22, 30, 0),
      turns: [
        { role: 'user', content: '你好', at },
        { role: 'assistant', content: '在呢', at },
        { role: 'user', content: '今天做什么', at }
      ],
      memoryBefore: 3,
      memoryAfter: 5,
      balance: 12.345
    })
    expect(review.rounds).toBe(2)
    expect(review.memoryDelta).toBe(2)
    expect(review.balance).toBe(12.35)
    expect(renderSummary(review)).toContain('2 轮')
  })

  it('缺数据时保留 null，不用 0 冒充', () => {
    const review = buildDailyReview({ now: new Date(2026, 10, 1, 22, 30, 0) })
    expect(review.memoryDelta).toBeNull()
    expect(review.balance).toBeNull()
  })
})

describe('每日巡视：报告写入', () => {
  it('拒绝非法日期，避免路径穿越', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-daily-'))
    await expect(
      writeDailyReview({ fs, path, dir, review: { date: '../evil' } })
    ).rejects.toThrow('日期不合法')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('写入当天 JSON，包含 summary', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-daily-'))
    const review = buildDailyReview({
      now: new Date(2026, 10, 1, 22, 30, 0),
      turns: [{ role: 'user', content: '在吗', at: new Date(2026, 10, 1, 9, 0, 0).toISOString() }],
      memoryBefore: 1,
      memoryAfter: 2
    })
    const target = await writeDailyReview({ fs, path, dir, review })
    const parsed = JSON.parse(await fs.readFile(target, 'utf8'))
    expect(parsed.date).toBe('2026-11-01')
    expect(parsed.summary).toContain('1 轮')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
