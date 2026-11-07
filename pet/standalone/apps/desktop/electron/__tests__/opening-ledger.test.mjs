import { describe, expect, it } from 'vitest'

import { createCompanionService } from '../companion.mjs'

const NOW = new Date(2026, 10, 6, 10, 0, 0).getTime()
const MINUTE = 60_000

function clockAt(start) {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    }
  }
}

function memoryStore() {
  let state = null
  return {
    load: async () => state,
    save: async (next) => {
      state = JSON.parse(JSON.stringify(next))
    },
    current: () => state
  }
}

function makeService(store, clock, options = {}) {
  return createCompanionService({
    load: store.load,
    save: store.save,
    now: clock.now,
    saveDelayMs: 0,
    getSettings: () => ({}),
    log: () => {},
    ...options
  })
}

/** 固定一份节目单：10:00 开始的段，正好落进「开始后 30 分钟内」的开口窗口。 */
const PLAN = {
  date: '2026-11-06',
  generatedAt: NOW,
  source: 'model',
  segments: [
    { id: 'morning-work', startMinute: 10 * 60, endMinute: 12 * 60, title: '写东西', kind: 'work' }
  ]
}

describe('主动开口：机会账本接进陪伴层', () => {
  it('节目单段落到点时给出候选，并带上去重指纹', async () => {
    const store = memoryStore()
    const service = makeService(store, clockAt(NOW))
    await service.setAgenda(PLAN)

    const opening = await service.pickOpening()
    expect(opening).not.toBeNull()
    expect(opening.kind).toBe('agenda')
    expect(opening.segmentId).toBe('morning-work')
    expect(opening.fingerprint).toBe('agenda:morning-work')
  })

  it('说出口后计入今天；同一段认领后不再重复开口', async () => {
    const store = memoryStore()
    const service = makeService(store, clockAt(NOW))
    await service.setAgenda(PLAN)

    const opening = await service.pickOpening()
    expect(opening).not.toBeNull()
    if (opening === null) return

    expect(await service.noteSpoken(opening, '现在在写东西，刚起了个头。')).toBe(true)
    const pacing = await service.openingPacing()
    expect(pacing?.spokenToday).toBe(1)
    expect(pacing?.lastSpokenAt).toBe(NOW)

    // 节目单段靠认领去重：说过之后认领当前段，下一拍不会再提同一段。
    await service.claimAgenda()
    expect(await service.pickOpening()).toBeNull()
  })

  it('重启后仍然记得今天说过几次、上次什么时候', async () => {
    const store = memoryStore()
    const clock = clockAt(NOW)
    const first = makeService(store, clock)
    await first.setAgenda(PLAN)

    const opening = await first.pickOpening()
    if (opening === null) throw new Error('expected an opening')
    await first.noteSpoken(opening, '现在在写东西。')
    await first.flush()

    const second = makeService(store, clock)
    const pacing = await second.openingPacing()
    expect(pacing?.spokenToday).toBe(1)
    expect(pacing?.lastSpokenAt).toBe(NOW)
  })

  it('提过的话头会落盘：重启后不重复提同一件事', async () => {
    const store = memoryStore()
    const clock = clockAt(NOW)
    const first = makeService(store, clock)

    await first.beginTurn('明天要去看那个展')
    const loop = await first.pendingLoop(0)
    if (loop === null) throw new Error('expected a pending loop')

    first.markLoopNudged(loop.id)
    await first.flush()
    expect(store.current().nudgedLoops).toEqual([loop.id])

    const second = makeService(store, clock)
    expect(await second.pendingLoop(0)).toBeNull()
  })

  it('最后一次收到消息的时间会落盘：重启后仍能判断多久没联系', async () => {
    const store = memoryStore()
    const clock = clockAt(NOW)
    const first = makeService(store, clock)

    await first.beginTurn('在吗')
    await first.flush()

    clock.advance(4 * 24 * 60 * MINUTE)
    const second = makeService(store, clock)
    const opening = await second.pickOpening()
    expect(opening?.kind).toBe('absence')
  })

  it('连续开口没人接话时，间隔倍率逐级拉长；用户回话后归位', async () => {
    const store = memoryStore()
    const clock = clockAt(NOW)
    const service = makeService(store, clock)
    await service.setAgenda(PLAN)

    const opening = await service.pickOpening()
    if (opening === null) throw new Error('expected an opening')
    await service.noteSpoken(opening, '在写东西。')
    await service.noteSpoken({ kind: 'loop', reason: 'loop:a', fingerprint: 'loop:a' }, '刚才那件事。')
    await service.noteSpoken({ kind: 'loop', reason: 'loop:b', fingerprint: 'loop:b' }, '还有一件。')

    expect((await service.openingPacing())?.intervalScale).toBe(2)

    await service.beginTurn('我回来啦')
    const pacing = await service.openingPacing()
    expect(pacing?.unansweredStreak).toBe(0)
    expect(pacing?.intervalScale).toBe(1)
  })

  it('达到每日上限后不再给候选', async () => {
    const store = memoryStore()
    const service = makeService(store, clockAt(NOW), {})
    await service.setAgenda(PLAN)

    for (let index = 0; index < 8; index += 1) {
      await service.noteSpoken(
        { kind: 'loop', reason: `loop:${index}`, fingerprint: `loop:${index}` },
        `第 ${index + 1} 句。`
      )
    }

    const pacing = await service.openingPacing()
    expect(pacing?.spokenToday).toBe(8)
    expect(pacing?.blockedReason).toBe('daily_limit')
    expect(await service.pickOpening()).toBeNull()
  })

  it('免打扰和睡着时直接不给候选', async () => {
    const store = memoryStore()
    const service = makeService(store, clockAt(NOW))
    await service.setAgenda(PLAN)

    expect(await service.pickOpening({ quiet: true })).toBeNull()
    expect(await service.pickOpening({ asleep: true })).toBeNull()
  })

  it('空回复不记账，今天的机会还留着', async () => {
    const store = memoryStore()
    const service = makeService(store, clockAt(NOW))
    await service.setAgenda(PLAN)

    const opening = await service.pickOpening()
    if (opening === null) throw new Error('expected an opening')

    expect(await service.noteSpoken(opening, '')).toBe(false)
    expect(await service.noteOpeningFailed(opening)).toBe(true)

    const pacing = await service.openingPacing()
    expect(pacing?.spokenToday).toBe(0)
    expect(pacing?.lastSpokenAt).toBe(0)
  })

  it('跨天后今天次数归零，冷却时间仍然记得', async () => {
    const store = memoryStore()
    const clock = clockAt(NOW)
    const service = makeService(store, clock)
    await service.setAgenda(PLAN)

    const opening = await service.pickOpening()
    if (opening === null) throw new Error('expected an opening')
    await service.noteSpoken(opening, '在写东西。')

    clock.advance(24 * 60 * MINUTE)
    const pacing = await service.openingPacing()
    expect(pacing?.spokenToday).toBe(0)
    expect(pacing?.lastSpokenAt).toBe(NOW)
  })

  it('QQ 群插话共享日预算，但不把群里的沉默算进桌面降速', async () => {
    const store = memoryStore()
    const clock = clockAt(NOW)
    const service = makeService(store, clock)

    expect(await service.allowsSharedOpening('qq:group:g1:name_only')).toEqual({
      allowed: true,
      reason: null
    })

    await service.noteSharedOpening('qq:group:g1:name_only')

    const pacing = await service.openingPacing()
    expect(pacing?.spokenToday).toBe(1)
    expect(pacing?.unansweredStreak).toBe(0)
    expect(await service.allowsSharedOpening('qq:group:g1:name_only')).toEqual({
      allowed: false,
      reason: 'duplicate'
    })
  })

  it('陪伴层关掉时群插话照常放行，不额外设限', async () => {
    const store = memoryStore()
    const clock = clockAt(NOW)
    const service = makeService(store, clock, {
      getSettings: () => ({ companion: { companionLayer: { enabled: false } } })
    })

    expect(await service.allowsSharedOpening('qq:group:g1:name_only')).toEqual({
      allowed: true,
      reason: null
    })
    expect(await service.noteSharedOpening('qq:group:g1:name_only')).toBe(false)
  })
})
