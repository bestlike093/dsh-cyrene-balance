/**
 * 群 @ 回复闸门。
 *
 * 群里被 @ 是明确在叫她，任何人都不该被主人名单挡掉；
 * 但陌生人可以连着 @，所以进入模型之前要单独限流。
 *
 * 这一层只做判断与记账，不发消息、不落盘。计数在内存里，重启即清空。
 */
import { TIME } from '../standard.mjs'

/** 默认分寸：一个群一分钟三条，同一个人二十秒内不重复回。 */
export const DEFAULT_GROUP_REPLY_LIMITS = {
  windowMs: TIME.MINUTE,
  groupLimit: 3,
  senderCooldownMs: 20 * TIME.SECOND,
  /** 同一个群每天最多回复几条，兜住整天刷屏。 */
  dailyLimit: 40
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

/** 负数或 0 的限流参数没有意义（0 窗口会永远拒绝、0 上限等于没上限），按默认值处理。 */
function asPositive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function dayKey(now) {
  const date = new Date(now)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function createGroupReplyGate(options = {}) {
  const limits = {
    windowMs: asPositive(options.windowMs, DEFAULT_GROUP_REPLY_LIMITS.windowMs),
    groupLimit: asPositive(options.groupLimit, DEFAULT_GROUP_REPLY_LIMITS.groupLimit),
    senderCooldownMs: asNumber(
      options.senderCooldownMs,
      DEFAULT_GROUP_REPLY_LIMITS.senderCooldownMs
    ),
    dailyLimit: asPositive(options.dailyLimit, DEFAULT_GROUP_REPLY_LIMITS.dailyLimit)
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
   *
   * 每次返回都带 quota：charged 表示这次有没有真的占掉名额，
   * before / after 是窗口内的前后值，used 是这一次用掉几个。
   * 复核值在场景结束的这一刻当场取，不回头再读 stats()——
   * 中间可能有别的消息插进来，事后回读已经不是这次判断的现场了。
   */
  function allow(input = {}) {
    const scope = typeof input.scope === 'string' ? input.scope.trim() : ''
    const sender = typeof input.senderOpenId === 'string' ? input.senderOpenId.trim() : ''
    /* MEM-283：没有 scope 就不知道往哪个群记账，直接拒绝，不能放行。
       拒绝等于没放行、也没占名额：ok=false 说前者，charged=false 说后者。 */
    if (scope === '') {
      return {
        ok: false,
        reason: 'bad-scope',
        quota: { charged: false, before: 0, after: 0, used: 0, dailyUsed: 0 }
      }
    }

    const at = now()
    const bucket = bucketFor(scope, dayKey(at))

    /* 先清掉过期命中，再记本场景开始时的基数。
       未来时间戳（时钟回拨前的记录）不算窗口内，否则会一直占着名额——
       这一条并进同一次过滤，保证 before / after / stats 三者口径一致。 */
    bucket.hits = bucket.hits.filter((hit) => hit <= at && at - hit < limits.windowMs)
    const before = bucket.hits.length
    const dailyBefore = bucket.dailyCount
    const receipt = (charged) => ({
      charged,
      before,
      after: bucket.hits.length,
      used: bucket.hits.length - before,
      dailyUsed: bucket.dailyCount - dailyBefore
    })

    const lastFromSender = bucket.senders.get(sender) ?? 0
    if (
      sender !== '' &&
      lastFromSender > 0 &&
      at - lastFromSender < limits.senderCooldownMs
    ) {
      return { ok: false, reason: 'sender-cooldown', quota: receipt(false) }
    }

    if (bucket.hits.length >= limits.groupLimit) {
      return { ok: false, reason: 'group-window', quota: receipt(false) }
    }
    if (bucket.dailyCount >= limits.dailyLimit) {
      return { ok: false, reason: 'group-daily', quota: receipt(false) }
    }

    bucket.hits.push(at)
    bucket.dailyCount += 1
    if (sender !== '') bucket.senders.set(sender, at)
    return { ok: true, quota: receipt(true) }
  }

  /**
   * 退还名额：模型调用失败、发送失败时调用，把刚才占下的窗口名额和当日额度还回去。
   * 失败的那次不该占着名额，否则几次失败就能把一个群噎住一整天。
   *
   * @param {string} scope
   * @param {object} [options]
   * @param {number} [options.hits]          退还几条（取整且至少 1）
   * @param {string} [options.senderOpenId]  同时清掉该发送者的冷却，允许立刻重试
   * @returns {number} 实际退还的条数
   */
  function release(scope, options = {}) {
    const key = typeof scope === 'string' ? scope.trim() : ''
    if (key === '') return 0
    const bucket = groups.get(key)
    if (bucket === undefined) return 0
    const at = now()
    // 桶已经跨天换代时没有可退的记录，直接返回。
    if (bucket.day !== dayKey(at)) return 0
    bucket.hits = bucket.hits.filter((hit) => hit <= at && at - hit < limits.windowMs)
    const amount = Math.max(1, Math.floor(asNumber(options.hits, 1)))
    let refunded = 0
    while (refunded < amount && bucket.hits.length > 0) {
      bucket.hits.pop()
      refunded += 1
    }
    bucket.dailyCount = Math.max(0, bucket.dailyCount - refunded)
    const sender = typeof options.senderOpenId === 'string' ? options.senderOpenId.trim() : ''
    if (sender !== '') bucket.senders.delete(sender)
    return refunded
  }

  /** 供诊断：某个群当前的窗口与当日计数；没有记录时返回零值。 */
  function stats(scope) {
    const bucket = groups.get(scope)
    if (bucket === undefined) return { window: 0, daily: 0 }
    const at = now()
    // MEM-285：加 hit <= at 下界，未来时间戳不算窗口内。
    const window = bucket.hits.filter((hit) => hit <= at && at - hit < limits.windowMs).length
    return { window, daily: bucket.dailyCount }
  }

  return { allow, release, stats, limits }
}
