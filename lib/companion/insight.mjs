/**
 * 观察台的只读快照。
 *
 * 这里只读，不改任何状态；唯一的内存写入是「这次运行里被叫到几次」的计数。
 * 所有数据源都通过参数注入：某个源没准备好、抛错、或文件还没生成，
 * 对应那一段返回 null 并记一条 errors，其它段照常给，界面据此显示空态。
 *
 * 500ms 内的重复请求共用同一份快照，避免轮询时反复扫内存。
 */
import { humanTime } from './human-time.mjs'

const DEFAULT_CACHE_TTL_MS = 500
const MAX_MEMORY_PAGE = 20
const SESSION_SCAN_COUNT = 200

function asNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function timeOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function pageNumber(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.floor(n), min), max)
}

/** 给条目补一句人话时间；没时间的原样返回。 */
function withHumanTime(item) {
  if (item === null || typeof item !== 'object') return item
  const atText = humanTime(item.at ?? item.createdAt)
  return atText === '' ? item : { ...item, atText }
}

export function createInsightService(options = {}) {
  const {
    chatHistoryStore = null,
    memoryStore = null,
    socialProfileStore = null,
    thoughtPool = null,
    agendaRuntime = null,
    bodyService = null,
    presenceService = null,
    affinity = null,
    proactiveGate = null,
    handoffStore = null,
    now = Date.now,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    log = () => {}
  } = options

  let cached = null
  let pending = null
  /** 被叫到名字的次数：本次运行内累计，重启归零。 */
  const wake = { total: 0, lastAt: 0, byScope: Object.create(null) }

  function attempt(label, fn, fallback = null) {
    try {
      return fn()
    } catch (error) {
      log(`insight: ${label} 读取失败`, error)
      return fallback
    }
  }

  async function attemptAsync(label, fn, fallback = null) {
    try {
      return await fn()
    } catch (error) {
      log(`insight: ${label} 读取失败`, error)
      return fallback
    }
  }

  function noteWake(scope = 'desktop') {
    const key = typeof scope === 'string' && scope.trim() !== '' ? scope.trim() : 'desktop'
    const at = now()
    wake.total += 1
    wake.lastAt = at
    wake.byScope[key] = asNumber(wake.byScope[key]) + 1
    cached = null
    return { total: wake.total, scope: key, at }
  }

  /**
   * 会话列表：计数来自历史统计，最近说话时间只从最近 200 条里推。
   * 不把任何原文带出这个函数。
   */
  function buildSessions() {
    const historyStats = attempt('chat history stats', () => chatHistoryStore?.stats?.())
    const counts = historyStats?.scopes ?? {}

    const lastAt = new Map()
    const recent = attempt('chat history recent', () => chatHistoryStore?.recent?.(SESSION_SCAN_COUNT)) ?? []
    for (const item of Array.isArray(recent) ? recent : []) {
      const scope = typeof item?.scope === 'string' && item.scope !== '' ? item.scope : 'desktop'
      const at = timeOf(item?.at)
      if (at > (lastAt.get(scope) ?? 0)) lastAt.set(scope, at)
    }

    const profileSnapshot = attempt('social profile snapshot', () => socialProfileStore?.snapshot?.())
    const profiles = Array.isArray(profileSnapshot?.profiles) ? profileSnapshot.profiles : []
    const profileMap = new Map(profiles.map((item) => [item.scope, item]))

    const scopes = new Set([...Object.keys(counts), ...lastAt.keys(), ...profileMap.keys()])
    return [...scopes]
      .map((scope) => {
        const profile = profileMap.get(scope) ?? null
        const bond = attempt('affinity snapshot', () => affinity?.snapshot?.(scope))
        const manualLog = Array.isArray(bond?.manualLog) ? bond.manualLog : []
        return {
          scope,
          messages: asNumber(counts[scope]),
          lastAt: lastAt.get(scope) ?? 0,
          // 好感、锁定与档位展示只给数值和描述，不带她写下的印象、关系原文。
          favor: bond === null || bond === undefined ? null : asNumber(bond.favor),
          locked: bond?.locked === true,
          level: typeof bond?.level === 'string' ? bond.level : null,
          levelId: typeof bond?.levelId === 'string' ? bond.levelId : null,
          address: typeof bond?.address === 'string' ? bond.address : '',
          initiative: typeof bond?.initiative === 'string' ? bond.initiative : '',
          boundary: typeof bond?.boundary === 'string' ? bond.boundary : '',
          pace: typeof bond?.pace === 'string' ? bond.pace : '',
          // 最近 5 条手动改动；只带数字与说明，不带聊天内容。
          manualLog: manualLog.slice(0, 5).map((item) => ({
            at: asNumber(item?.at),
            before: asNumber(item?.before),
            after: asNumber(item?.after),
            delta: asNumber(item?.delta),
            note: typeof item?.note === 'string' ? item.note : ''
          })),
          profile:
            profile === null
              ? null
              : {
                  samples: asNumber(profile.samples),
                  updatedAt: asNumber(profile.updatedAt),
                  stats: profile.stats ?? null
                }
        }
      })
      .sort((a, b) => {
        if (b.lastAt !== a.lastAt) return b.lastAt - a.lastAt
        return b.messages - a.messages
      })
  }

  function buildMemory() {
    const stats = attempt('memory stats', () => memoryStore?.stats?.())
    if (stats === null || stats === undefined) return null
    return {
      available: stats.available !== false,
      count: asNumber(stats.count),
      limit: asNumber(stats.limit),
      layers: {
        raw: asNumber(stats.layers?.raw),
        episode: asNumber(stats.layers?.episode),
        fact: asNumber(stats.layers?.fact),
        lesson: asNumber(stats.layers?.lesson)
      },
      scopes: stats.scopes ?? {},
      cold: asNumber(stats.cold),
      updatedAt: asNumber(stats.updatedAt)
    }
  }

  function buildThoughts() {
    const snapshot = attempt('thought pool snapshot', () => thoughtPool?.snapshot?.())
    if (snapshot === null || snapshot === undefined) return null
    return {
      total: asNumber(snapshot.total),
      counts: snapshot.counts ?? { open: 0, used: 0, expired: 0, dropped: 0 },
      open: Array.isArray(snapshot.open) ? snapshot.open.map(withHumanTime) : [],
      decisions: Array.isArray(snapshot.decisions) ? snapshot.decisions.map(withHumanTime) : []
    }
  }

  function buildAgenda() {
    const snapshot = attempt('agenda snapshot', () => agendaRuntime?.snapshot?.())
    return snapshot === null || snapshot === undefined ? null : snapshot
  }

  function buildBody() {
    const snapshot = attempt('body snapshot', () => bodyService?.snapshot?.())
    if (snapshot === null || snapshot === undefined) return null
    return {
      ...snapshot,
      text: attempt('body describe', () => bodyService?.describe?.()) ?? ''
    }
  }

  async function buildPresence() {
    const ctx = await attemptAsync('presence context', () => presenceService?.peekContext?.())
    if (ctx === null || ctx === undefined) return null
    return {
      mood: ctx.mood ?? null,
      sessionMinutes: asNumber(ctx.sessionMinutes),
      recentLines: Array.isArray(ctx.recentLines) ? ctx.recentLines : [],
      weather: ctx.weather ?? null,
      // 节日与穿搭已经由情境层算好；这里只透传，界面才能看见「今天该穿什么」。
      lifestyle: ctx.lifestyle ?? null,
      time: ctx.time ?? null
    }
  }

  /**
   * 主动开口这一本账：今天说了几次、额度多少、下一次最早什么时候。
   * decisions 已经在念头池里，这里只补闸门自己的读数。
   */
  function buildProactive(decisions = []) {
    const snapshot = attempt('proactive snapshot', () => proactiveGate?.snapshot?.('desktop'))
    if (snapshot === null || snapshot === undefined) return null
    const list = Array.isArray(decisions) ? decisions : []
    // 忍住的理由按出现次数排：只留前五条，够看出最近卡在哪。
    const reasonCounts = []
    const seen = new Map()
    for (const item of list) {
      if (item?.speak === true) continue
      const reason = typeof item?.reason === 'string' ? item.reason.trim() : ''
      if (reason === '') continue
      seen.set(reason, (seen.get(reason) ?? 0) + 1)
    }
    for (const [reason, count] of [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      reasonCounts.push({ reason, count })
    }
    return {
      count: asNumber(snapshot.count),
      dailyLimit: asNumber(snapshot.dailyLimit),
      minGapMs: asNumber(snapshot.minGapMs),
      nextAllowedAt: asNumber(snapshot.nextAllowedAt),
      lastSpokeAt: asNumber(snapshot.lastSpokeAt),
      silenced: snapshot.silenced === true,
      silenceReason: typeof snapshot.silenceReason === 'string' ? snapshot.silenceReason : '',
      openLoopCount: asNumber(snapshot.openLoopCount),
      spoken: list.filter((item) => item?.speak === true).length,
      held: list.filter((item) => item?.speak !== true).length,
      reasonCounts
    }
  }

  /**
   * 跨窗口还没接上的那句话。
   *
   * 只给「从哪来、到哪去、一句摘要、什么时候过期」，原文本来就不在承接记录里。
   * 没接这个数据源时给空列表，不算错误；接了却读不出来才算。
   */
  function buildHandoffs() {
    if (handoffStore === null) return []
    const items = attempt('handoff list', () => handoffStore?.list?.())
    if (!Array.isArray(items)) return null
    const at = now()
    return items
      .map((item) => {
        const createdAt = asNumber(item?.createdAt)
        return {
          fromScope: typeof item?.fromScope === 'string' ? item.fromScope : '',
          toScope: typeof item?.toScope === 'string' ? item.toScope : '',
          topic: typeof item?.topic === 'string' ? item.topic : '',
          createdAt,
          expiresAt: createdAt + asNumber(item?.ttlMs)
        }
      })
      .filter(
        (item) =>
          item.fromScope !== '' && item.toScope !== '' && item.topic !== '' && item.expiresAt > at
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  function buildWake() {
    return {
      total: wake.total,
      lastAt: wake.lastAt,
      byScope: { ...wake.byScope }
    }
  }

  async function build() {
    const sessions = attempt('sessions', buildSessions, [])
    const memory = buildMemory()
    const thoughts = buildThoughts()
    const proactive = buildProactive(thoughts?.decisions ?? [])
    const agenda = buildAgenda()
    const body = buildBody()
    const handoffs = buildHandoffs()
    const presence = await buildPresence()

    const errors = []
    if (sessions.length === 0) errors.push('sessions-empty')
    if (memory === null) errors.push('memory-unavailable')
    if (thoughts === null) errors.push('thoughts-unavailable')
    if (agenda === null) errors.push('agenda-unavailable')
    if (body === null) errors.push('body-unavailable')
    if (handoffs === null) errors.push('handoffs-unavailable')
    if (presence === null) errors.push('presence-unavailable')

    return {
      generatedAt: now(),
      sessions,
      memory,
      thoughts,
      proactive,
      agenda,
      body,
      handoffs: handoffs === null ? [] : handoffs,
      presence,
      wake: buildWake(),
      errors
    }
  }

  /** 观察台一次要的整份快照。500ms 内复用；并发请求也只构建一次。 */
  async function snapshot({ force = false } = {}) {
    const at = now()
    if (force !== true && cached !== null && at - cached.at < cacheTtlMs) return cached.value
    if (pending !== null) return pending
    pending = build()
      .then((value) => {
        cached = { at: now(), value }
        return value
      })
      .finally(() => {
        pending = null
      })
    return pending
  }

  /**
   * 记忆分页：一页最多 20 条，只把当前页的记录交给界面。
   * 总数与层分布走 stats，不靠翻页累加。
   */
  function memoryPage(pageOptions = {}) {
    const offset = pageNumber(pageOptions.offset, 0, 0, Number.MAX_SAFE_INTEGER)
    const limit = pageNumber(pageOptions.limit, MAX_MEMORY_PAGE, 1, MAX_MEMORY_PAGE)
    const query = { offset, limit }
    if (typeof pageOptions.scope === 'string' && pageOptions.scope !== '') query.scope = pageOptions.scope
    if (typeof pageOptions.layer === 'string' && pageOptions.layer !== '') query.layer = pageOptions.layer
    if (pageOptions.includeCold === false) query.includeCold = false

    const result = attempt('memory page', () => memoryStore?.list?.(query))
    if (result === null || result === undefined) {
      return { total: 0, offset, limit, items: [], unavailable: true }
    }
    const items = Array.isArray(result.items) ? result.items : []
    return {
      total: asNumber(result.total),
      offset: asNumber(result.offset, offset),
      limit: asNumber(result.limit, limit),
      items: items.map((item) => ({
        id: item.id,
        role: item.role,
        text: item.text,
        at: item.at,
        atText: humanTime(item.at),
        source: item.source ?? null,
        scope: item.scope,
        layer: item.layer,
        cold: item.cold === true,
        supersedes: item.supersedes ?? null
      }))
    }
  }

  function invalidate() {
    cached = null
  }

  return { snapshot, memoryPage, noteWake, invalidate }
}
