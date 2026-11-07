import { describe, expect, it } from 'vitest'
import { createInsightService } from '../insight.mjs'

function makeSources(overrides = {}) {
  let historyCalls = 0
  const chatHistoryStore = {
    stats() {
      historyCalls += 1
      return { scopes: { desktop: 12, 'qq:group:g1': 4 } }
    },
    recent() {
      return [
        { role: 'user', text: '桌面的一句', at: '2026-11-06T08:00:00.000Z', scope: 'desktop' },
        { role: 'user', text: '群里的一句', at: '2026-11-06T09:00:00.000Z', scope: 'qq:group:g1' }
      ]
    }
  }
  const memoryStore = {
    stats() {
      return {
        available: true,
        count: 9,
        limit: 500,
        updatedAt: 1_760_000_000_000,
        layers: { raw: 5, episode: 2, fact: 1, lesson: 1 },
        scopes: { desktop: 6, 'qq:group:g1': 3 },
        cold: 2
      }
    },
    list(options = {}) {
      return {
        total: 9,
        offset: options.offset ?? 0,
        limit: options.limit ?? 20,
        items: [
          {
            id: 'm1',
            role: 'user',
            text: '一页里的一条',
            at: '2026-11-06T08:00:00.000Z',
            scope: 'desktop',
            layer: 'raw',
            cold: false
          }
        ]
      }
    }
  }
  const socialProfileStore = {
    snapshot() {
      return {
        total: 1,
        profiles: [
          {
            scope: 'qq:group:g1',
            samples: 24,
            updatedAt: 1_760_000_100_000,
            stats: { sampleSize: 24, avgChars: 12 }
          }
        ]
      }
    }
  }
  const thoughtPool = {
    snapshot() {
      return {
        total: 3,
        counts: { open: 1, used: 2, expired: 0, dropped: 0 },
        open: [{ id: 't1', text: '想问一句' }],
        decisions: [{ at: 1, scope: 'desktop', speak: false, gate: 'cooldown', reason: 'resting' }]
      }
    }
  }
  const agendaRuntime = {
    snapshot() {
      return { suspended: false, date: '2026-11-06', title: '午后慢一点', remainingMs: 0 }
    }
  }
  const bodyService = {
    snapshot() {
      return { energy: 64, drowsiness: 30, flags: { sleepy: false } }
    },
    describe() {
      return '有点困，但还撑得住'
    }
  }
  const presenceService = {
    async peekContext() {
      return {
        mood: { level: 'calm', label: '平静' },
        sessionMinutes: 42,
        recentLines: ['窗外的风好轻'],
        weather: null,
        lifestyle: {
          festival: null,
          outfit: { key: 'cool', label: '微凉', tip: '薄外套配长袖，早晚会差一点' }
        },
        time: { hour: 16 }
      }
    }
  }
  return {
    chatHistoryStore,
    memoryStore,
    socialProfileStore,
    thoughtPool,
    agendaRuntime,
    bodyService,
    presenceService,
    historyCalls: () => historyCalls,
    ...overrides
  }
}

describe('观察台快照', () => {
  it('会话按最近说话时间排序，并挂上画像', async () => {
    const sources = makeSources()
    const insight = createInsightService(sources)
    const snapshot = await insight.snapshot()

    expect(snapshot.sessions.map((item) => item.scope)).toEqual(['qq:group:g1', 'desktop'])
    expect(snapshot.sessions[0]).toMatchObject({
      scope: 'qq:group:g1',
      messages: 4,
      profile: { samples: 24 }
    })
    expect(snapshot.sessions[1].profile).toBeNull()
  })

  it('会话带上好感与锁定状态，但不带印象原文', async () => {
    const sources = makeSources({
      affinity: {
        snapshot: (scope) => ({
          favor: scope === 'desktop' ? 42 : 7,
          locked: scope === 'desktop',
          impression: '不该出现在快照里'
        })
      }
    })
    const insight = createInsightService(sources)
    const snapshot = await insight.snapshot()
    const desktop = snapshot.sessions.find((item) => item.scope === 'desktop')
    expect(desktop).toMatchObject({ favor: 42, locked: true })
    expect(snapshot.sessions.find((item) => item.scope === 'qq:group:g1').favor).toBe(7)
    expect(JSON.stringify(snapshot)).not.toContain('不该出现在快照里')
  })

  it('会话带档位与最近五次手动调整，仍不带关系原文', async () => {
    const manualLog = Array.from({ length: 7 }, (_, index) => ({
      at: 1_760_000_000_000 + index,
      before: index,
      after: index + 1,
      delta: 1,
      note: `第 ${index} 次`
    }))
    const sources = makeSources({
      affinity: {
        snapshot: (scope) =>
          scope === 'desktop'
            ? {
                favor: 72,
                locked: false,
                level: '亲近',
                levelId: 'close',
                address: '叫名字',
                initiative: '会主动搭话',
                boundary: '不追问私事',
                pace: '慢一点',
                impression: '不该出现的关系原文',
                relation: '也不该出现',
                read: '更不该出现',
                adjust: '同样不该出现',
                manualLog
              }
            : { favor: 3, locked: false }
      }
    })
    const insight = createInsightService(sources)
    const snapshot = await insight.snapshot()
    const desktop = snapshot.sessions.find((item) => item.scope === 'desktop')

    expect(desktop).toMatchObject({
      favor: 72,
      level: '亲近',
      levelId: 'close',
      address: '叫名字',
      initiative: '会主动搭话',
      boundary: '不追问私事',
      pace: '慢一点'
    })
    expect(desktop.manualLog).toHaveLength(5)
    expect(desktop.manualLog[0]).toMatchObject({ before: 0, after: 1, delta: 1, note: '第 0 次' })
    expect(desktop.manualLog[4].note).toBe('第 4 次')
    expect(JSON.stringify(snapshot)).not.toContain('不该出现')
    expect(JSON.stringify(snapshot)).not.toContain('也不该出现')
    expect(JSON.stringify(snapshot)).not.toContain('同样不该出现')
  })

  it('记忆只给计数与层分布，不带原文', async () => {
    const insight = createInsightService(makeSources())
    const snapshot = await insight.snapshot()
    expect(snapshot.memory).toMatchObject({
      count: 9,
      layers: { raw: 5, episode: 2, fact: 1, lesson: 1 },
      cold: 2
    })
    expect(JSON.stringify(snapshot.memory)).not.toContain('一页里的一条')
  })

  it('念头、日程、身体、情境各段都在', async () => {
    const insight = createInsightService(makeSources())
    const snapshot = await insight.snapshot()
    expect(snapshot.thoughts.counts.open).toBe(1)
    expect(snapshot.thoughts.decisions[0].gate).toBe('cooldown')
    expect(snapshot.agenda.title).toBe('午后慢一点')
    expect(snapshot.body.text).toBe('有点困，但还撑得住')
    expect(snapshot.presence.sessionMinutes).toBe(42)
    expect(snapshot.presence.lifestyle.outfit.label).toBe('微凉')
    expect(snapshot.errors).toEqual([])
  })

  it('主动开口带上额度、间隔与最近判断的计数', async () => {
    const insight = createInsightService(
      makeSources({
        proactiveGate: {
          snapshot: () => ({
            count: 2,
            dailyLimit: 3,
            minGapMs: 30 * 60 * 1000,
            nextAllowedAt: 1_760_000_900_000,
            lastSpokeAt: 1_760_000_000_000,
            silenced: true,
            silenceReason: 'silent_giveup',
            openLoopCount: 2
          })
        }
      })
    )
    const snapshot = await insight.snapshot()
    expect(snapshot.proactive).toMatchObject({
      count: 2,
      dailyLimit: 3,
      minGapMs: 30 * 60 * 1000,
      silenced: true,
      silenceReason: 'silent_giveup',
      openLoopCount: 2,
      spoken: 0,
      held: 1
    })
  })

  it('忍住的理由按次数从多到少排，开口的不算在内', async () => {
    const decisions = [
      { at: 1, scope: 'desktop', speak: false, gate: 'hard', reason: 'quiet_hours' },
      { at: 2, scope: 'desktop', speak: false, gate: 'hard', reason: 'daily_limit' },
      { at: 3, scope: 'desktop', speak: false, gate: 'hard', reason: 'quiet_hours' },
      { at: 4, scope: 'desktop', speak: false, gate: 'hard', reason: 'daily_limit' },
      { at: 5, scope: 'desktop', speak: false, gate: 'hard', reason: 'quiet_hours' },
      { at: 6, scope: 'desktop', speak: true, gate: 'open', reason: 'topic_match' }
    ]
    const insight = createInsightService(
      makeSources({
        proactiveGate: {
          snapshot: () => ({
            count: 1,
            dailyLimit: 3,
            minGapMs: 30 * 60 * 1000,
            nextAllowedAt: 0,
            lastSpokeAt: 0,
            silenced: false,
            silenceReason: '',
            openLoopCount: 0
          })
        },
        thoughtPool: {
          snapshot: () => ({
            total: 6,
            counts: { open: 0, used: 0, expired: 0, dropped: 0 },
            open: [],
            decisions
          })
        }
      })
    )
    const snapshot = await insight.snapshot()
    expect(snapshot.proactive.reasonCounts).toEqual([
      { reason: 'quiet_hours', count: 3 },
      { reason: 'daily_limit', count: 2 }
    ])
    expect(snapshot.proactive.spoken).toBe(1)
    expect(snapshot.proactive.held).toBe(5)
  })

  it('500ms 内复用同一份快照', async () => {
    let now = 1_760_000_000_000
    const sources = makeSources()
    const insight = createInsightService({ ...sources, now: () => now })
    await insight.snapshot()
    await insight.snapshot()
    expect(sources.historyCalls()).toBe(1)

    now += 600
    await insight.snapshot()
    expect(sources.historyCalls()).toBe(2)
  })
})

describe('缺数据与坏数据', () => {
  it('什么都没接时返回空快照，不抛错', async () => {
    const insight = createInsightService()
    const snapshot = await insight.snapshot()
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.memory).toBeNull()
    expect(snapshot.presence).toBeNull()
    expect(snapshot.proactive).toBeNull()
    expect(snapshot.errors).toContain('memory-unavailable')
    expect(snapshot.errors).toContain('presence-unavailable')
  })

  it('单个源抛错不拖垮其它段', async () => {
    const sources = makeSources({
      thoughtPool: {
        snapshot() {
          throw new Error('pool 坏了')
        }
      }
    })
    const insight = createInsightService(sources)
    const snapshot = await insight.snapshot()
    expect(snapshot.thoughts).toBeNull()
    expect(snapshot.errors).toContain('thoughts-unavailable')
    expect(snapshot.memory.count).toBe(9)
    expect(snapshot.agenda.title).toBe('午后慢一点')
  })

  it('情境读取异步失败也只影响自己', async () => {
    const sources = makeSources({
      presenceService: {
        async peekContext() {
          throw new Error('天气接口挂了')
        }
      }
    })
    const insight = createInsightService(sources)
    const snapshot = await insight.snapshot()
    expect(snapshot.presence).toBeNull()
    expect(snapshot.body.energy).toBe(64)
  })
})

describe('记忆分页', () => {
  it('一页最多 20 条，offset 透传给存储', () => {
    let received = null
    const insight = createInsightService({
      memoryStore: {
        list(options) {
          received = options
          return { total: 100, offset: options.offset, limit: options.limit, items: [] }
        }
      }
    })
    insight.memoryPage({ offset: 40, limit: 500, layer: 'fact', scope: 'desktop' })
    expect(received).toMatchObject({ offset: 40, limit: 20, layer: 'fact', scope: 'desktop' })
  })

  it('存储不可用时给空页并标记', () => {
    const insight = createInsightService()
    expect(insight.memoryPage({ offset: 0 })).toMatchObject({
      total: 0,
      items: [],
      unavailable: true
    })
  })
})

describe('被叫到的次数', () => {
  it('按会话累计，并让缓存失效', async () => {
    let now = 1_760_000_000_000
    const sources = makeSources()
    const insight = createInsightService({ ...sources, now: () => now })

    insight.noteWake('desktop')
    insight.noteWake('qq:group:g1')
    insight.noteWake('desktop')
    const snapshot = await insight.snapshot()
    expect(snapshot.wake).toMatchObject({
      total: 3,
      byScope: { desktop: 2, 'qq:group:g1': 1 }
    })
  })
})

describe('跨窗口承接', () => {
  const at = 1_760_000_000_000

  it('没接承接记录时给空列表，不算错误', async () => {
    const snapshot = await createInsightService(makeSources()).snapshot()
    expect(snapshot.handoffs).toEqual([])
    expect(snapshot.errors).not.toContain('handoffs-unavailable')
  })

  it('接上以后只给方向、摘要与过期时间，最新在前', async () => {
    const insight = createInsightService({
      ...makeSources(),
      now: () => at,
      handoffStore: {
        list: () => [
          { fromScope: 'desktop', toScope: 'qq:private:u1', topic: '刚才在说「加班」', createdAt: at, ttlMs: 7_200_000 },
          { fromScope: 'qq:private:u1', toScope: 'desktop', topic: '刚才在说「猫」', createdAt: at - 60_000, ttlMs: 7_200_000 }
        ]
      }
    })
    const snapshot = await insight.snapshot()

    expect(snapshot.handoffs.map((item) => item.topic)).toEqual([
      '刚才在说「加班」',
      '刚才在说「猫」'
    ])
    expect(snapshot.handoffs[0]).toEqual({
      fromScope: 'desktop',
      toScope: 'qq:private:u1',
      topic: '刚才在说「加班」',
      createdAt: at,
      expiresAt: at + 7_200_000
    })
    expect(snapshot.errors).not.toContain('handoffs-unavailable')
  })

  it('已经过期的承接不再露出来', async () => {
    const insight = createInsightService({
      ...makeSources(),
      now: () => at,
      handoffStore: {
        list: () => [
          { fromScope: 'desktop', toScope: 'qq:private:u1', topic: '旧话', createdAt: at - 9_000_000, ttlMs: 7_200_000 }
        ]
      }
    })
    const snapshot = await insight.snapshot()
    expect(snapshot.handoffs).toEqual([])
  })

  it('读不出来时给空列表并标一条', async () => {
    const insight = createInsightService({
      ...makeSources(),
      handoffStore: {
        list() {
          throw new Error('承接记录坏了')
        }
      }
    })
    const snapshot = await insight.snapshot()
    expect(snapshot.handoffs).toEqual([])
    expect(snapshot.errors).toContain('handoffs-unavailable')
  })
})
