import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INTERVAL_MS, createBalancePoller } from '../balance-polling.mjs'

describe('余额轮询调度器', () => {
  let poller = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    poller?.stop()
    poller = null
    vi.useRealTimers()
  })

  it('推进不足一个 interval 不触发', async () => {
    const tick = vi.fn()
    poller = createBalancePoller({ tick, intervalMs: 30_000 })
    expect(poller.start()).toBe(true)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(tick).not.toHaveBeenCalled()
  })

  it('推进到一个 interval 触发一次，stop 后不再触发', async () => {
    const tick = vi.fn()
    poller = createBalancePoller({ tick, intervalMs: 30_000 })
    poller.start()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(tick).toHaveBeenCalledTimes(1)

    expect(poller.stop()).toBe(true)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(tick).toHaveBeenCalledTimes(1)
    expect(poller.isRunning()).toBe(false)
  })

  it('改 interval 立即生效，下一次按新间隔从当下重新计时', async () => {
    const tick = vi.fn()
    poller = createBalancePoller({ tick, intervalMs: 30_000 })
    poller.start()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(poller.updateInterval(10_000)).toBe(true)
    expect(poller.getIntervalMs()).toBe(10_000)

    await vi.advanceTimersByTimeAsync(9_999)
    expect(tick).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('start 与 stop 都幂等', () => {
    poller = createBalancePoller({ tick: vi.fn(), intervalMs: 30_000 })
    expect(poller.start()).toBe(true)
    expect(poller.start()).toBe(false)
    expect(poller.stop()).toBe(true)
    expect(poller.stop()).toBe(false)
  })

  it('不传 interval 时用默认 30 分钟', () => {
    poller = createBalancePoller({ tick: vi.fn() })
    expect(DEFAULT_INTERVAL_MS).toBe(30 * 60 * 1000)
    expect(poller.getIntervalMs()).toBe(DEFAULT_INTERVAL_MS)
  })

  it('tick 抛错交给 onError，下一轮仍然继续', async () => {
    const error = new Error('boom')
    const onError = vi.fn()
    const tick = vi.fn(() => {
      throw error
    })
    poller = createBalancePoller({ tick, intervalMs: 30_000, onError })
    poller.start()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(onError).toHaveBeenCalledWith(error)
    expect(tick).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('上一轮没结束时跳过本轮，不叠罗汉', async () => {
    let release = null
    const tick = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    poller = createBalancePoller({ tick, intervalMs: 30_000 })
    poller.start()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(tick).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(tick).toHaveBeenCalledTimes(1)

    release()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('timer 默认 unref，显式 unref:false 时保留引用', () => {
    const timer = { unref: vi.fn() }
    poller = createBalancePoller({
      tick: vi.fn(),
      intervalMs: 30_000,
      setInterval: () => timer,
      clearInterval: vi.fn()
    })
    poller.start()
    expect(timer.unref).toHaveBeenCalledTimes(1)
    poller.stop()

    const kept = { unref: vi.fn() }
    poller = createBalancePoller({
      tick: vi.fn(),
      intervalMs: 30_000,
      setInterval: () => kept,
      clearInterval: vi.fn(),
      unref: false
    })
    poller.start()
    expect(kept.unref).not.toHaveBeenCalled()
  })
})
