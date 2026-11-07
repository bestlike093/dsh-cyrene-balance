/**
 * 情绪运行时：把 core 里三块「默认关闭」的能力接进主进程。
 *
 * - 余波：一句话的情绪结束后缓慢回落，不让表情瞬间归零；
 * - 表情实验：按此刻情绪决定要不要换表情，并留下对照计数；
 * - 需求：连接 / 新鲜 / 成就 / 休息四类状态，用来调节主动开口的分寸。
 *
 * 三块都只在设置里显式打开后才生效；关着的时候所有方法都退化成
 * 「什么都不做」，调用方不需要额外判断。
 */

import { EmotionAfterglow, ExpressionExperiment, NeedsState } from '@pet/core/browser'

const EXPRESSION_GROUPS = new Set(['off', 'experiment', 'control'])
const DEFAULT_HALF_LIFE_MINUTES = 30
const MIN_HALF_LIFE_MINUTES = 1
const MAX_HALF_LIFE_MINUTES = 720

/** 心情标签 → 一次刺激的目标值。只影响表现层，不写进任何提示词。 */
const IMPULSE_BY_EMOTION = {
  happy: { valence: 0.5, arousal: 0.55 },
  excited: { valence: 0.7, arousal: 0.85 },
  shy: { valence: 0.4, arousal: 0.35 },
  gentle: { valence: 0.35, arousal: 0.25 },
  sad: { valence: -0.6, arousal: 0.25 },
  angry: { valence: -0.5, arousal: 0.8 },
  surprised: { valence: 0.1, arousal: 0.85 },
  tired: { valence: -0.15, arousal: 0.1 },
  thinking: { valence: 0.1, arousal: 0.45 },
  neutral: { valence: 0, arousal: 0.3 }
}

/**
 * 余波读数 → 情绪标签。
 *
 * 只在当前这一轮没有明确情绪时用它兜底；两个值都接近零就保持 neutral，
 * 免得一个空状态被读成「没力气」。
 */
export function emotionFromAfterglow(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return 'neutral'
  const valence = Number.isFinite(snapshot.valence) ? snapshot.valence : 0
  const arousal = Number.isFinite(snapshot.arousal) ? snapshot.arousal : 0

  if (Math.abs(valence) < 0.08 && arousal < 0.12) return 'neutral'
  if (valence >= 0.25) return arousal >= 0.65 ? 'excited' : 'happy'
  if (valence <= -0.25) return 'sad'
  if (arousal >= 0.7) return 'surprised'
  if (arousal <= 0.15) return 'tired'
  return 'neutral'
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readEmotionSettings(getSettings) {
  let settings
  try {
    settings = getSettings()
  } catch {
    settings = null
  }
  const raw = settings?.companion?.emotion
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  const afterglow = value.afterglow !== null && typeof value.afterglow === 'object' ? value.afterglow : {}
  const expression = value.expression !== null && typeof value.expression === 'object' ? value.expression : {}
  const needs = value.needs !== null && typeof value.needs === 'object' ? value.needs : {}

  return {
    afterglow: {
      enabled: afterglow.enabled === true,
      halfLifeMinutes: clampNumber(
        Number(afterglow.halfLifeMinutes),
        MIN_HALF_LIFE_MINUTES,
        MAX_HALF_LIFE_MINUTES,
        DEFAULT_HALF_LIFE_MINUTES
      )
    },
    expressionGroup: EXPRESSION_GROUPS.has(expression.group) ? expression.group : 'off',
    needsEnabled: needs.enabled === true
  }
}

export function createEmotionRuntime(options = {}) {
  const { getSettings = () => ({}), now = Date.now, log = () => {} } = options

  let afterglow = null
  let expression = null
  let needs = null
  let signature = ''
  let activeHalfLifeMinutes = null

  /**
   * 设置改了就重建。
   *
   * 余波与需求没有「保留旧值改配置」的语义，重建最干净；
   * 表情实验的计数要跨设置变更保留，所以只在分组变化时 setGroup。
   */
  function sync() {
    const config = readEmotionSettings(getSettings)
    const nextSignature = `${config.afterglow.enabled ? 1 : 0}:${config.afterglow.halfLifeMinutes}:${config.expressionGroup}:${config.needsEnabled ? 1 : 0}`
    if (nextSignature === signature) return config

    // 重建余波时不做状态迁移：它的生命周期就是一小段时间，
    // 改半衰期意味着换了一套回落规则，从零开始更符合直觉。
    if (afterglow === null || afterglow.isEnabled !== config.afterglow.enabled) {
      afterglow = new EmotionAfterglow({
        now,
        enabled: config.afterglow.enabled,
        halfLifeMs: config.afterglow.halfLifeMinutes * 60_000
      })
    } else if (
      activeHalfLifeMinutes !== null &&
      activeHalfLifeMinutes !== config.afterglow.halfLifeMinutes
    ) {
      afterglow = new EmotionAfterglow({
        now,
        enabled: config.afterglow.enabled,
        halfLifeMs: config.afterglow.halfLifeMinutes * 60_000
      })
    }
    activeHalfLifeMinutes = config.afterglow.halfLifeMinutes

    if (expression === null) {
      expression = new ExpressionExperiment({ group: config.expressionGroup, now })
    } else if (expression.currentGroup !== config.expressionGroup) {
      expression.setGroup(config.expressionGroup)
    }

    if (needs === null || needs.isEnabled !== config.needsEnabled) {
      needs = new NeedsState({ now, enabled: config.needsEnabled })
    }

    signature = nextSignature
    return config
  }

  /** 用户说完一句话：给余波一次刺激，顺便满足一点连接需求。 */
  function noteUserTurn(turn = {}) {
    try {
      const config = sync()
      const emotion = typeof turn.emotion === 'string' ? turn.emotion : 'neutral'
      if (config.afterglow.enabled && afterglow !== null) {
        afterglow.impulse(IMPULSE_BY_EMOTION[emotion] ?? IMPULSE_BY_EMOTION.neutral)
      }
      if (config.needsEnabled && needs !== null) needs.satisfy('connection', 0.35)
    } catch (error) {
      log('情绪余波记录失败', error)
    }
  }

  /** 自己说完一句话：成就需求被满足一点。失败不影响已经发出去的回复。 */
  function noteAssistantReply() {
    try {
      const config = sync()
      if (config.needsEnabled && needs !== null) needs.satisfy('achievement', 0.25)
    } catch (error) {
      log('需求状态记录失败', error)
    }
  }

  /**
   * 决定这次用哪张表情。
   *
   * 返回 `{ tag, group, changed }`；只有 experiment 组会真的换，
   * control 只记录反事实计数，off 完全不动。
   */
  function decideExpression(emotion = 'neutral') {
    try {
      const config = sync()
      const base = typeof emotion === 'string' && emotion !== '' ? emotion : 'neutral'
      const residual =
        base === 'neutral' && config.afterglow.enabled && afterglow !== null
          ? emotionFromAfterglow(afterglow.snapshot())
          : base
      if (expression === null) return { tag: base, group: 'off', changed: false, emotion: base }

      const decision = expression.decide(residual)
      // off 与 control 都保持调用方原本要用的表情，只有 experiment 才真的换。
      const tag = decision.group === 'experiment' ? decision.tag : base
      return { ...decision, emotion: base, tag, changed: tag !== base }
    } catch (error) {
      log('表情选择失败', error)
      return { tag: 'neutral', group: 'off', changed: false, emotion: emotion }
    }
  }

  /** 此刻要不要因为「需要休息」而少说一句。关着时恒为 false。 */
  function shouldHoldBackOpening() {
    try {
      const config = sync()
      if (!config.needsEnabled || needs === null) return false
      const snapshot = needs.snapshot()
      // 阈值留高：只有确实很累时才压低主动开口，平时不改变原有节奏。
      return snapshot.dominant === 'rest' && snapshot.levels.rest >= 0.9
    } catch (error) {
      log('需求状态判断失败', error)
      return false
    }
  }

  /** 只读快照，给诊断面板与测试用。 */
  function snapshot() {
    try {
      const config = sync()
      return {
        afterglow: afterglow === null ? null : afterglow.snapshot(),
        expression: expression === null ? null : { group: expression.currentGroup, stats: expression.stats() },
        needs: needs === null ? null : needs.snapshot(),
        enabled: config
      }
    } catch (error) {
      log('情绪快照失败', error)
      return null
    }
  }

  return {
    noteUserTurn,
    noteAssistantReply,
    decideExpression,
    shouldHoldBackOpening,
    snapshot
  }
}
