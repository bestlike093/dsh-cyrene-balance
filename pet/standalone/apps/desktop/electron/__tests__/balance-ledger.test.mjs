import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  LEDGER_WINDOW_DAYS,
  createEmptyLedger,
  dateKeyInTimeZone,
  migrateLedger,
  pruneSlices,
  readSlices
} from '../balance-ledger.mjs'

async function fixture(name) {
  const raw = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  return JSON.parse(raw)
}

const NOW = new Date('2026-11-01T12:00:00+08:00')

describe('余额账本 v0 → v1 迁移', () => {
  it('单日覆盖的旧账本包成 v1 切片，fetchedAt 标为 0 表示未知', async () => {
    const migrated = migrateLedger(await fixture('balance-ledger.v0.json'), {
      now: NOW,
      timeZone: 'Asia/Shanghai'
    })
    expect(migrated).toEqual(await fixture('balance-ledger.v1.json'))
  })

  it('已是 v1 时迁移幂等', async () => {
    const raw = await fixture('balance-ledger.v1.json')
    const migrated = migrateLedger(raw, { now: NOW, timeZone: 'Asia/Shanghai' })
    expect(migrated).toEqual(raw)
  })

  it('非对象与缺字段的账本落成空结构', () => {
    expect(migrateLedger(null)).toEqual(createEmptyLedger())
    expect(migrateLedger({ version: 1 })).toEqual(createEmptyLedger())
    expect(migrateLedger({ date: '2026-11-01' })).toEqual(createEmptyLedger())
    expect(migrateLedger({ latest: 12.5 })).toEqual(createEmptyLedger())
  })

  it('v1 里的非法日期与无余额切片被丢弃', () => {
    const migrated = migrateLedger(
      {
        version: 1,
        slices: {
          'not-a-date': { date: 'not-a-date', balance: 1 },
          '2026-02-30': { date: '2026-02-30', balance: 1 },
          '2026-11-01': { date: '2026-11-01', balance: 12.5 },
          '2026-11-02': { date: '2026-11-02' }
        }
      },
      { now: NOW, timeZone: 'Asia/Shanghai' }
    )
    expect(Object.keys(migrated.slices)).toEqual(['2026-11-01'])
  })
})

describe('余额账本 7 天窗口', () => {
  it('写入时裁剪，只保留含今天在内的 7 个本地日', () => {
    const slices = {}
    for (let day = 25; day <= 31; day += 1) {
      slices[`2026-10-${day}`] = { date: `2026-10-${day}`, balance: day }
    }
    slices['2026-11-01'] = { date: '2026-11-01', balance: 1 }

    const kept = pruneSlices(slices, { now: NOW, timeZone: 'Asia/Shanghai' })
    expect(Object.keys(kept)).toHaveLength(LEDGER_WINDOW_DAYS)
    expect(kept['2026-10-25']).toBeUndefined()
    expect(kept['2026-10-26']).toBeDefined()
    expect(kept['2026-11-01']).toBeDefined()
  })

  it('未来日期不提前进窗口', () => {
    const kept = pruneSlices(
      {
        '2026-10-31': { date: '2026-10-31', balance: 1 },
        '2026-11-02': { date: '2026-11-02', balance: 2 }
      },
      { now: NOW, timeZone: 'Asia/Shanghai' }
    )
    expect(Object.keys(kept)).toEqual(['2026-10-31'])
  })

  it('readSlices 只读不裁剪，按日期升序返回', () => {
    const ledger = {
      version: 1,
      slices: {
        '2026-11-02': { date: '2026-11-02', balance: 2 },
        '2026-10-01': { date: '2026-10-01', balance: 1 }
      }
    }
    expect(readSlices(ledger).map((slice) => slice.date)).toEqual([
      '2026-10-01',
      '2026-11-02'
    ])
    expect(readSlices(null)).toEqual([])
  })
})

describe('余额账本本地日切', () => {
  it('按指定时区取日期，不按 UTC 跨日', () => {
    const at = new Date('2026-11-01T00:30:00+08:00')
    expect(dateKeyInTimeZone(at, 'Asia/Shanghai')).toBe('2026-11-01')
    expect(dateKeyInTimeZone(at, 'UTC')).toBe('2026-10-31')
  })

  it('非法时区名回退到系统本地日，不抛错', () => {
    expect(() => dateKeyInTimeZone(NOW, 'Not/AZone')).not.toThrow()
    expect(dateKeyInTimeZone(NOW, 'Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
