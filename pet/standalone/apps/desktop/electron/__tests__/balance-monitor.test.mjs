import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSegment } from '../balance-alert.mjs'
import { createBalanceMonitor } from '../balance-monitor.mjs'
import { createLedgerStore } from '../balance-ledger-store.mjs'

const NOW = new Date('2026-11-02T08:00:00+08:00')
const TZ = 'Asia/Shanghai'

describe('余额监控接线', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('迁移失败停轮询，onError 精确为 ledger-migrate-failed，后续 tick 不再触发', async () => {
    vi.useFakeTimers()
    const migrationError = Object.assign(new Error('boom'), {
      code: 'ledger-migrate-failed'
    })
    const store = {
      ensureLedger: vi.fn(async () => {
        throw migrationError
      }),
      recordBalance: vi.fn()
    }
    const fetchBalance = vi.fn()
    const onError = vi.fn()
    const poller = createBalanceMonitor({
      store,
      fetchBalance,
      onError,
      intervalMs: 30_000
    })
    const stopSpy = vi.spyOn(poller, 'stop')
    poller.start()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(poller.isRunning()).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'ledger-migrate-failed' })
    expect(fetchBalance).not.toHaveBeenCalled()
    expect(store.recordBalance).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(90_000)
    expect(fetchBalance).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('迁移成功后抓余额并落账', async () => {
    vi.useFakeTimers()
    const store = {
      ensureLedger: vi.fn(async () => ({ version: 1, slices: {} })),
      recordBalance: vi.fn(async () => ({ version: 1, slices: {} }))
    }
    const fetchBalance = vi.fn(async () => ({
      ok: true,
      balance: 12.5,
      threshold: 20,
      fetchedAt: 1_000
    }))
    const onError = vi.fn()
    const poller = createBalanceMonitor({
      store,
      fetchBalance,
      onError,
      intervalMs: 30_000
    })
    poller.start()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchBalance).toHaveBeenCalledTimes(1)
    expect(store.recordBalance).toHaveBeenCalledWith({
      balance: 12.5,
      threshold: 20,
      fetchedAt: 1_000
    })
    expect(onError).not.toHaveBeenCalled()
    poller.stop()
  })

  it('抓余额失败只报错，不停轮询', async () => {
    vi.useFakeTimers()
    const store = {
      ensureLedger: vi.fn(async () => ({ version: 1, slices: {} })),
      recordBalance: vi.fn()
    }
    const failure = new Error('network')
    const fetchBalance = vi.fn(async () => {
      throw failure
    })
    const onError = vi.fn()
    const poller = createBalanceMonitor({
      store,
      fetchBalance,
      onError,
      intervalMs: 30_000
    })
    poller.start()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(onError).toHaveBeenCalledWith({
      code: 'balance-fetch-failed',
      reason: failure
    })
    expect(poller.isRunning()).toBe(true)
    expect(store.recordBalance).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchBalance).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('三并发 tick 只迁移一次、只落一份账，ready 唯一', async () => {
    vi.useFakeTimers()
    let releaseFetch = null
    const read = vi.fn(async () => null)
    const write = vi.fn(async () => {})
    const store = createLedgerStore({
      read,
      write,
      now: () => NOW,
      timeZone: () => TZ
    })
    const recordSpy = vi.spyOn(store, 'recordBalance')
    const fetchBalance = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseFetch = () =>
            resolve({ ok: true, balance: 10, threshold: 20, fetchedAt: 1_000 })
        })
    )
    const onError = vi.fn()
    const monitor = createBalanceMonitor({
      store,
      fetchBalance,
      onError,
      intervalMs: 30_000
    })
    monitor.start()

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(read).toHaveBeenCalledTimes(1)
    expect(fetchBalance).toHaveBeenCalledTimes(1)
    expect(recordSpy).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    releaseFetch()
    await vi.advanceTimersByTimeAsync(0)

    expect(recordSpy).toHaveBeenCalledTimes(1)
    const fresh = await recordSpy.mock.results[0].value
    expect(fresh.slices['2026-11-02']).toBeDefined()
    expect(await store.ensureLedger()).toBe(fresh)
    monitor.stop()
  })

  describe('低额告警接线', () => {
    function alertStore() {
      let stored = null
      const read = vi.fn(async () => stored)
      const write = vi.fn(async (value) => {
        stored = value
      })
      return createLedgerStore({
        read,
        write,
        now: () => NOW,
        timeZone: () => TZ
      })
    }

    function monitorWith(store, balance, onAlert, onError = vi.fn()) {
      const monitor = createBalanceMonitor({
        store,
        fetchBalance: async () => ({ balance, threshold: 20, fetchedAt: 1_000 }),
        onAlert,
        onError,
        intervalMs: 30_000
      })
      monitor.start()
      return monitor
    }

    it('低额且当天无 ack 时响一次，并落 shown ack', async () => {
      vi.useFakeTimers()
      const store = alertStore()
      const onAlert = vi.fn(() => true)
      const monitor = monitorWith(store, 12.5, onAlert)

      await vi.advanceTimersByTimeAsync(30_000)

      expect(onAlert).toHaveBeenCalledTimes(1)
      expect(onAlert.mock.calls[0][0]).toMatchObject({
        segment: buildSegment('2026-11-02', 20),
        date: '2026-11-02',
        balance: 12.5,
        threshold: 20
      })
      expect(store.hasAck(buildSegment('2026-11-02', 20))).toBe(true)
      monitor.stop()
    })

    it('当天已有 ack 时同段不再响', async () => {
      vi.useFakeTimers()
      const store = alertStore()
      await store.markAck(buildSegment('2026-11-02', 20))
      const onAlert = vi.fn(() => true)
      const monitor = monitorWith(store, 12.5, onAlert)

      await vi.advanceTimersByTimeAsync(30_000)

      expect(onAlert).not.toHaveBeenCalled()
      monitor.stop()
    })

    it('余额高于阈值时即使没有 ack 也不响', async () => {
      vi.useFakeTimers()
      const store = alertStore()
      const onAlert = vi.fn(() => true)
      const monitor = monitorWith(store, 25, onAlert)

      await vi.advanceTimersByTimeAsync(30_000)

      expect(onAlert).not.toHaveBeenCalled()
      expect(store.hasAck(buildSegment('2026-11-02', 20))).toBe(false)
      monitor.stop()
    })

    it('窗口不在时 onAlert 返回 false，不落 ack，下一轮再试', async () => {
      vi.useFakeTimers()
      const store = alertStore()
      const onAlert = vi.fn(() => false)
      const monitor = monitorWith(store, 12.5, onAlert)

      await vi.advanceTimersByTimeAsync(30_000)
      expect(onAlert).toHaveBeenCalledTimes(1)
      expect(store.hasAck(buildSegment('2026-11-02', 20))).toBe(false)

      await vi.advanceTimersByTimeAsync(30_000)
      expect(onAlert).toHaveBeenCalledTimes(2)
      monitor.stop()
    })

    it('ack 写失败只报错，不阻塞轮询，下一次仍可再响', async () => {
      vi.useFakeTimers()
      const store = alertStore()
      const onAlert = vi.fn(() => true)
      const onError = vi.fn()
      const ackSpy = vi.spyOn(store, 'markAck').mockRejectedValueOnce(new Error('disk full'))
      const monitor = monitorWith(store, 12.5, onAlert, onError)

      await vi.advanceTimersByTimeAsync(30_000)

      expect(onAlert).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'balance-ack-failed' })
      )
      expect(store.hasAck(buildSegment('2026-11-02', 20))).toBe(false)
      expect(monitor.isRunning()).toBe(true)
      ackSpy.mockRestore()
      monitor.stop()
    })
  })
})
