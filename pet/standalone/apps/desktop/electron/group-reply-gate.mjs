/**
 * 群 @ 回复闸门。
 *
 * 群里被 @ 是明确在叫她，任何人都不该被主人名单挡掉；
 * 但陌生人可以连着 @，所以进入模型之前要单独限流。
 *
 * 这一层只做判断与记账，不发消息、不落盘。计数在内存里，重启即清空。
 */

/** 默认分寸：一个群一分钟三条，同一个人二十秒内不重复回。 */
export const DEFAULT_GROUP_REPLY_LIMITS = {
  windowMs: 60_000,
  groupLimit: 3,
  senderCooldownMs: 20_000,
  /** 同一个群每天最多回复几条，兜住整天刷屏。 */
  dailyLimit: 40
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function dayKey(now) {
  const date = new Date(now)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function createGroupReplyGate(options = {}) {
  const limits = {
    windowMs: asNumber(options.windowMs, DEFAULT_GROUP_REPLY_LIMITS.windowMs),
    groupLimit: asNumber(options.groupLimit, DEFAULT_GROUP_REPLY_LIMITS.groupLimit),
    senderCooldownMs: asNumber(
      options.senderCooldownMs,
      DEFAULT_GROUP_REPLY_LIMITS.senderCooldownMs
    ),
    dailyLimit: asNumber(options.dailyLimit, DEFAULT_GROUP_REPLY_LIMITS.dailyLimit)
  }
  const now = typeof options.now === 'function' ? options.now : Date.now
  /** scope -> { day, hits, dailyCount, senders } */
  const groups = new Map()

  function bucketFor(scope, today) {
    const existing = groups.get(scope)
    if (existing !== undefined && existing.day === today) return existing
    const next = { day: today, hits: [], dailyCount: 0, senders: new Map() }
    groups.set(scope, next)
    return next
  }

  /**
   * 判断这次 @ 能不能回复。
   * 通过时会立刻占一个名额，避免并发消息一起穿过闸门。
   */
  function allow(input = {}) {
    const scope = typeof input.scope === 'string' ? input.scope.trim() : ''
    const sender = typeof input.senderOpenId === 'string' ? input.senderOpenId.trim() : ''
    if (scope === '') return { ok: true }

    const at = now()
    const bucket = bucketFor(scope, dayKey(at))

    const lastFromSender = bucket.senders.get(sender) ?? 0
    if (
      sender !== '' &&
      lastFromSender > 0 &&
      at - lastFromSender < limits.senderCooldownMs
    ) {
      return { ok: false, reason: 'sender-cooldown' }
    }

    bucket.hits = bucket.hits.filter((hit) => at - hit < limits.windowMs)
    if (bucket.hits.length >= limits.groupLimit) {
      return { ok: false, reason: 'group-window' }
    }
    if (bucket.dailyCount >= limits.dailyLimit) {
      return { ok: false, reason: 'group-daily' }
    }

    bucket.hits.push(at)
    bucket.dailyCount += 1
    if (sender !== '') bucket.senders.set(sender, at)
    return { ok: true }
  }

  /** 供诊断：某个群当前的窗口与当日计数；没有记录时返回零值。 */
  function stats(scope) {
    const bucket = groups.get(scope)
    if (bucket === undefined) return { window: 0, daily: 0 }
    const at = now()
    const window = bucket.hits.filter((hit) => at - hit < limits.windowMs).length
    return { window, daily: bucket.dailyCount }
  }

  return { allow, stats, limits }
}
