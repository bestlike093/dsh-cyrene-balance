/**
 * 群聊接话的分寸。
 *
 * 前面几层已经解决了「叫她就回」「聊到她的事可以考虑」；
 * 但真正的群里，最容易露馅的不是说什么，而是**什么时候说**：
 *
 *   大家正聊得热闹，她插一句「我也觉得」——像在抢话
 *   刚说过一句，别人又发一条，她马上再接——像复读机
 *   几十人的大群，没人叫她还要接话——像刷屏机器人
 *   同一条消息平台重复推两次，她回两遍——最明显的破绽
 *
 * 这里只做这四种判断，全部在内存里，重启即清空。
 * 宁可少接一次，也不要在一个热闹的群里显得不像人。
 */

export const DEFAULT_GROUP_MANNERS = {
  /** 看多近的消息来判断「正在热聊」。 */
  hotWindowMs: 30_000,
  /** 这么近的窗口里有这么多条，才叫热闹。 */
  hotMessageCount: 6,
  /** 而且要来自这么多不同的人，才不是两个人对刷。 */
  hotSpeakerCount: 3,
  /** 她刚说完这么久之内，不接下一句。 */
  selfCooldownMs: 8_000,
  /** 大群门槛：到这个人数，没人叫就不主动接。 */
  largeGroupMembers: 30,
  /** 每条消息最多记这么久；只是用来去重。 */
  seenTtlMs: 10 * 60_000,
  /** 每个群最多留这么多条节奏记录。 */
  recentLimit: 40
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function createGroupManners(options = {}) {
  const limits = {
    hotWindowMs: asNumber(options.hotWindowMs, DEFAULT_GROUP_MANNERS.hotWindowMs),
    hotMessageCount: asNumber(options.hotMessageCount, DEFAULT_GROUP_MANNERS.hotMessageCount),
    hotSpeakerCount: asNumber(options.hotSpeakerCount, DEFAULT_GROUP_MANNERS.hotSpeakerCount),
    selfCooldownMs: asNumber(options.selfCooldownMs, DEFAULT_GROUP_MANNERS.selfCooldownMs),
    largeGroupMembers: asNumber(options.largeGroupMembers, DEFAULT_GROUP_MANNERS.largeGroupMembers),
    seenTtlMs: asNumber(options.seenTtlMs, DEFAULT_GROUP_MANNERS.seenTtlMs),
    recentLimit: asNumber(options.recentLimit, DEFAULT_GROUP_MANNERS.recentLimit)
  }
  const now = typeof options.now === 'function' ? options.now : Date.now
  /** scope -> { at, senderOpenId }[] */
  const recent = new Map()
  /** scope -> 她上一次在这个群说话的时间 */
  const spokenAt = new Map()
  /** scope -> Map<msgId, at> */
  const seen = new Map()

  function recentFor(scope, at) {
    const list = (recent.get(scope) ?? []).filter((item) => at - item.at <= limits.seenTtlMs)
    if (list.length > limits.recentLimit) list.splice(0, list.length - limits.recentLimit)
    recent.set(scope, list)
    return list
  }

  /**
   * 同一条消息是不是已经处理过。
   * 平台重推、网关重连都会造成同一条进两次，先问这里。
   */
  function duplicate(scope, msgId) {
    const key = cleanText(scope)
    const id = cleanText(msgId)
    if (key === '' || id === '') return false
    const at = now()
    const bucket = seen.get(key) ?? new Map()
    for (const [item, stamp] of bucket) {
      if (at - stamp > limits.seenTtlMs) bucket.delete(item)
    }
    seen.set(key, bucket)
    return bucket.has(id)
  }

  /** 记下群里这一条：节奏与去重都靠它。必须在判断之后调用。 */
  function observe(input = {}) {
    const scope = cleanText(input.scope)
    if (scope === '') return
    const at = asNumber(input.at, now())
    const list = recentFor(scope, at)
    list.push({ at, senderOpenId: cleanText(input.senderOpenId) })
    recent.set(scope, list)

    const id = cleanText(input.msgId)
    if (id !== '') {
      const bucket = seen.get(scope) ?? new Map()
      bucket.set(id, at)
      seen.set(scope, bucket)
    }
  }

  /** 她真的在这个群说出去了。发送成功后调用。 */
  function noteSpoken(scope, at) {
    const key = cleanText(scope)
    if (key === '') return
    spokenAt.set(key, asNumber(at, now()))
  }

  /**
   * 这一条现在适合接吗。
   *
   * 被点名直接放行：叫她就该应声，被热闹或大群挡掉才真的失礼。
   * memberCount 拿不到时不按大群处理——不猜。
   */
  function judge(input = {}) {
    const scope = cleanText(input.scope)
    if (scope === '') return { allow: true, reason: null }
    const at = asNumber(input.at, now())

    if (input.addressed === true) return { allow: true, reason: 'addressed' }

    const lastSpoken = spokenAt.get(scope) ?? 0
    if (lastSpoken > 0 && at - lastSpoken >= 0 && at - lastSpoken < limits.selfCooldownMs) {
      return { allow: false, reason: 'just-spoke' }
    }

    const list = recentFor(scope, at).filter((item) => at - item.at <= limits.hotWindowMs)
    const speakers = new Set(list.map((item) => item.senderOpenId).filter((item) => item !== ''))
    if (list.length >= limits.hotMessageCount && speakers.size >= limits.hotSpeakerCount) {
      return { allow: false, reason: 'busy-crowd' }
    }

    const members = Number(input.memberCount)
    if (Number.isFinite(members) && members >= limits.largeGroupMembers) {
      return { allow: false, reason: 'large-group-quiet' }
    }

    return { allow: true, reason: null }
  }

  /** 供诊断：某个群最近的热度与她上次开口的时间。 */
  function stats(scope) {
    const key = cleanText(scope)
    const at = now()
    const list = (recent.get(key) ?? []).filter((item) => at - item.at <= limits.hotWindowMs)
    return {
      recent: list.length,
      speakers: new Set(list.map((item) => item.senderOpenId).filter((item) => item !== '')).size,
      sinceLastSpoken: spokenAt.has(key) ? at - spokenAt.get(key) : null
    }
  }

  return { duplicate, observe, noteSpoken, judge, stats, limits }
}
