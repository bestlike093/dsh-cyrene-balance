import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createLedgerStore } from '../balance-ledger-store.mjs'

const NOW = new Date('2026-11-02T08:00:00+08:00')
const TZ = 'Asia/Shanghai'

async function fixture(name) {
  const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  return JSON.parse(text)
}

function fakeIo(initial) {
  let stored = initial
  const writes = []
  const read = vi.fn(async () => stored)
  const write = vi.fn(async (value) => {
    writes.push(value)
    stored = value
  })
  return { read, write, writes, get: () => stored }
}

function slice(date, balance = 1) {
  return {
    date,
    tz: TZ,
    fetchedAt: 0,
    balance,
    threshold: null,
    acknowledgedAt: null,
    lastAlertedAt: null
  }
}

function storeWith(io) {
  return createLedgerStore({
    read: io.read,
    write: io.write,
    now: () => NOW,
    timeZone: () => TZ
  })
}

describe('余额账本文件层', () => {
  it('v0 迁入 v1，balance 值不丢，未知字段留空', async () => {
    const v0 = await fixture('balance-ledger.v0.json')
    const io = fakeIo(v0)
    const store = storeWith(io)

    const opened = await store.ensureLedger()

    expect(opened.version).toBe(1)
    expect(opened.slices['2026-11-01']).toMatchObject({
      date: '2026-11-01',
      tz: TZ,
      fetchedAt: 0,
      balance: 32.5,
      threshold: null,
      acknowledgedAt: null,
      lastAlertedAt: null
    })
    expect(io.get()).toEqual(opened)
    expect(io.write).toHaveBeenCalledTimes(1)
  })

  it('已是 v1 再 ensure 不重写，返回同一个 opened', async () => {
    const v1 = await fixture('balance-ledger.v1.json')
    const io = fakeIo(v1)
    const store = storeWith(io)

    const first = await store.ensureLedger()
    const second = await store.ensureLedger()

    expect(io.write).not.toHaveBeenCalled()
    expect(second).toBe(first)
  })

  it('并发 3 个 ensureLedger 只迁移一次，拿到同一个 opened', async () => {
    const v0 = await fixture('balance-ledger.v0.json')
    let releaseRead = null
    const read = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseRead = () => resolve(v0)
        })
    )
    const write = vi.fn(async () => {})
    const store = createLedgerStore({
      read,
      write,
      now: () => NOW,
      timeZone: () => TZ
    })

    const a = store.ensureLedger()
    const b = store.ensureLedger()
    const c = store.ensureLedger()
    expect(read).toHaveBeenCalledTimes(1)

    releaseRead()
    const [ra, rb, rc] = await Promise.all([a, b, c])

    expect(read).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(ra).toBe(rb)
    expect(rb).toBe(rc)
  })

  it('迁移写失败时原文件不动，清空 ready 后可重试', async () => {
    const v0 = await fixture('balance-ledger.v0.json')
    let stored = v0
    let attempts = 0
    const read = vi.fn(async () => stored)
    const write = vi.fn(async (value) => {
      attempts += 1
      if (attempts === 1) throw new Error('disk full')
      stored = value
    })
    const store = createLedgerStore({
      read,
      write,
      now: () => NOW,
      timeZone: () => TZ
    })

    await expect(store.ensureLedger()).rejects.toMatchObject({
      code: 'ledger-migrate-failed'
    })
    expect(stored).toEqual(v0)
    expect(write).toHaveBeenCalledTimes(1)

    const opened = await store.ensureLedger()
    expect(opened.version).toBe(1)
    expect(opened.slices['2026-11-01'].balance).toBe(32.5)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('读失败也走 ledger-migrate-failed，不吞错', async () => {
    const read = vi.fn(async () => {
      throw new Error('EACCES')
    })
    const store = createLedgerStore({
      read,
      write: vi.fn(),
      now: () => NOW,
      timeZone: () => TZ
    })

    await expect(store.ensureLedger()).rejects.toMatchObject({
      code: 'ledger-migrate-failed'
    })
  })

  it('没有账本时创建空 v1', async () => {
    const io = fakeIo(null)
    const store = storeWith(io)

    const opened = await store.ensureLedger()

    expect(opened).toEqual({ version: 1, slices: {} })
    expect(io.write).toHaveBeenCalledTimes(1)
  })

  it('recordBalance 写入当天切片，磁盘只留 7 天', async () => {
    const slices = {}
    for (let day = 26; day <= 31; day += 1) {
      const key = `2026-10-${String(day).padStart(2, '0')}`
      slices[key] = slice(key)
    }
    slices['2026-11-01'] = slice('2026-11-01', 2)

    const io = fakeIo({ version: 1, slices })
    const store = storeWith(io)

    const fresh = await store.recordBalance({
      balance: 25,
      threshold: 20,
      fetchedAt: 5_000
    })

    const keys = Object.keys(io.get().slices).sort()
    expect(keys).toHaveLength(7)
    expect(keys).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02'
    ])
    expect(io.get().slices['2026-10-26']).toBeUndefined()
    expect(fresh.slices['2026-11-02']).toMatchObject({
      date: '2026-11-02',
      tz: TZ,
      fetchedAt: 5_000,
      balance: 25,
      threshold: 20
    })
  })

  it('跨日边界不残留第 8 个切片', async () => {
    const io = fakeIo({
      version: 1,
      slices: {
        '2026-10-26': slice('2026-10-26'),
        '2026-10-27': slice('2026-10-27')
      }
    })
    const store = storeWith(io)

    await store.recordBalance({ balance: 3 })

    const keys = Object.keys(io.get().slices)
    expect(keys).toHaveLength(2)
    expect(keys.sort()[0]).toBe('2026-10-27')
    expect(keys.every((key) => key >= '2026-10-27')).toBe(true)
  })

  it('先裁剪再写盘，写完后 ready 才换新', async () => {
    const io = fakeIo({
      version: 1,
      slices: {
        '2026-10-26': slice('2026-10-26'),
        '2026-11-01': slice('2026-11-01', 2)
      }
    })
    const store = storeWith(io)

    const fresh = await store.recordBalance({ balance: 9 })

    const written = io.writes.at(-1)
    expect(written).toBe(fresh)
    expect(Object.keys(written.slices)).toHaveLength(2)
    expect(written.slices['2026-10-26']).toBeUndefined()
    expect(await store.ensureLedger()).toBe(fresh)
  })

  describe('ack 存储层', () => {
    const SEG = 'v1@2026-11-02@20'

    it('markAck 落 shown，hasAck 同步命中，磁盘形状只含 at/level', async () => {
      const io = fakeIo({ version: 1, slices: {} })
      const store = storeWith(io)

      await store.markAck(SEG)

      expect(io.get().acks[SEG]).toEqual({
        at: '2026-11-02T00:00:00.000Z',
        level: 'shown'
      })
      expect(store.hasAck(SEG)).toBe(true)
    })

    it('markAck confirmed 覆盖同段 level，不新增键', async () => {
      const io = fakeIo({ version: 1, slices: {} })
      const store = storeWith(io)

      await store.markAck(SEG)
      await store.markAck(SEG, 'confirmed')

      expect(Object.keys(io.get().acks)).toHaveLength(1)
      expect(io.get().acks[SEG].level).toBe('confirmed')
      expect(store.hasAck(SEG)).toBe(true)
    })

    it('hasAck 未加载时 fail-open：返回 false，不抛错', () => {
      const io = fakeIo({ version: 1, slices: {} })
      const store = storeWith(io)

      expect(store.hasAck(SEG)).toBe(false)
      expect(store.hasAck('v1@2026-11-02@50')).toBe(false)
      expect(store.hasAck(null)).toBe(false)
    })

    it('recordBalance 写入当天切片时保留已有 ack', async () => {
      const io = fakeIo({
        version: 1,
        slices: { '2026-11-01': slice('2026-11-01', 2) },
        acks: { [SEG]: { at: '2026-11-01T00:00:00.000Z', level: 'shown' } }
      })
      const store = storeWith(io)

      const fresh = await store.recordBalance({ balance: 9 })

      expect(fresh.acks[SEG]).toEqual({
        at: '2026-11-01T00:00:00.000Z',
        level: 'shown'
      })
      expect(store.hasAck(SEG)).toBe(true)
    })

    it('markAck 与 slice 同批次裁：旧 ack 随窗口一起消失', async () => {
      let clock = new Date('2026-10-20T08:00:00+08:00')
      const io = fakeIo({ version: 1, slices: {} })
      const store = createLedgerStore({
        read: io.read,
        write: io.write,
        now: () => clock,
        timeZone: () => TZ
      })

      await store.markAck('v1@2026-10-20@20')
      clock = NOW
      await store.markAck(SEG)

      expect(io.get().acks['v1@2026-10-20@20']).toBeUndefined()
      expect(io.get().acks[SEG]).toBeDefined()
    })

    it('markAck 也裁旧 slice，避免 slice 与 ack 分两次裁剪', async () => {
      const io = fakeIo({
        version: 1,
        slices: {
          '2026-10-26': slice('2026-10-26'),
          '2026-11-01': slice('2026-11-01', 2)
        }
      })
      const store = storeWith(io)

      await store.markAck(SEG)

      expect(io.get().slices['2026-10-26']).toBeUndefined()
      expect(io.get().slices['2026-11-01']).toBeDefined()
    })

    it('写盘失败时不更新内存 ack，下一次还能重新响', async () => {
      const initial = { version: 1, slices: {} }
      const stored = initial
      const write = vi.fn(async () => {
        throw new Error('disk full')
      })
      const store = createLedgerStore({
        read: vi.fn(async () => stored),
        write,
        now: () => NOW,
        timeZone: () => TZ
      })

      await expect(store.markAck(SEG)).rejects.toMatchObject({
        code: 'ledger-write-failed'
      })
      expect(store.hasAck(SEG)).toBe(false)
      expect(stored).toEqual(initial)
    })

    it('空 segment 或非法 level 直接拒绝，不落盘', async () => {
      const io = fakeIo({ version: 1, slices: {} })
      const store = storeWith(io)

      await expect(store.markAck('')).rejects.toThrow(TypeError)
      await expect(store.markAck(SEG, 'bad')).rejects.toThrow(TypeError)
      expect(io.write).not.toHaveBeenCalled()
    })
  })
})
