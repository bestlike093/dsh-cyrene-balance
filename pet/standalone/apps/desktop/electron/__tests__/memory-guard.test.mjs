import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_CRITICAL_BYTES, MEMORY_WARN_BYTES, createMemoryGuard } from '../memory-guard.mjs'

const MB = 1024 * 1024
const WARN = 800 * MB
const CRITICAL = 1200 * MB

function usage(rssMb) {
  return { rss: rssMb * MB, heapUsed: rssMb * 0.4 * MB, heapTotal: rssMb * 0.5 * MB, external: 10 * MB }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createMemoryGuard', () => {
  it('阈值按报告第七节导出', () => {
    expect(MEMORY_WARN_BYTES).toBe(WARN)
    expect(MEMORY_CRITICAL_BYTES).toBe(CRITICAL)
  })

  it('低于 800 MB 不记日志、不释放', async () => {
    const log = vi.fn()
    const onRelease = vi.fn()
    const guard = createMemoryGuard({ sample: () => usage(300), log, onRelease, now: () => 0 })
    const snapshot = await guard.check()
    expect(snapshot.level).toBe('ok')
    expect(snapshot.rssMb).toBe(300)
    expect(log).not.toHaveBeenCalled()
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('超过 800 MB 只记一条 warn，不释放', async () => {
    const log = vi.fn()
    const onRelease = vi.fn()
    let clock = 0
    const guard = createMemoryGuard({ sample: () => usage(900), log, onRelease, now: () => clock })
    await guard.check()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('900')
    // 同一档位 5 分钟内再采不重复刷日志。
    clock += 60_000
    await guard.check()
    expect(log).toHaveBeenCalledTimes(1)
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('超过 1.2 GB 触发释放并通知，只触发一次', async () => {
    const log = vi.fn()
    const onRelease = vi.fn(async () => {})
    const notify = vi.fn()
    const guard = createMemoryGuard({ sample: () => usage(1300), log, onRelease, notify, now: () => 0 })
    const snapshot = await guard.check()
    expect(snapshot.level).toBe('critical')
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
    await guard.check()
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(guard.status().releaseCount).toBe(1)
  })

  it('释放回调抛错时不崩，仍然记一次失败日志', async () => {
    const log = vi.fn()
    const guard = createMemoryGuard({
      sample: () => usage(1300),
      onRelease: async () => {
        throw new Error('boom')
      },
      log,
      now: () => 0
    })
    await expect(guard.check()).resolves.toBeTruthy()
    expect(log.mock.calls.some(([msg]) => msg.includes('释放缓存失败'))).toBe(true)
    expect(guard.status().releaseCount).toBe(0)
  })

  it('读取内存失败时返回上一次快照，不抛错', async () => {
    const log = vi.fn()
    const guard = createMemoryGuard({
      sample: () => {
        throw new Error('nope')
      },
      log,
      now: () => 0
    })
    await expect(guard.check()).resolves.toBeNull()
    expect(log.mock.calls[0][0]).toContain('读取内存占用失败')
  })

  it('start 会定时采样，stop 后停止', async () => {
    vi.useFakeTimers()
    const sample = vi.fn(() => usage(300))
    const guard = createMemoryGuard({ sample, intervalMs: 60_000 })
    guard.start()
    expect(sample).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sample).toHaveBeenCalledTimes(2)
    expect(guard.status().running).toBe(true)
    guard.stop()
    expect(guard.status().running).toBe(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sample).toHaveBeenCalledTimes(2)
  })

  it('status 里带阈值与最后一次快照', async () => {
    const guard = createMemoryGuard({ sample: () => usage(500), now: () => 123 })
    await guard.check()
    const status = guard.status()
    expect(status.thresholds).toEqual({ warnMb: 800, criticalMb: 1200 })
    expect(status.last.at).toBe(123)
    expect(status.last.rssMb).toBe(500)
    expect(status.intervalMs).toBe(60_000)
  })
})
