/**
 * 主动开口：先找理由，再过门控，最后才说话。
 *
 * 借鉴 AstrBot 陪伴插件的「主动候选生命周期」：
 * 不是定时问候，而是从「被叫到」「话题和我有关」这类真实线索里形成候选，
 * 再经过时间、冷却、额度、免打扰的筛选，才有资格开口。
 *
 * 这一层只做判断，不发消息、不读写盘。
 * 没有理由就返回 speak:false —— 随机问候比沉默更像打扰。
 */

import { matchWake } from './social.mjs'

/** 默认分寸：宁可少说，也不要让人觉得被盯着。 */
export const DEFAULT_PROACTIVE_LIMITS = {
  /** 同一个会话两次主动至少隔 30 分钟。 */
  minGapMs: 30 * 60 * 1000,
  /** 每天最多主动 3 次。 */
  dailyLimit: 3,
  /** 23 点到次日 8 点不主动开口。 */
  quietStartHour: 23,
  quietEndHour: 8,
  /** 一句话里最多接一个话题，避免一口气抛三个问题。 */
  maxHits: 1
}

/**
 * 关系越近，主动越可以密一点；但陌生人的一次也不能被关系分抬高。
 *
 * 这里给的是闸门的下限与每日额度。桌面还有「多久说一次」的设置，
 * 最终节奏仍由 presence 的间隔把关；这一层只负责「至少等多久」。
 */
export const PROACTIVE_LIMITS_BY_LEVEL = {
  distant: { minGapMs: 180 * 60_000, dailyLimit: 1 },
  guarded: { minGapMs: 120 * 60_000, dailyLimit: 2 },
  familiar: { minGapMs: 60 * 60_000, dailyLimit: 2 },
  close: { minGapMs: 30 * 60_000, dailyLimit: 3 },
  attached: { minGapMs: 20 * 60_000, dailyLimit: 4 },
  cherished: { minGapMs: 15 * 60_000, dailyLimit: 5 }
}

/** 只取好感档对应的那两项；未知档位不覆盖设置。 */
export function proactiveLimitsForLevel(levelId) {
  const key = asText(levelId)
  const preset = PROACTIVE_LIMITS_BY_LEVEL[key]
  return preset === undefined ? {} : { ...preset }
}

/**
 * 「没人接」的分寸。
 *
 * 开口额度只解决「今天说太多」，解决不了「说了好几天没人应」。
 * 一个人在群里连着几天不回应，继续按额度礼貌地发，才是真的打扰。
 * 这三条是兜底：止损、收场、话头复核。
 */
export const DEFAULT_SILENCE_LIMITS = {
  /** 主动说过话、对方连续这么多天没开口，就完全停发，等对方先说话。 */
  giveUpAfterMs: 3 * 24 * 60 * 60 * 1000,
  /** 从来没有对话过的新会话，给更长的时间再说「停」。 */
  coldGiveUpAfterMs: 7 * 24 * 60 * 60 * 1000,
  /** 主动发出后这么久还没人接，允许一句收尾。 */
  closerAfterMs: 8 * 60 * 60 * 1000,
  /** 同一个会话一轮未接，最多收尾几次。 */
  maxClosers: 3,
  /** 话头超过这个时间还没被回应，就不再算「待复核」。 */
  reviewWindowMs: 48 * 60 * 60 * 1000,
  /** 同一个会话最多同时挂几个话头，防止账本无限长。 */
  maxOpenLoops: 6
}

/** 只叫名字时常见的追问词：剥掉唤醒词后只剩这些，也算「只叫了名字」。 */
const NAME_ONLY_PATTERN = /^(在吗|在不在|人呢|在么|喂|hello|hi|嗨|那个|请问)?[。.!！?？~～…\s]*$/i

/** 话题命中时忽略的高频词，避免「今天」「那个」把任何话都算相关。 */
const TOPIC_STOP_WORDS = new Set([
  '今天',
  '明天',
  '昨天',
  '现在',
  '刚才',
  '刚刚',
  '我们',
  '你们',
  '他们',
  '这个',
  '那个',
  '什么',
  '怎么',
  '可以',
  '就是',
  '还是',
  '因为',
  '所以',
  '但是',
  '已经',
  '没有',
  '知道',
  '觉得',
  '感觉',
  '一个',
  '一下',
  '有点',
  '真的',
  '确实'
])

function asText(value) {
  return typeof value === 'string' ? value : ''
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

/**
 * 深夜静默。
 *
 * 支持跨午夜的时间段（23 → 8）。起止相同视为不启用静默。
 */
export function isQuietHour(now, startHour = 23, endHour = 8) {
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return false
  if (startHour === endHour) return false
  const hour = new Date(now).getHours()
  if (startHour < endHour) return hour >= startHour && hour < endHour
  return hour >= startHour || hour < endHour
}

/** 把 '23:00' / '8' 这类写法读成小时；读不出来返回 null，交给默认值。 */
function hourOfDay(value) {
  const text = asText(value).trim()
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(text)
  if (match === null) return null
  const hour = Number(match[1])
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null
  return hour
}

/**
 * 把设置页上的「多久说一次」「夜间不扰」翻译成闸门参数。
 *
 * 这一层是接线，不是新策略：
 * getLimits 每次判断时现读，所以改完设置下一句就生效，不用重启。
 * 间隔只允许往保守的方向调——桌面可以 5 分钟一句，群里不行。
 */
export function proactiveLimitsFromPresence(presence = {}) {
  const limits = {}

  const minutes = Number(presence?.intervalMinutes)
  if (Number.isFinite(minutes) && minutes > 0) {
    const floorMinutes = DEFAULT_PROACTIVE_LIMITS.minGapMs / 60_000
    limits.minGapMs = Math.max(minutes, floorMinutes) * 60_000
  }

  const quiet = presence?.quiet
  if (quiet !== null && typeof quiet === 'object') {
    if (quiet.enabled === false) {
      // 起止相同视为不启用静默——和 isQuietHour 的约定保持一致。
      limits.quietStartHour = 0
      limits.quietEndHour = 0
    } else {
      const from = hourOfDay(quiet.from)
      const to = hourOfDay(quiet.to)
      if (from !== null) limits.quietStartHour = from
      if (to !== null) limits.quietEndHour = to
    }
  }

  return limits
}

/**
 * 只叫了名字，没有正文。
 *
 * 「昔涟」「@昔涟」「昔涟在吗」都算；「昔涟你觉得这个怎么样」不算，
 * 因为那已经有明确内容，走正常回复就行。
 */
export function isNameOnly(text, options = {}) {
  const source = asText(text).trim()
  if (source === '') return false
  const wake = matchWake(source, { words: options.words })
  if (!wake.woken) return false
  return NAME_ONLY_PATTERN.test(wake.text)
}

/** 把一条记忆拆成可以用来比对的片段：按标点切开，去掉太短的和高频词。 */
function fragmentsOf(text) {
  return asText(text)
    .split(/[，。！？；、,.!?;\s（）()「」『』【】\[\]：:]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !TOPIC_STOP_WORDS.has(item))
    .slice(0, 6)
}

/**
 * 这句话和记忆有没有强关联。
 *
 * 只认「原样出现的片段」，不做同义词猜测：
 * 记忆里有「在学 Rust」，群里说「Rust 的借用检查真难」才算命中。
 * 返回命中的片段，空数组表示无关。
 */
export function findTopicHits(text, facts, options = {}) {
  const source = asText(text)
  const limit = Number.isFinite(options.limit) ? options.limit : DEFAULT_PROACTIVE_LIMITS.maxHits
  if (source === '') return []

  const list = Array.isArray(facts) ? facts : []
  const hits = []
  const seen = new Set()

  for (const fact of list) {
    const content = typeof fact === 'string' ? fact : asText(fact?.text ?? fact?.content)
    if (content === '') continue
    for (const fragment of fragmentsOf(content)) {
      if (seen.has(fragment)) continue
      if (!source.includes(fragment)) continue
      seen.add(fragment)
      hits.push({ fragment, fact: content })
      if (hits.length >= limit) return hits
    }
  }
  return hits
}

/**
 * 止损：对方连着太久没开口，就不再主动。
 *
 * 判定要点：只看「对方最后一次说话之后，我主动发过的那几条」。
 * 只要对方说过一句，前面的账立刻作废——她愿意回来，就不算冷场。
 * 从没对过话的新会话单独给一个更宽的窗口，避免刚加上就被判死。
 */
export function evaluateSilence(options = {}) {
  const now = asNumber(options.now, Date.now())
  const limits = { ...DEFAULT_SILENCE_LIMITS, ...(options.limits ?? {}) }
  const lastUserSpokeAt = asNumber(options.lastUserSpokeAt, 0)
  const sent = (Array.isArray(options.unansweredSentAt) ? options.unansweredSentAt : [])
    .map((item) => asNumber(item, 0))
    .filter((item) => item > 0)
  if (sent.length === 0) return null

  if (lastUserSpokeAt > 0) {
    const pending = sent.filter((at) => at > lastUserSpokeAt)
    if (pending.length === 0) return null
    if (now - lastUserSpokeAt < limits.giveUpAfterMs) return null
    return {
      silenced: true,
      reason: 'silent_giveup',
      since: lastUserSpokeAt,
      sentCount: pending.length,
      cold: false
    }
  }

  const first = Math.min(...sent)
  if (now - first < limits.coldGiveUpAfterMs) return null
  return {
    silenced: true,
    reason: 'silent_giveup',
    since: first,
    sentCount: sent.length,
    cold: true
  }
}

/**
 * 硬闸门：这几条不满足时，无论有没有由头都不该开口。
 *
 * 单独抽出来，是为了让「有入站消息」和「自己想到一件事」共用同一套分寸，
 * 不会因为入口不同就各自放松一次。
 */
function preflight(options = {}) {
  const now = asNumber(options.now, Date.now())
  const limits = { ...DEFAULT_PROACTIVE_LIMITS, ...(options.limits ?? {}) }
  const lastSpokeAt = asNumber(options.lastSpokeAt, 0)
  const todayCount = asNumber(options.todayCount, 0)

  // 止损排在静默与额度之前：已经决定不说了，就不该再消耗额度。
  const silence = evaluateSilence({
    now,
    lastUserSpokeAt: options.lastUserSpokeAt,
    unansweredSentAt: options.unansweredSentAt,
    limits: { ...DEFAULT_SILENCE_LIMITS, ...(options.silenceLimits ?? {}) }
  })
  if (silence !== null) return { speak: false, reason: silence.reason, hits: [], silence }

  if (isQuietHour(now, limits.quietStartHour, limits.quietEndHour)) {
    return { speak: false, reason: 'quiet_hours', hits: [] }
  }
  if (todayCount >= limits.dailyLimit) {
    return { speak: false, reason: 'daily_limit', hits: [] }
  }
  if (lastSpokeAt > 0 && now - lastSpokeAt < limits.minGapMs) {
    return { speak: false, reason: 'cooldown', hits: [] }
  }
  return null
}

/**
 * 主动候选决策。
 *
 * 顺序很重要：先排除「不该说」的硬条件，再看有没有理由。
 * 这样即使话题很相关，深夜或刚说过话也不会开口。
 */
export function decideProactive(options = {}) {
  const limits = { ...DEFAULT_PROACTIVE_LIMITS, ...(options.limits ?? {}) }
  const text = asText(options.text).trim()
  const speaker = asText(options.speaker)
  const now = asNumber(options.now, Date.now())

  if (text === '') return { speak: false, reason: 'empty', hits: [] }
  // 自己说的话不回应自己。
  if (options.fromSelf === true || speaker === 'self') {
    return { speak: false, reason: 'from_self', hits: [] }
  }

  const blocked = preflight({ ...options, now, limits })
  if (blocked !== null) return blocked

  // 明确被 @：这就是在叫她说话，不用再另找话题由头。
  // 官方 QQ 通道的群消息只有被 @ 才会进来，这条就是「被叫到就接」。
  if (options.addressed === true) {
    return { speak: true, reason: 'addressed', score: 1, hits: [] }
  }

  // 接着自己刚说的话：这是在回应，不是无缘无故找话。
  // 静默、深夜、日额度和冷却仍要过，只是不需要额外的话题由头。
  if (options.continuation === true) {
    return { speak: true, reason: 'continuation', score: 0.8, hits: [] }
  }

  const nameOnly = isNameOnly(text, { words: options.wakeWords })
  const hits = findTopicHits(text, options.facts, { limit: limits.maxHits })

  if (nameOnly) {
    return { speak: true, reason: 'name_only', score: 1, hits: [] }
  }
  if (hits.length > 0) {
    return { speak: true, reason: 'topic_match', score: hits.length, hits }
  }

  return { speak: false, reason: 'no_reason', hits: [] }
}

/**
 * 由头：这一拍为什么开口。
 *
 * 主动说话最怕的不是说错，而是说不出理由。
 * 有具体的事（日程、约定、没聊完的话头）就照常开口；
 * 什么都没有时，只有隔得足够久，「想和你说说话」本身才算一个由头。
 */
export const DEFAULT_CUE_LIMITS = {
  /** 没有具体由头时，隔这么久才允许因为「想说话」开口一次。 */
  socialUrgeAfterMs: 2 * 60 * 60 * 1000
}

/** 由头的分量：具体的事优先于想念。 */
export const CUE_STRENGTH = {
  strong: 3,
  medium: 2,
  weak: 1
}

/**
 * 把「陪伴层给的机会」和「没聊完的话头」合并成一个由头。
 *
 * opening 由陪伴层挑出，形如 { kind, reason, note, segmentId }；
 * loop 是还没聊完的一句话。两个都没有时返回 null，
 * 交给调用方决定是沉默，还是用「隔了很久」兜底。
 */
export function resolveOpeningCue(input = {}) {
  const now = asNumber(input.now, Date.now())
  const limits = { ...DEFAULT_CUE_LIMITS, ...(input.limits ?? {}) }

  const opening = input.opening
  if (opening !== null && typeof opening === 'object') {
    const note = asText(opening.note).trim()
    if (note !== '') {
      const kind = asText(opening.kind) || 'agenda'
      // 日程、约定、记得的事、攒下的念头都是具体的事；其余按中等处理。
      const strong =
        kind === 'agenda' || kind === 'memory' || kind === 'promise' || kind === 'thought'
      return {
        kind,
        note,
        strength: strong ? 'strong' : 'medium',
        source: 'opening',
        reason: asText(opening.reason)
      }
    }
  }

  const loop = input.loop
  if (loop !== null && typeof loop === 'object') {
    const text = asText(loop.text).trim()
    if (text !== '') {
      return {
        kind: 'loop',
        note: text,
        strength: 'strong',
        source: 'loop',
        reason: 'open_loop'
      }
    }
  }

  // 最后才轮到「很久没说话」。它不是事件，只是一个念头的起点。
  const lastSpokeAt = asNumber(input.lastSpokeAt, 0)
  if (lastSpokeAt > 0 && now - lastSpokeAt >= limits.socialUrgeAfterMs) {
    return {
      kind: 'social',
      note: '',
      strength: 'weak',
      source: 'silence',
      reason: 'social_urge'
    }
  }
  return null
}

/** 由头决策：和入站消息共用同一套硬闸门。 */
export function decideByCue(options = {}) {
  const now = asNumber(options.now, Date.now())
  const limits = { ...DEFAULT_PROACTIVE_LIMITS, ...(options.limits ?? {}) }
  const cue = options.cue

  if (cue === null || cue === undefined || typeof cue !== 'object') {
    return { speak: false, reason: 'no_cue' }
  }

  const blocked = preflight({ ...options, now, limits })
  if (blocked !== null) return blocked

  return {
    speak: true,
    reason: asText(cue.reason) || asText(cue.kind) || 'cue',
    cue,
    score: CUE_STRENGTH[cue.strength] ?? 1
  }
}

/**
 * 收场：主动说过一句，很久没人接，就把这句话轻轻放下。
 *
 * 这不是「再试一次」。收场的那一句不许追问、不许撒娇要回应，
 * 说完这件事就算翻篇，之后不再提。
 * 止损优先级更高：已经决定不说了，就不要用收场绕过去。
 */
export function decideCloser(options = {}) {
  const now = asNumber(options.now, Date.now())
  const limits = { ...DEFAULT_PROACTIVE_LIMITS, ...(options.limits ?? {}) }
  const silenceLimits = { ...DEFAULT_SILENCE_LIMITS, ...(options.silenceLimits ?? {}) }
  const sent = (Array.isArray(options.unansweredSentAt) ? options.unansweredSentAt : [])
    .map((item) => asNumber(item, 0))
    .filter((item) => item > 0)
  if (sent.length === 0) return { speak: false, reason: 'nothing_pending' }

  const silence = evaluateSilence({
    now,
    lastUserSpokeAt: options.lastUserSpokeAt,
    unansweredSentAt: sent,
    limits: silenceLimits
  })
  if (silence !== null) return { speak: false, reason: silence.reason, silence }

  const closerCount = asNumber(options.closerCount, 0)
  if (closerCount >= silenceLimits.maxClosers) {
    return { speak: false, reason: 'closer_exhausted' }
  }
  const lastSentAt = Math.max(...sent)
  if (now - lastSentAt < silenceLimits.closerAfterMs) {
    return { speak: false, reason: 'not_yet' }
  }
  if (isQuietHour(now, limits.quietStartHour, limits.quietEndHour)) {
    return { speak: false, reason: 'quiet_hours' }
  }
  // 收场不占「今天说几句」的额度：它是善后，不是又开一个话题。
  // 上限由 maxClosers 与 8 小时间隔兜住，一天最多三次。

  return {
    speak: true,
    reason: 'closing',
    waitedMs: now - lastSentAt,
    index: closerCount + 1,
    total: silenceLimits.maxClosers
  }
}

/**
 * 还没结论的话头。
 *
 * 主动问过一句「后来那个事怎么样了」，对方回来了却没答，这件事就一直悬着。
 * 时间到了就再问一遍会很烦；正确做法是等对方开口的这一刻，把话头交给同一轮模型，
 * 让它自己判断「已经聊过」「对方绕开了」「还值得问一句」。
 */
export function pendingOpenLoopReviews(options = {}) {
  const now = asNumber(options.now, Date.now())
  const limits = { ...DEFAULT_SILENCE_LIMITS, ...(options.limits ?? {}) }
  const loops = Array.isArray(options.openLoops) ? options.openLoops : []
  const pending = []
  for (const loop of loops) {
    if (loop === null || typeof loop !== 'object') continue
    if (loop.resolved === true) continue
    const at = asNumber(loop.at, 0)
    if (at <= 0 || at > now) continue
    const ageMs = now - at
    if (ageMs > limits.reviewWindowMs) continue
    pending.push({
      id: asText(loop.id),
      question: asText(loop.question),
      at,
      ageMs
    })
  }
  return pending
}

/** 收场那一句的分寸。 */
export function buildCloserNote(decision) {
  if (decision?.speak !== true || decision.reason !== 'closing') return ''
  const round = asNumber(decision.index, 1)
  const tail =
    round > 1 ? '这是最后一次收尾，之后就别再提这件事了。' : '说完就翻篇，之后不再提。'
  return (
    '你上一条主动说的话，一直没人接。' +
    '这一句只把话轻轻放下，一句话就够：可以说自己要去忙别的了、要睡了，或者把刚才的话题收个尾。' +
    '不要追问，不要问「怎么不理我」，不要道歉，也不要再抛新的问题。' +
    tail
  )
}

/**
 * 收场用的几句。
 *
 * 刻意不走模型：发出后隔了那么久没人应，再为一句话付一次生成成本不划算，
 * 而且这时候最怕模型自己加戏——追问、道歉、解释，全都不该出现。
 * 三句轮换，一次比一次短；都不问问题，也不要求回应。
 */
export const CLOSER_LINES = [
  '那就先这样吧，等你回来再说♪',
  '这句话先放在这儿，人家去忙别的啦。',
  '唔，先不打扰你了。'
]

/** 按第几次收场挑一句；越往后越短。 */
export function pickCloserLine(index = 1) {
  const safe = Number.isFinite(index) ? Math.max(1, Math.floor(index)) : 1
  return CLOSER_LINES[(safe - 1) % CLOSER_LINES.length]
}

/** 话头复核的分寸：交给这一轮一起判断，不要单独追一条。 */
export function buildReviewNote(loops) {
  const list = Array.isArray(loops) ? loops.filter((item) => asText(item?.question) !== '') : []
  if (list.length === 0) return ''
  const first = list[0]
  return (
    `之前你问过「${first.question}」，到现在还没有结论。` +
    '这一轮如果对方的回复里已经带了答案，就当作聊完了，自然接住，不要再问一遍；' +
    '如果对方绕开了，也先不追，等他自己提起。' +
    '不要说「上次我问你」这种话。'
  )
}

/**
 * 带状态的闸门：记住上次开口时间、当天次数、未回应账本和话头。
 *
 * 只保存在内存里；重启后从头计数，宁可少说一次。
 * 跨天只重置「今天说了几次」——未回应账本要跨天累积，否则止损永远触发不了。
 */
/**
 * 跨会话撞车的分寸。
 *
 * 她在三个群里各说一次「今天降温了记得加衣服」，每一句单看都合理，
 * 放在一起就露馅了：这不是一个人，是一套定时文案。
 * 同一个账号在多个会话里说同一句话，是这个毛病最明显的破绽。
 *
 * 判重按字符二元组算 Jaccard 相似度，不用模型：短句足够，且零成本。
 */
export const DEFAULT_DEDUPE = {
  /** 只在这个时间窗内判重。隔一天再说同一句话，本来就不算撞车。 */
  windowMs: 6 * 60 * 60 * 1000,
  /** 相似度达到这个值就算同一句。0.62 能放过「换了个说法的同一件事」。 */
  similarity: 0.62,
  /** 全局最多记多少条，防止长跑把内存撑起来。 */
  maxEntries: 36
}

/** 去掉表情标记、空白与标点，只留下用来比较的字。 */
function normalizeLine(line) {
  return asText(line)
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase()
}

/** 字符二元组集合：中文短句不需要分词，这一步已经够用。 */
function lineBigrams(line) {
  const text = normalizeLine(line)
  const grams = new Set()
  for (let index = 0; index < text.length - 1; index += 1) {
    grams.add(text.slice(index, index + 2))
  }
  return grams
}

/** 两句的 Jaccard 相似度；任一句太短就返回 0。 */
export function lineSimilarity(a, b) {
  const left = lineBigrams(a)
  const right = lineBigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const gram of left) {
    if (right.has(gram)) shared += 1
  }
  return shared / (left.size + right.size - shared)
}

export function createProactiveGate(options = {}) {
  // 构造时先给一份兜底；传了 getLimits 就每次判断现读，
  // 这样设置页改完，下一句判断立刻按新分寸走，不用重启。
  const baseLimits = { ...DEFAULT_PROACTIVE_LIMITS, ...(options.limits ?? {}) }
  const readLimits = () =>
    typeof options.getLimits === 'function'
      ? { ...baseLimits, ...(options.getLimits() ?? {}) }
      : baseLimits
  /** 好感档只覆盖间隔与每日额度，静默时段仍听设置。 */
  const readScopeLimits = (scope) => {
    const levelId = typeof options.levelOf === 'function' ? options.levelOf(scope) : null
    return { ...readLimits(), ...proactiveLimitsForLevel(levelId) }
  }
  const silenceLimits = { ...DEFAULT_SILENCE_LIMITS, ...(options.silenceLimits ?? {}) }
  const dedupe = { ...DEFAULT_DEDUPE, ...(options.dedupe ?? {}) }
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const state = new Map()
  /** 最近真正说出去的句子，跨会话判重用。 */
  let spoken = []

  /** 只留时间窗内的，顺便把内存压住。 */
  function pruneSpoken(stamp) {
    const cutoff = stamp - dedupe.windowMs
    spoken = spoken.filter((item) => item.at >= cutoff)
    return spoken
  }

  function dayKey(timestamp) {
    const date = new Date(timestamp)
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  }

  /** 只保留最近若干条未回应记录，防止长期挂着把数组撑大。 */
  const MAX_UNANSWERED = 30

  function read(scope) {
    const key = asText(scope)
    let current = state.get(key)
    if (current === undefined) {
      current = {
        day: dayKey(now()),
        count: 0,
        lastSpokeAt: 0,
        lastUserSpokeAt: 0,
        unansweredSentAt: [],
        closerCount: 0,
        openLoops: []
      }
      state.set(key, current)
    }
    const stamp = now()
    const today = dayKey(stamp)
    if (current.day !== today) {
      current.day = today
      current.count = 0
      current.lastSpokeAt = 0
    }
    return current
  }

  function pushSent(current, stamp) {
    current.unansweredSentAt.push(stamp)
    if (current.unansweredSentAt.length > MAX_UNANSWERED) {
      current.unansweredSentAt = current.unansweredSentAt.slice(-MAX_UNANSWERED)
    }
  }

  return {
    /** 只判断，不记账。 */
    decide(scope, input = {}) {
      const current = read(scope)
      return decideProactive({
        ...input,
        now: now(),
        lastSpokeAt: current.lastSpokeAt,
        todayCount: current.count,
        lastUserSpokeAt: current.lastUserSpokeAt,
        unansweredSentAt: current.unansweredSentAt,
        limits: readScopeLimits(scope),
        silenceLimits
      })
    },
    /** 由头入口：没有入站消息，只有「这一拍想到一件具体的事」。只判断，不记账。 */
    decideByCue(scope, cue) {
      const current = read(scope)
      return decideByCue({
        cue,
        now: now(),
        lastSpokeAt: current.lastSpokeAt,
        todayCount: current.count,
        lastUserSpokeAt: current.lastUserSpokeAt,
        unansweredSentAt: current.unansweredSentAt,
        limits: readScopeLimits(scope),
        silenceLimits
      })
    },
    /** 真的发出去之后再调用；失败不要记账，下一轮还有机会。 */
    markSpoke(scope, line = '') {
      const current = read(scope)
      const stamp = now()
      current.count += 1
      current.lastSpokeAt = stamp
      pushSent(current, stamp)
      const text = normalizeLine(line)
      if (text !== '') {
        const kept = pruneSpoken(stamp)
        kept.push({ scope: asText(scope), text, at: stamp })
        spoken = kept.length > dedupe.maxEntries ? kept.slice(-dedupe.maxEntries) : kept
      }
    },
    /**
     * 这句话在别的会话里是不是刚说过。
     *
     * 只看跨会话：同一个群里前后重复，由 decide 的冷却与话头复核管，
     * 这里专门抓「三个群收到同一句」那种破绽。
     */
    findDuplicate(scope, line) {
      const key = asText(scope)
      const text = normalizeLine(line)
      if (text === '') return { duplicate: false, similarity: 0, scope: '' }
      const stamp = now()
      let best = { duplicate: false, similarity: 0, scope: '' }
      for (const item of pruneSpoken(stamp)) {
        if (item.scope === key) continue
        const score = lineSimilarity(text, item.text)
        if (score >= dedupe.similarity && score > best.similarity) {
          best = { duplicate: true, similarity: Math.round(score * 1000) / 1000, scope: item.scope }
        }
      }
      return best
    },
    /**
     * 对方开口了。
     *
     * 一次开口就把未回应账本清零：人回来了，之前那些「说了没人接」不算数了。
     */
    noteUserSpoke(scope) {
      const current = read(scope)
      current.lastUserSpokeAt = now()
      current.unansweredSentAt = []
      current.closerCount = 0
    },
    /** 主动问出去的话头，记一笔，等对方回来时复核。 */
    noteOpened(scope, input = {}) {
      const current = read(scope)
      const question = asText(input.question).trim()
      if (question === '') return ''
      const id = asText(input.id) || `loop-${now()}-${current.openLoops.length + 1}`
      current.openLoops.push({ id, question, at: asNumber(input.at, now()), resolved: false })
      if (current.openLoops.length > silenceLimits.maxOpenLoops) {
        current.openLoops = current.openLoops.slice(-silenceLimits.maxOpenLoops)
      }
      return id
    },
    /** 这一轮模型判完了，把话头结掉。status: done / cancelled / updated */
    resolveOpenLoop(scope, id, status = 'done') {
      const current = read(scope)
      const target = current.openLoops.find((item) => item.id === asText(id))
      if (target === undefined) return false
      target.resolved = true
      target.status = asText(status) || 'done'
      target.resolvedAt = now()
      return true
    },
    /** 收场时机到了没有。只判断，不记账。 */
    decideCloser(scope, input = {}) {
      const current = read(scope)
      return decideCloser({
        ...input,
        now: now(),
        lastUserSpokeAt: current.lastUserSpokeAt,
        unansweredSentAt: current.unansweredSentAt,
        closerCount: current.closerCount,
        todayCount: current.count,
        limits: readScopeLimits(scope),
        silenceLimits
      })
    },
    /** 收场那句话真的发出去之后再调用。 */
    markClosed(scope) {
      const current = read(scope)
      const stamp = now()
      current.closerCount += 1
      current.count += 1
      current.lastSpokeAt = stamp
      pushSent(current, stamp)
    },
    /** 对方这条消息该复核哪些话头。只读。 */
    pendingReviews(scope) {
      const current = read(scope)
      return pendingOpenLoopReviews({ now: now(), openLoops: current.openLoops, limits: silenceLimits })
    },
    /**
     * 账本里出现过的所有会话。
     *
     * 收场需要一个时机去问「哪些会话该收尾了」，而账本本来就是按 scope 存的。
     * 只读，不会因为遍历而创建新条目。
     */
    scopes() {
      return [...state.keys()]
    },
    /** 给设置页或日志看。 */
    snapshot(scope) {
      const current = read(scope)
      const stamp = now()
      const limits = readScopeLimits(scope)
      const silence = evaluateSilence({
        now: stamp,
        lastUserSpokeAt: current.lastUserSpokeAt,
        unansweredSentAt: current.unansweredSentAt,
        limits: silenceLimits
      })
      return {
        day: current.day,
        count: current.count,
        dailyLimit: limits.dailyLimit,
        minGapMs: limits.minGapMs,
        nextAllowedAt:
          current.lastSpokeAt > 0 ? current.lastSpokeAt + Number(limits.minGapMs ?? 0) : 0,
        lastSpokeAt: current.lastSpokeAt,
        lastUserSpokeAt: current.lastUserSpokeAt,
        unansweredCount: current.unansweredSentAt.length,
        closerCount: current.closerCount,
        openLoopCount: current.openLoops.filter((item) => item.resolved !== true).length,
        silenced: silence !== null,
        silenceReason: silence?.reason ?? ''
      }
    }
  }
}

/**
 * 给模型的一句提醒。
 *
 * 主动开口和普通回复不同：她要先知道「这不是在叫我」，
 * 才可能只说一句、不追问、不刷屏。
 */
export function buildProactiveNote(decision) {
  if (decision?.speak !== true) return ''
  if (decision.reason === 'addressed') {
    return '群里有人直接 @ 了你，是在跟你说话。正常接住就好，一句或两句；不要提「你叫了我」这件事，也不要连着刷。'
  }
  if (decision.reason === 'continuation') {
    return '群里有人接着你刚才那句话在说。顺着接住就好，别当成新话题重新开场；一句就够，不用把话补满。'
  }
  if (decision.reason === 'name_only') {
    return '群里有人叫了你的名字，但没说要什么。可以轻轻应一声，问一句怎么了；不要连发，也不要自己找话题。'
  }
  if (decision.reason === 'topic_match') {
    const fragment = decision.hits?.[0]?.fragment
    return fragment
      ? `群里在聊「${fragment}」，这件事和你记得的有关。想接就自然接一句，不想接也没关系；别把记忆原样背出来。`
      : '群里的话题和你记得的有关。想接就自然接一句，不想接也没关系。'
  }
  return ''
}
