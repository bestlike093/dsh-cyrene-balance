import { describe, expect, it } from 'vitest'
import { createEmotionRuntime, emotionFromAfterglow } from '../emotion-runtime.mjs'

const MINUTE = 60_000

function settings(overrides = {}) {
  return {
    companion: {
      emotion: {
        afterglow: { enabled: false, halfLifeMinutes: 30 },
        expression: { group: 'off' },
        needs: { enabled: false },
        ...overrides
      }
    }
  }
}

function runtimeWith(config, now = () => 0) {
  return createEmotionRuntime({ getSettings: () => config, now })
}

describe('情绪余波', () => {
  it('默认关闭时什么都没发生', () => {
    const runtime = runtimeWith(settings())
    runtime.noteUserTurn({ emotion: 'happy' })

    const snapshot = runtime.snapshot()
    expect(snapshot.afterglow.valence).toBe(0)
    expect(snapshot.afterglow.arousal).toBe(0)
    expect(runtime.decideExpression('happy')).toMatchObject({ tag: 'happy', group: 'off', changed: false })
  })

  it('打开后一次刺激留下读数，并按半衰期回落', () => {
    let clock = 0
    const runtime = runtimeWith(
      settings({ afterglow: { enabled: true, halfLifeMinutes: 30 } }),
      () => clock
    )

    runtime.noteUserTurn({ emotion: 'happy' })
    const peak = runtime.snapshot().afterglow
    expect(peak.valence).toBeGreaterThan(0)

    clock += 30 * MINUTE
    const faded = runtime.snapshot().afterglow
    expect(faded.valence).toBeGreaterThan(0)
    expect(faded.valence).toBeLessThan(peak.valence)
  })

  it('半衰期会被夹在 1 到 720 分钟之间', () => {
    const tooShort = runtimeWith(settings({ afterglow: { enabled: true, halfLifeMinutes: 0 } }))
    expect(tooShort.snapshot().enabled.afterglow.halfLifeMinutes).toBe(1)

    const tooLong = runtimeWith(settings({ afterglow: { enabled: true, halfLifeMinutes: 99999 } }))
    expect(tooLong.snapshot().enabled.afterglow.halfLifeMinutes).toBe(720)
  })

  it('余波读数能翻译成情绪标签，接近零时保持 neutral', () => {
    expect(emotionFromAfterglow(null)).toBe('neutral')
    expect(emotionFromAfterglow({ valence: 0, arousal: 0 })).toBe('neutral')
    expect(emotionFromAfterglow({ valence: 0.4, arousal: 0.3 })).toBe('happy')
    expect(emotionFromAfterglow({ valence: 0.6, arousal: 0.9 })).toBe('excited')
    expect(emotionFromAfterglow({ valence: -0.5, arousal: 0.4 })).toBe('sad')
    expect(emotionFromAfterglow({ valence: 0, arousal: 0.85 })).toBe('surprised')
    expect(emotionFromAfterglow({ valence: 0, arousal: 0.14 })).toBe('tired')
  })
})

describe('表情实验', () => {
  it('实验组按情绪换表情并累计命中数', () => {
    const runtime = runtimeWith(settings({ expression: { group: 'experiment' } }))

    expect(runtime.decideExpression('happy')).toMatchObject({ tag: 'happy', group: 'experiment' })
    expect(runtime.decideExpression('sad')).toMatchObject({ tag: 'sad' })

    const stats = runtime.snapshot().expression.stats
    expect(stats.total).toBe(2)
    expect(stats.changed).toBe(2)
  })

  it('对照组保持原表情，只记下本会换成什么', () => {
    const runtime = runtimeWith(settings({ expression: { group: 'control' } }))

    const decision = runtime.decideExpression('happy')
    expect(decision.tag).toBe('happy')
    expect(decision.changed).toBe(false)
    expect(decision.group).toBe('control')
    expect(decision.emotion).toBe('happy')
    expect(runtime.snapshot().expression.stats.total).toBe(1)
  })

  it('当前这一轮没有情绪时，用余波读数兜底', () => {
    let clock = 0
    const runtime = runtimeWith(
      settings({
        afterglow: { enabled: true, halfLifeMinutes: 30 },
        expression: { group: 'experiment' }
      }),
      () => clock
    )

    runtime.noteUserTurn({ emotion: 'happy' })
    runtime.noteUserTurn({ emotion: 'happy' })
    clock += MINUTE
    expect(runtime.decideExpression('neutral').tag).toBe('happy')
  })

  it('分组值不合法时退回 off', () => {
    const runtime = runtimeWith(settings({ expression: { group: 'whatever' } }))
    expect(runtime.snapshot().enabled.expressionGroup).toBe('off')
    expect(runtime.decideExpression('happy').changed).toBe(false)
  })
})

describe('需求状态', () => {
  it('默认关闭时从不要求少说一句', () => {
    const runtime = runtimeWith(settings())
    expect(runtime.shouldHoldBackOpening()).toBe(false)
  })

  it('休息需求攒满时才压低主动开口', () => {
    let clock = 0
    const hour = 3_600_000
    const runtime = runtimeWith(settings({ needs: { enabled: true } }), () => clock)

    expect(runtime.shouldHoldBackOpening()).toBe(false)

    // 七小时不动，休息需求按每小时 0.15 自然回升到封顶。
    clock += 7 * hour
    expect(runtime.shouldHoldBackOpening()).toBe(true)
  })

  it('对话会满足连接与成就需求', () => {
    let clock = 0
    const hour = 3_600_000
    const runtime = runtimeWith(settings({ needs: { enabled: true } }), () => clock)
    // 先建出实例，之后的时间才会被算作自然回升。
    runtime.snapshot()

    clock += 4 * hour
    const before = runtime.snapshot().needs.levels.connection
    expect(before).toBeGreaterThan(0)

    runtime.noteUserTurn({ emotion: 'neutral' })
    runtime.noteAssistantReply()

    const after = runtime.snapshot().needs
    expect(after.levels.connection).toBeLessThan(before)
    expect(after.levels.rest).toBeGreaterThan(0)
  })
})
