import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgendaRuntime, DEFAULT_SUSPEND_LIMITS } from '../agenda-runtime.mjs'

function runtimeAt() {
  let now = new Date(2026, 10, 6, 15, 0, 0).getTime()
  const runtime = createAgendaRuntime({ now: () => now })
  return {
    runtime,
    tick: (ms) => (now += ms),
    set: (value) => (now = value)
  }
}

describe('createAgendaRuntime', () => {
  it('初始不在陪对方', () => {
    const { runtime } = runtimeAt()
    expect(runtime.snapshot()).toMatchObject({ suspended: false, remainingMs: 0 })
  })

  it('默认陪十分钟，到点自动回到日程', () => {
    const { runtime, tick } = runtimeAt()
    const started = runtime.suspend({ segmentId: 'work', title: '做自己的事' })

    expect(started.suspended).toBe(true)
    expect(started.remainingMs).toBe(DEFAULT_SUSPEND_LIMITS.defaultMs)
    expect(started).toMatchObject({ segmentId: 'work', title: '做自己的事', reason: 'chat' })

    tick(DEFAULT_SUSPEND_LIMITS.defaultMs)
    expect(runtime.isSuspended()).toBe(false)
    expect(runtime.snapshot().remainingMs).toBe(0)
  })

  it('反复续期也不会超过从首次开始算的 30 分钟', () => {
    const { runtime, tick } = runtimeAt()
    runtime.suspend({ minutes: 10 })
    tick(9 * 60 * 1000)
    runtime.suspend({ minutes: 30 })
    tick(9 * 60 * 1000)
    const last = runtime.suspend({ minutes: 30 })

    // 从首次开始最多 30 分钟，第二次续期时已经用掉 18 分钟，只剩 12 分钟。
    expect(last.remainingMs).toBeLessThanOrEqual(12 * 60 * 1000)
    expect(last.until - last.startedAt).toBeLessThanOrEqual(DEFAULT_SUSPEND_LIMITS.maxMs)
  })

  it('时长夹在 1 到 30 分钟之间', () => {
    const { runtime } = runtimeAt()
    expect(runtime.suspend({ minutes: 0 }).remainingMs).toBe(60 * 1000)
    expect(runtime.resume())

    const long = runtime.suspend({ minutes: 999 })
    expect(long.remainingMs).toBe(DEFAULT_SUSPEND_LIMITS.maxMs)
  })

  it('跨天自动清空', () => {
    const { runtime, set } = runtimeAt()
    runtime.suspend({ minutes: 30 })
    set(new Date(2026, 10, 7, 9, 0, 0).getTime())
    expect(runtime.snapshot()).toMatchObject({ suspended: false, date: '' })
  })

  it('手动恢复会立即清空', () => {
    const { runtime } = runtimeAt()
    runtime.suspend({ minutes: 20 })
    const resumed = runtime.resume()
    expect(resumed).toMatchObject({ suspended: false, remainingMs: 0 })
    expect(runtime.isSuspended()).toBe(false)
  })

  it('睡觉被打断会单独标出来，普通挂起不会', () => {
    const { runtime } = runtimeAt()
    const sleep = runtime.suspend({ segmentId: 'sleep', title: '睡觉', kind: 'sleep' })
    expect(sleep).toMatchObject({ suspended: true, interrupted: true, kind: 'sleep' })

    runtime.resume()
    const work = runtime.suspend({ segmentId: 'work', title: '做自己的事', kind: 'work' })
    expect(work).toMatchObject({ suspended: true, interrupted: false, kind: 'work' })
  })
})

describe('createAgendaRuntime 持久化', () => {
  it('旧文件补 schemaVersion，落盘前留 .bak', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-'))
    const file = path.join(dir, 'agenda-state.json')
    const now = new Date(2026, 10, 6, 15, 0, 0).getTime()
    await fs.writeFile(
      file,
      JSON.stringify({ state: { date: '2026-11-06', segmentId: 'work', until: now + 60_000 } }),
      'utf8'
    )

    const runtime = createAgendaRuntime({ file, now: () => now })
    await runtime.ready()
    expect(runtime.snapshot()).toMatchObject({ suspended: true, segmentId: 'work' })

    runtime.suspend({ minutes: 5 })
    await runtime.flush()

    const saved = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(saved.schemaVersion).toBe(2)
    const backup = JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))
    expect(backup.state.segmentId).toBe('work')
  })

  it('新版文件再次读取不重复写 .bak', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-'))
    const file = path.join(dir, 'agenda-state.json')
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 2, state: {} }), 'utf8')

    const runtime = createAgendaRuntime({ file })
    await runtime.ready()
    runtime.suspend({ minutes: 3 })
    await runtime.flush()
    await expect(fs.access(`${file}.bak`)).rejects.toThrow()
  })

  it('睡眠打断的标记会一起落盘，重启后还能区分', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agenda-'))
    const file = path.join(dir, 'agenda-state.json')
    const now = new Date(2026, 10, 6, 2, 0, 0).getTime()

    const first = createAgendaRuntime({ file, now: () => now })
    await first.ready()
    first.suspend({ segmentId: 'sleep', title: '睡觉', kind: 'sleep', minutes: 10 })
    await first.flush()

    const second = createAgendaRuntime({ file, now: () => now + 60_000 })
    await second.ready()
    expect(second.snapshot()).toMatchObject({ suspended: true, interrupted: true, title: '睡觉' })
  })
})
