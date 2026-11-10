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
 * 负效价里用唤醒度区分愤怒与难过：高唤醒是生气，低唤醒才是委屈。
 */
export function emotionFromAfterglow(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return 'neutral'
  const valence = Number.isFinite(snapshot.valence) ? snapshot.valence : 0
  const arousal = Number.isFinite(snapshot.arousal) ? snapshot.arousal : 0

  if (Math.abs(valence) < 0.08 && arousal < 0.12) return 'neutral'
  if (valence >= 0.25) return arousal >= 0.65 ? 'excited' : 'happy'
  if (valence <= -0.25) return arousal >= 0.65 ? 'angry' : 'sad'
  if (arousal >= 0.7) return 'surprised'
  if (arousal <= 0.15) return 'tired'
  return 'neutral'
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 布尔开关：只认真值；'true'、1、'1' 等旧配置形态按开启，其余一律关闭。 */
function asBool(value) {
  return value === true || value === 1 || value === '1' || value === 'true'
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

  // 半衰期只有真数字才参与夹取；null / '' / 缺失一律回默认 30 分钟，
  // 绝不把「没填」读成 1 分钟的最快回落。
  const halfLifeRaw = Number(afterglow.halfLifeMinutes)
  const halfLifeMinutes = Number.isFinite(halfLifeRaw) && String(afterglow.halfLifeMinutes ?? '').trim() !== ''
    ? clampNumber(halfLifeRaw, MIN_HALF_LIFE_MINUTES, MAX_HALF_LIFE_MINUTES, DEFAULT_HALF_LIFE_MINUTES)
    : DEFAULT_HALF_LIFE_MINUTES

  return {
    afterglow: {
      enabled: asBool(afterglow.enabled),
      halfLifeMinutes
    },
    expressionGroup: EXPRESSION_GROUPS.has(expression.group) ? expression.group : 'off',
    needsEnabled: asBool(needs.enabled)
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
      // 余波与需求是两把独立开关：余波开着、需求关着，只做刺激不满足需求。
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
   * 她真的在休息（睡着了 / 深夜安静时段）：休息需求被满足一点。
   *
   * 没有这个出口，rest 只会自然回升、永远等不到满足，约 6 小时后
   * shouldHoldBackOpening 恒真，主动开口永久停摆。主进程在睡眠窗口内按拍调用。
   */
  function noteRest(amount = 0.06) {
    try {
      const config = sync()
      if (config.needsEnabled && needs !== null) needs.satisfy('rest', amount)
    } catch (error) {
      log('需求状态记录休息失败', error)
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
      // 余波只在「这一轮没有明确情绪」时兜底，但不该被表情实验的分组门控。
      // 实验决定的是「要不要按情绪换脸」，余波决定的是「换完怎么退烧」，
      // 两件事分开之后，实验关着也不会让余波失效。
      const afterglowTag =
        base === 'neutral' && config.afterglow.enabled && afterglow !== null
          ? emotionFromAfterglow(afterglow.snapshot())
          : 'neutral'
      const residual = afterglowTag !== 'neutral' ? afterglowTag : base
      // sync() 保证 expression 一定已初始化，这里直接使用。

      const decision = expression.decide(residual)
      // experiment 组按情绪换脸；off / control 保持调用方原本要用的表情。
      // 余波不属于实验变量：实验关着时它照样生效。
      const tag =
        decision.group === 'experiment'
          ? decision.tag
          : afterglowTag !== 'neutral'
            ? afterglowTag
            : base
      return { ...decision, emotion: base, tag, changed: tag !== base }
    } catch (error) {
      log('表情选择失败', error)
      // 出错时守住调用方原本的情绪，别把人家的脸压成 neutral。
      const fallback = typeof emotion === 'string' && emotion !== '' ? emotion : 'neutral'
      return { tag: fallback, group: 'off', changed: false, emotion: fallback }
    }
  }

  /** 「需要休息」压住主动开口的最长连续时长；过了就自动缓过来，不永久停摆。 */
  const REST_HOLD_MAX_MS = 2 * 60 * 60 * 1000
  let restHoldStartedAt = null

  /** 此刻要不要因为「需要休息」而少说一句。关着时恒为 false。 */
  function shouldHoldBackOpening() {
    try {
      const config = sync()
      if (!config.needsEnabled || needs === null) return false
      const snapshot = needs.snapshot()
      // 阈值留高：只有确实很累时才压低主动开口，平时不改变原有节奏。
      const holding = snapshot.dominant === 'rest' && snapshot.levels.rest >= 0.9
      if (!holding) {
        restHoldStartedAt = null
        return false
      }
      const at = now()
      if (restHoldStartedAt === null) {
        restHoldStartedAt = at
        return true
      }
      if (at - restHoldStartedAt <= REST_HOLD_MAX_MS) return true
      // 压得太久＝「休息」这个状态本身卡住了（没有满足出口的旧数据）：
      // 自动缓过来一半，把开口还给时间表，不再永远闭嘴。
      restHoldStartedAt = null
      needs.satisfy('rest', 0.5)
      log('休息需求连续压制开口超过两小时，自动缓解一半')
      return false
    } catch (error) {
      log('需求状态判断失败', error)
      return false
    }
  }

  /** 只读快照，给诊断面板与测试用。关着的块给 null，不让诊断误判成开启。 */
  function snapshot() {
    try {
      const config = sync()
      return {
        afterglow: config.afterglow.enabled && afterglow !== null ? afterglow.snapshot() : null,
        expression: expression === null ? null : { group: expression.currentGroup, stats: expression.stats() },
        needs: config.needsEnabled && needs !== null ? needs.snapshot() : null,
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
    noteRest,
    decideExpression,
    shouldHoldBackOpening,
    snapshot
  }
}
