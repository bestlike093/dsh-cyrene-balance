/**
 * 请求守门与离线兜底：把 core 的 TokenBucket / FallbackChain 接到真实聊天上。
 *
 * 两件事分开：
 * - 守门：短时间内太多请求时不再发出去，避免 429 和重复花钱。
 * - 兜底：模型请求失败时用本地规则回一句，不至于让对面等到一片空白。
 *
 * 兜底不写聊天历史、不进记忆：它只是一句临时的应答，
 * 不该变成下一轮提示词里「她真的说过」的内容。
 */

import { FallbackChain, LocalEmotionEngine, TokenBucket } from '@pet/core/browser'

const DEFAULT_PER_MINUTE = 20
const MIN_PER_MINUTE = 1
const MAX_PER_MINUTE = 120

/** 兜底句按情绪分组，轮转取用，避免连续两次说同一句。 */
const OFFLINE_LINES = {
  happy: ['看你开心，我也跟着高兴起来啦♪', '嗯，我在听呢♪', '这样很好呀，再多说一点？'],
  shy: ['诶嘿，被夸了呢♪', '别这样看着人家啦……不过，谢谢你♪'],
  sad: ['难过的时候，人家陪你待一会儿。', '不用急着说清楚，我在这儿呢。'],
  tired: ['累了就歇一歇吧，我在这儿。', '先喘口气，不急着回我♪'],
  angry: ['先别生气嘛，慢慢说给我听。', '嗯，我在听，你继续说。'],
  surprised: ['真的吗？快说给我听♪', '诶，居然是这样呀。'],
  thinking: ['让我想想……你更在意哪一部分？', '这个问题值得慢慢聊呢。'],
  excited: ['看你这么有精神，真好呀♪', '好耶，我就喜欢听你说这些♪'],
  neutral: ['嗯，我在听呢♪', '我在这儿，你慢慢说。', '嗯嗯，然后呢？']
}

function readCareSettings(getSettings) {
  let settings
  try {
    settings = getSettings()
  } catch {
    settings = null
  }
  const care = settings?.companion?.care
  return care !== null && typeof care === 'object' ? care : {}
}

function readGuardConfig(getSettings) {
  const raw = readCareSettings(getSettings).requestGuard
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  const perMinute = Number.isFinite(Number(value.perMinute))
    ? Math.min(MAX_PER_MINUTE, Math.max(MIN_PER_MINUTE, Math.floor(Number(value.perMinute))))
    : DEFAULT_PER_MINUTE
  return {
    enabled: value.enabled !== false,
    perMinute
  }
}

function readOfflineConfig(getSettings) {
  const raw = readCareSettings(getSettings).offlineReply
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  return { enabled: value.enabled !== false }
}

/** 按情绪取兜底句；没有对应分组时落回 neutral。 */
class EmotionPresetPool {
  constructor() {
    this.cursors = new Map()
    this.poolId = 'offline'
  }

  pick(emotion) {
    const lines = OFFLINE_LINES[emotion] ?? OFFLINE_LINES.neutral
    const cursor = this.cursors.get(emotion) ?? 0
    this.cursors.set(emotion, cursor + 1)

    const index = cursor % lines.length
    return { text: lines[index], poolId: this.poolId, index }
  }
}

/**
 * 请求守门：每 provider 一个桶，默认每分钟 20 次。
 *
 * 配置里改上限时重建桶：容量变了还沿用旧桶，会让新上限迟迟不生效。
 */
export function createRequestGate(options = {}) {
  const { getSettings = () => ({}), now = null, log = () => {} } = options

  let bucket = null
  let signature = ''

  function currentBucket(config) {
    const nextSignature = String(config.perMinute)
    if (bucket === null || nextSignature !== signature) {
      const bucketOptions = {
        capacity: config.perMinute,
        refillPerMs: config.perMinute / 60_000
      }
      if (typeof now === 'function') bucketOptions.now = now
      bucket = new TokenBucket('chat', bucketOptions)
      signature = nextSignature
    }
    return bucket
  }

  /** 发请求前问一句。返回 waitMs 让调用方知道大概要等多久。 */
  function allow() {
    try {
      const config = readGuardConfig(getSettings)
      if (!config.enabled) return { allowed: true, waitMs: 0, remaining: null }

      const instance = currentBucket(config)
      const result = instance.tryConsume(1)
      if (result.ok) {
        return { allowed: true, waitMs: 0, remaining: result.tokens }
      }

      const waitMs =
        result.reason === 'exceeds-capacity' || config.perMinute <= 0
          ? 0
          : Math.ceil((1 - result.tokens) / (config.perMinute / 60_000))

      return { allowed: false, waitMs, remaining: result.tokens, reason: result.reason }
    } catch (error) {
      log('请求守门失败，按放行处理', error)
      return { allowed: true, waitMs: 0, remaining: null }
    }
  }

  function status() {
    try {
      const config = readGuardConfig(getSettings)
      const snapshot = bucket === null ? null : bucket.snapshot()
      return {
        enabled: config.enabled,
        perMinute: config.perMinute,
        tokens: snapshot === null ? config.perMinute : snapshot.tokens
      }
    } catch (error) {
      log('请求守门状态读取失败', error)
      return null
    }
  }

  return { allow, status }
}

/**
 * 离线兜底：LLM 不可用时，用本地情绪规则挑一句。
 *
 * 这条路径同步完成，不引入新的 await 点；失败就返回 null，让调用方保留原来的错误码。
 */
export function createOfflineReply(options = {}) {
  const { getSettings = () => ({}), log = () => {} } = options

  const chain = new FallbackChain({
    localRules: new LocalEmotionEngine(),
    presetPool: new EmotionPresetPool()
  })

  async function replyTo(text) {
    try {
      const config = readOfflineConfig(getSettings)
      if (!config.enabled) return null
      if (typeof text !== 'string' || text.trim() === '') return null

      const report = await chain.generate({ text })
      const line = report?.output?.text
      if (typeof line !== 'string' || line.trim() === '') return null

      return { text: line.trim(), source: report.output.source }
    } catch (error) {
      log('离线兜底失败', error)
      return null
    }
  }

  function enabled() {
    return readOfflineConfig(getSettings).enabled
  }

  return { replyTo, enabled }
}
