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

import { EmotionAfterglow } from './emotion-afterglow.mjs'
import { ExpressionExperiment } from './emotion-expression.mjs'
import { NeedsState } from './emotion-needs.mjs'
import { EMOTION, TIME } from '../standard.mjs'

const EXPRESSION_GROUPS = new Set(['off', 'experiment', 'control'])
const DEFAULT_HALF_LIFE_MINUTES = EMOTION.afterglow.halfLifeMinutes
const MIN_HALF_LIFE_MINUTES = EMOTION.afterglow.minHalfLifeMinutes
const MAX_HALF_LIFE_MINUTES = EMOTION.afterglow.maxHalfLifeMinutes

/** 心情标签 → 一次刺激的目标值。只影响表现层，不写进任何提示词。 */
const IMPULSE_BY_EMOTION = EMOTION.impulse

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
  const band = EMOTION.afterglow

  if (Math.abs(valence) < band.neutralValence && arousal < band.neutralArousal) return 'neutral'
  if (valence >= band.positiveValence) return arousal >= band.excitedArousal ? 'excited' : 'happy'
  if (valence <= band.negativeValence) return arousal >= band.angryArousal ? 'angry' : 'sad'
  if (arousal >= band.surprisedArousal) return 'surprised'
  // 价不明显、但已经躁起来：先读作「不安」，再高才是「惊讶」。
  if (arousal >= band.restlessArousal) return 'restless'
  if (arousal <= band.tiredArousal) return 'tired'
  return 'neutral'
}

/** 旧配置可能把开关写成 1 / 'true' / 'on'，一律按布尔语义读。 */
function readBoolean(value, fallback = false) {
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  if (typeof value !== 'string') return fallback
  const text = value.trim().toLowerCase()
  if (text === 'true' || text === '1' || text === 'on' || text === 'yes') return true
  if (text === 'false' || text === '0' || text === 'off' || text === 'no') return false
  return fallback
}

/** 空串、空白、布尔值和非法数字都回退默认值；只有有效数字才夹取。 */
function readHalfLifeMinutes(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return DEFAULT_HALF_LIFE_MINUTES
  const text = typeof value === 'string' ? value.trim() : value
  if (text === '') return DEFAULT_HALF_LIFE_MINUTES
  const number = Number(text)
  if (!Number.isFinite(number)) return DEFAULT_HALF_LIFE_MINUTES
  return Math.min(MAX_HALF_LIFE_MINUTES, Math.max(MIN_HALF_LIFE_MINUTES, number))
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
      enabled: readBoolean(afterglow.enabled),
      halfLifeMinutes: readHalfLifeMinutes(afterglow.halfLifeMinutes)
    },
    expressionGroup: EXPRESSION_GROUPS.has(expression.group) ? expression.group : 'off',
    needsEnabled: readBoolean(needs.enabled)
  }
}

export function createEmotionRuntime(options = {}) {
  const { getSettings = () => ({}), now = Date.now, log = () => {} } = options

  let afterglow = null
  let expression = null
  let needs = null
  let signature = ''
  let activeHalfLifeMinutes = null
  /*
   * 新鲜感的短期记忆：归一化后的句子 + 时间。
   * 只留最近若干条，超过窗口的自动淘汰；不落盘，重启后从头算。
   */
  let recentInputs = []

  function normalizeInput(text) {
    return String(text ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '')
      .slice(0, EMOTION.needs.noveltyKeyLimit)
  }

  /** 这句话是不是最近两小时内没出现过的新输入。 */
  function isFreshInput(text, atNow) {
    const key = normalizeInput(text)
    if (key.length < EMOTION.needs.noveltyMinLength) return { fresh: false, key }
    const window = EMOTION.needs.noveltyWindowHours * TIME.HOUR
    recentInputs = recentInputs.filter((item) => atNow - item.at < window)
    return { fresh: !recentInputs.some((item) => item.key === key), key }
  }

  function rememberInput(key, atNow) {
    if (key === '') return
    recentInputs.push({ key, at: atNow })
    if (recentInputs.length > EMOTION.needs.noveltyHistoryLimit) {
      recentInputs = recentInputs.slice(-EMOTION.needs.noveltyHistoryLimit)
    }
  }

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
        halfLifeMs: config.afterglow.halfLifeMinutes * TIME.MINUTE
      })
    } else if (
      activeHalfLifeMinutes !== null &&
      activeHalfLifeMinutes !== config.afterglow.halfLifeMinutes
    ) {
      afterglow = new EmotionAfterglow({
        now,
        enabled: config.afterglow.enabled,
        halfLifeMs: config.afterglow.halfLifeMinutes * TIME.MINUTE
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

  /**
   * 用户说完一句话。
   *
   * 余波只在 afterglow.enabled 打开时记录；连接需求只在 needs.enabled 打开时
   * 满足。两者互不代偿，任意一边关着都不会影响另一边。
   */
  function noteUserTurn(turn = {}) {
    try {
      const config = sync()
      const emotion = typeof turn.emotion === 'string' ? turn.emotion : 'neutral'
      if (config.afterglow.enabled && afterglow !== null) {
        afterglow.impulse(IMPULSE_BY_EMOTION[emotion] ?? IMPULSE_BY_EMOTION.neutral)
      }
      if (config.needsEnabled && needs !== null) {
        /* 难过或生气时，一句回应带来的连接感更重；开心时反而轻一点。 */
        const factor = EMOTION.needSatisfyFactor[emotion] ?? EMOTION.needSatisfyFactor.default
        needs.satisfy('connection', EMOTION.needs.satisfy.connection * factor)

        /*
         * 新鲜感只在「够长 + 两小时内没说过」时满足。
         * 句子太短、复读同一句都不算探索；窗口过后再提，仍可重新算新鲜。
         */
        const atNow = now()
        const { fresh, key } = isFreshInput(turn.text, atNow)
        if (fresh) {
          needs.satisfy('novelty', EMOTION.needs.satisfy.novelty)
          rememberInput(key, atNow)
        }
      }
    } catch (error) {
      log('情绪余波记录失败', error)
    }
  }

  /** 自己说完一句话：成就需求被满足一点。失败不影响已经发出去的回复。 */
  function noteAssistantReply() {
    try {
      const config = sync()
      if (config.needsEnabled && needs !== null) needs.satisfy('achievement', EMOTION.needs.satisfy.achievement)
    } catch (error) {
      log('需求状态记录失败', error)
    }
  }

  /**
   * 真的休息过一段：休息需求被带走一点。
   * 醒着只会让 rest 上涨；只有睡觉 / 被唤醒时才该有人来扣这一笔。
   */
  function noteRest(amount = EMOTION.needs.satisfy.rest) {
    try {
      const config = sync()
      if (config.needsEnabled && needs !== null) needs.satisfy('rest', amount)
    } catch (error) {
      log('休息需求记录失败', error)
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

      // sync() 一定会建出实例；这里直接使用，不再保留一个不可达的 null 兜底。
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
      return snapshot.dominant === 'rest' && snapshot.levels.rest >= EMOTION.needs.holdBackRest
    } catch (error) {
      log('需求状态判断失败', error)
      return false
    }
  }

  /** 只读快照，给诊断面板与测试用；关闭的块明确返回 null。 */
  function snapshot() {
    try {
      const config = sync()
      return {
        afterglow:
          config.afterglow.enabled && afterglow !== null ? afterglow.snapshot() : null,
        expression:
          config.expressionGroup !== 'off' && expression !== null
            ? { group: expression.currentGroup, stats: expression.stats() }
            : null,
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
