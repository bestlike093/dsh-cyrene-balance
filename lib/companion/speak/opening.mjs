/**
 * 主动开口的「由头」与「话头账本」。
 *
 * 念头只管等多久，不管发不发；攒够了还得有一个理由。
 * 三条不发：派不出由头、模型否决、闸门不过。
 *
 * 这一层只回答两个问题：
 *   1. 现在有没有值得开口的由头（pickCue）
 *   2. 之前开过的口，她是接住了还是被晾着（账本）
 *
 * 约束：零 Electron、零宿主依赖，时间与数据全部注入。
 */

import { personaDayKey } from '../persona/persona-time.mjs'

export const OPENING_VERSION = 1

/* 三类由头 + 记忆回访。抽签按权重随机，顺序不构成优先级；同权重时靠后兜底。 */
export const CUE_KINDS = ['schedule', 'unfinished', 'reunion', 'memory']

export const DEFAULT_OPENING = {
  minGapMs: 90 * 60 * 1000,
  dailyCap: 3,
  unansweredLimit: 3,
  silenceDays: 3,
  quiet: false,
  /* 间隔抖动比例：同一个 lastOpenAt 永远得到同一个系数。 */
  jitter: 0.15,
  /* 几类由头同时成立时按权重抽一个，不再固定先命中先返回。 */
  random: Math.random,
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

/*
 * 四类由头的基准分量。
 *
 * 日程最实，记忆最轻；采样前会做三次方锐化，让「该说的话」仍占大头，
 * 又不至于每次都被同一类抢走——真人开口时也会忽然想起一件旧事。
 */
const CUE_BASE_WEIGHT = {
  schedule: 1,
  unfinished: 0.9,
  reunion: 0.85,
  memory: 0.7,
}

/** 0~1 的稳定伪随机：同一个种子永远得到同一个数。 */
export function unitOf(seed) {
  const x = Math.sin(Number(seed) || 0) * 10000
  return x - Math.floor(x)
}

/**
 * 稳定的伪随机抖动：同一个种子永远得到同一个系数。
 *
 * 用 lastOpenAt 当种子，一次等待里门槛不会每 60 秒变一次；
 * 下回开口后种子换了，节奏才跟着换。
 *
 * 抖动在夹取之后做，基准值已经落进 45~150 分钟，这里只负责 ±15%。
 */
export function jitterOf(seed, span = 0.15) {
  return 1 - span + unitOf(seed) * span * 2
}

/**
 * 性格参数 → 主动开口的基准节奏。
 *
 * 间隔用除法：scale 越大越黏，间隔越短；指数 1.2 让 0.7~1.3 这段实际人格
 * 落在 138~66 分钟，全程连续可分辨，不会有人格区间被上限压平。
 *
 * 额度用线性并允许小数：3~5 之间连续，消费端按「整数必给、小数部分按天数
 * 抽样」执行，避免 3 和 4 之间那道整数台阶。
 *
 * 抖动不在这里做，交给 pickCue，免得夹取把随机性吃掉。
 *
 * 记账口径：
 *   1. 当前供给下 quota 先到顶，间隔排在后面轮不到执行；把 minGapMs 反推成
 *      「清醒窗口 ÷ quota」，只是让两个旋钮账面自洽，不带来新差异。清醒窗口
 *      是 8:00~23:00 共 900 分钟（见 companion-runtime 的开口时段判断）。
 *   2. 反推间隔落在 45~150 夹取之内时，gap 维度的人格差异由指数 1.2 保留；
 *      两端都压到夹取边界时差异才消失，属可接受的极端人格表现。
 *   3. 夹取上限 150 乘抖动上界 1.15 得到 172.5；要调整 150，先定义显式上限
 *      常量并加断言，否则越界不会有报错。
 *   4. 做离线回归时，「供给充分」要留一点空窗，由头略多于 quota 即可。
 */
export function openingRhythmOf(scale) {
  const value = Number(scale)
  const safe = Math.min(1.8, Math.max(0.5, Number.isFinite(value) ? value : 1))
  const gapMinutes = Math.min(150, Math.max(45, 90 / Math.pow(safe, 1.2)))
  const quota = Math.min(5, Math.max(3, 3 + ((safe - 0.7) * (2 / 0.6))))
  return {
    minGapMs: Math.round(gapMinutes * 60 * 1000),
    dailyCap: Math.round(quota * 100) / 100,
  }
}

/**
 * 按分量抽一个由头。
 *
 * 分两层抽：先按类抽，再在类内抽条目。
 *
 * 一类的条目变多时，类与类之间的平衡不变——记忆能一次给三条候选补供给，
 * 却不会因为条数多就压掉日程。若只做一层，三条旧事加起来的总权重会顶掉别的类。
 */
function weightedPick(candidates, random) {
  const pick = typeof random === 'function' ? random : Math.random

  const groups = new Map()
  for (const item of candidates) {
    /*
     * never 在组池时就出局：降权 ≠ 剔除，但「不主动提」是明确的剔除信号。
     * 类内那道只是双保险，正常不该见到它。
     */
    if (item.mentionPolicy === 'never') continue
    const kind = typeof item.kind === 'string' ? item.kind : 'memory'
    if (!groups.has(kind)) groups.set(kind, [])
    groups.get(kind).push(item)
  }
  if (groups.size === 0) return null

  const scored = [...groups.entries()].map(([kind, items]) => {
    const top = items.reduce((max, item) => Math.max(max, Number(item.weight) || 0), 0)
    return { kind, items, score: Math.pow(Math.max(0.01, top), 3) }
  })

  /* 地板取峰值的一小截：强事件日也不至于把别的由头全压没。 */
  const peak = scored.reduce((max, entry) => Math.max(max, entry.score), 0)
  const floor = peak * 0.08
  for (const entry of scored) entry.score = Math.max(entry.score, floor)

  const total = scored.reduce((sum, entry) => sum + entry.score, 0)
  let cursor = pick() * total
  let chosen = scored[scored.length - 1]
  for (const entry of scored) {
    cursor -= entry.score
    if (cursor <= 0) {
      chosen = entry
      break
    }
  }

  /*
   * 类内再抽一次：同一天有两条旧事时，先想起哪条也该有细微差别。
   * never 已在组池时滤掉；这里再滤一次是双保险，正常不该命中。
   */
  const filtered = chosen.items.filter((item) => item.mentionPolicy !== 'never')
  const inner = filtered.length > 0 ? filtered : chosen.items
  const weightOfItem = (item) => Math.max(0.01, Number(item.weight) || 0)
  const innerTotal = inner.reduce((sum, item) => sum + weightOfItem(item), 0)
  let second = pick() * innerTotal
  for (const item of inner) {
    second -= weightOfItem(item)
    if (second <= 0) return item
  }
  return inner[inner.length - 1]
}

export function defaultLedger(now = Date.now()) {
  return {
    version: OPENING_VERSION,
    updatedAt: now,
    lastOpenAt: null,
    lastUserAt: null,
    unanswered: 0,
    entries: [],
  }
}

function safeText(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/*
 * 日期键只用来判断「今天」：额度重置、重聚去重都归到人格时区，
 * 和日程、开口时段保持一致。抖动的种子是 lastOpenAt 绝对时间戳，
 * 不走这里，跨时区也不该平移。
 */
function dayOf(now) {
  return personaDayKey(now)
}

export function normalizeLedger(raw, now = Date.now()) {
  if (raw === null || typeof raw !== 'object') return defaultLedger(now)
  const entries = Array.isArray(raw.entries)
    ? raw.entries
        .filter((item) => item !== null && typeof item === 'object' && Number.isFinite(Number(item.at)))
        .map((item) => ({
          at: Number(item.at),
          kind: CUE_KINDS.includes(item.kind) ? item.kind : 'memory',
          key: safeText(item.key, 120),
          responded: item.responded === true,
        }))
        .slice(-60)
    : []
  return {
    version: OPENING_VERSION,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
    lastOpenAt: raw.lastOpenAt !== null && Number.isFinite(Number(raw.lastOpenAt)) ? Number(raw.lastOpenAt) : null,
    lastUserAt: raw.lastUserAt !== null && Number.isFinite(Number(raw.lastUserAt)) ? Number(raw.lastUserAt) : null,
    unanswered: Math.max(0, Math.trunc(Number(raw.unanswered) || 0)),
    entries,
  }
}

/* 同一个由头一天内不重复用，避免她老是提同一件事 */
export function usedKeyRecently(ledger, key, now = Date.now(), withinMs = DAY) {
  if (safeText(key) === '') return false
  return normalizeLedger(ledger, now).entries.some(
    (entry) => entry.key === key && now - entry.at < withinMs,
  )
}

export function openingsToday(ledger, now = Date.now()) {
  const day = dayOf(now)
  return normalizeLedger(ledger, now).entries.filter((entry) => dayOf(entry.at) === day).length
}

/**
 * 选一个由头。返回 null 表示这次不发。
 *
 * agenda:      [{ at, text, key? }]      日程节点
 * unfinished:  [{ text, lastAt, key? }]  未完话题
 * lastTalkAt:  上一次和用户说话的时间
 * memories:    [{ text, weight, key? }]  够分量的记忆（可选）
 * mood:        当前心情标签（可选）：难过 / 生气时旧事更有分量，日程靠后；
 *              轻快时日程更有分量。只调权重，不新开由头。
 * body:        { drained?, exhausted?, lowEnergy? }（可选）：精力见底时
 *              不主动开新话题，只回访没说完的事和旧记忆。
 */
export function pickCue({
  now = Date.now(),
  agenda = [],
  unfinished = [],
  lastTalkAt = null,
  memories = [],
  ledger = null,
  mood = null,
  body = null,
  options = {},
} = {}) {
  const config = { ...DEFAULT_OPENING, ...options }
  if (config.quiet) return null

  const state = normalizeLedger(ledger, now)
  /* 同一次等待里抖动系数固定，不会每 60 秒换一个门槛。 */
  const gapLimit = config.minGapMs * jitterOf(state.lastOpenAt ?? 0, config.jitter)
  if (state.lastOpenAt !== null && now - state.lastOpenAt < gapLimit) return null

  /*
   * 额度可以带小数：整数部分每天必给，小数部分是「今天多放一条」的概率。
   * 用日期当种子，一天只掷一次，不会因为 60 秒轮询反复重抽。
   */
  const quota = Math.max(0, Number(config.dailyCap) || 0)
  const usedToday = openingsToday(state, now)
  const wholeQuota = Math.floor(quota)
  const extra = quota - wholeQuota
  if (usedToday > wholeQuota) return null
  if (usedToday >= wholeQuota) {
    if (extra <= 0) return null
    const daySeed = Number(dayOf(now).replace(/-/g, ''))
    if (unitOf(daySeed) >= extra) return null
  }
  if (shouldGiveUp(state, { now, silenceDays: config.silenceDays, unansweredLimit: config.unansweredLimit })) {
    return null
  }

  // 情绪参与抽签：难过 / 生气时旧事与未完话题更有分量，日程靠后；
  // 轻快时反过来。精力见底时不主动开新话题。
  const moodKey = typeof mood === 'string' ? mood.toLowerCase() : ''
  const lowMood = moodKey === 'sad' || moodKey === 'angry' || moodKey === 'tired'
  const brightMood = moodKey === 'happy' || moodKey === 'bright' || moodKey === 'excited'
  const drained = body?.drained === true || body?.exhausted === true
  const lowEnergy = drained || body?.lowEnergy === true

  /* 先把能用的由头都摆出来，最后按分量抽一个。 */
  const candidates = []

  /* 1. 日程节点：已经到点（30 分钟内）或快要到（45 分钟内）。精力见底时不开新日程话题。 */
  const due = agenda
    .filter((item) => item !== null && typeof item === 'object')
    .map((item) => ({ ...item, at: Number(item.at) }))
    .filter((item) => Number.isFinite(item.at))
    .filter((item) => item.at - now <= 45 * 60 * 1000 && now - item.at <= 30 * 60 * 1000)
    .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))[0]
  if (due !== undefined && !lowEnergy) {
    const key = safeText(due.key) || `schedule:${due.at}`
    if (!usedKeyRecently(state, key, now)) {
      /* 离节点越近，这份由头越硬；情绪低落时日程退后，轻快时更有兴致提。 */
      const nearness = 1 - (Math.min(1, Math.abs(due.at - now) / (45 * 60 * 1000)) * 0.3)
      const moodScale = lowMood ? 0.6 : brightMood ? 1.2 : 1
      candidates.push({
        kind: 'schedule',
        key,
        text: safeText(due.text),
        reason: '日程到点了',
        weight: CUE_BASE_WEIGHT.schedule * nearness * moodScale,
      })
    }
  }

  /* 2. 未完话题：至少放了半小时，最多一周，且今天没提过。精力见底也保留：接旧话比开新话省力。 */
  const open = unfinished
    .filter((item) => item !== null && typeof item === 'object')
    .map((item) => ({ ...item, lastAt: Number(item.lastAt) }))
    .filter((item) => Number.isFinite(item.lastAt))
    .filter((item) => now - item.lastAt >= 30 * 60 * 1000 && now - item.lastAt <= 7 * DAY)
    .sort((a, b) => b.lastAt - a.lastAt)[0]
  if (open !== undefined) {
    const key = safeText(open.key) || `unfinished:${open.text}`
    if (!usedKeyRecently(state, key, now)) {
      /* 刚放下的话头比搁了一周的话头更该接；情绪低落时未完的话比日程更想先接。 */
      const freshness = 1 - (Math.min(1, (now - open.lastAt) / (7 * DAY)) * 0.4)
      const moodScale = lowMood ? 1.2 : 1
      candidates.push({
        kind: 'unfinished',
        key,
        text: safeText(open.text),
        reason: '上次的话还没说完',
        weight: CUE_BASE_WEIGHT.unfinished * freshness * moodScale,
      })
    }
  }

  /* 3. 隔久问候：超过 8 小时没说话，且不是深夜（深夜交给闸门）。精力见底时不新起问候。 */
  if (lastTalkAt !== null && Number.isFinite(Number(lastTalkAt)) && !drained) {
    const gap = now - Number(lastTalkAt)
    if (gap >= 8 * HOUR) {
      const key = `reunion:${dayOf(now)}`
      if (!usedKeyRecently(state, key, now)) {
        /* 隔得越久，越想先问一句。 */
        const longing = 0.8 + (Math.min(1, gap / DAY) * 0.4)
        candidates.push({
          kind: 'reunion',
          key,
          text: '',
          reason: gap >= DAY ? '隔了一天以上' : '隔了半天',
          weight: CUE_BASE_WEIGHT.reunion * longing,
        })
      }
    }
  }

  /*
   * 4. 记忆回访：最多三条各自成候选。
   *
   * 另外三类都靠外部事件或时间，只有这一类能凭空补上供给。一次只放一条，
   * 间隔调得再短也会因为没有由头而空等。类内条数不影响类间平衡，抽签分两层。
   */
  const memoryPool = memories
    .filter((item) => item !== null && typeof item === 'object')
    /*
     * never 不进池：降权 ≠ 剔除，但「不主动提」是明确的剔除信号。
     * 放在最上游，`candidates` 只复制选中的字段，policy 不会跟着走。
     */
    .filter((item) => item.mentionPolicy !== 'never')
    .map((item) => ({ ...item, weight: Number(item.weight) || 0 }))
    // 门槛放到 0.35：30 天半衰期下，被提起过一次、或最近两周内的记忆都够得着，
    // 不再只剩「反复确认过的少数几条」能回访。
    .filter((item) => item.weight >= 0.35)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
  for (const item of memoryPool) {
    const key = safeText(item.key) || `memory:${item.text}`
    if (usedKeyRecently(state, key, now)) continue
    candidates.push({
      kind: 'memory',
      key,
      text: safeText(item.text),
      reason: '想起了一件旧事',
      // 情绪低落时旧事更有分量：念旧不是缺陷，是她现在想找熟悉的东西。
      weight: CUE_BASE_WEIGHT.memory * item.weight * (lowMood ? 1.3 : 1),
    })
  }

  /*
   * 空文本不是候选。
   *
   * 候选只回答「为什么开口」，具体句子由 openingText 生成；一条由头若连
   * 自己的文本都没有，就不该进入抽签。否则调用方直接读 cue.text 时，
   * 会留下一个空气泡，账本还会记一次「说过」。
   *
   * 归「无候选不开口」闸：在这里剔除，数量归零就返回 null；调用方拿到
   * null 不会写 ledger（见 companion-runtime 的 no_cue 分支）。
   */
  const speakable = candidates.filter((item) => safeText(item.text) !== '')
  if (speakable.length === 0) return null
  return weightedPick(speakable, config.random)
}

/* 记一次真的发出去了；unanswered 表示连着几次没被接住 */
export function recordOpening(ledger, cue, now = Date.now()) {
  const state = normalizeLedger(ledger, now)
  const entry = {
    at: now,
    kind: CUE_KINDS.includes(cue?.kind) ? cue.kind : 'memory',
    key: safeText(cue?.key, 120),
    responded: false,
  }
  return {
    ...state,
    updatedAt: now,
    lastOpenAt: now,
    unanswered: state.unanswered + 1,
    entries: [...state.entries, entry].slice(-60),
  }
}

/* 用户说话了：这一批开口全部算被接住（无从分辨他回的是哪一条），连击清零 */
export function markResponse(ledger, now = Date.now()) {
  const state = normalizeLedger(ledger, now)
  const entries = state.entries.map((entry) =>
    entry.responded ? entry : { ...entry, responded: true }
  )
  return { ...state, updatedAt: now, lastUserAt: now, unanswered: 0, entries }
}

/**
 * 连续几天不回应就主动停发。
 * unansweredLimit 次没接住 + 距最近一次（未被接住的）开口超过 silenceDays 天。
 *
 * 参照点是 lastOpenAt 而不是 lastUserAt：对方只要隔三差五说一句就刷新
 * lastUserAt，止损条件就永远不成立；「她开的这些口有没有人接」才是该看的。
 */
export function shouldGiveUp(ledger, { now = Date.now(), silenceDays = 3, unansweredLimit = 3 } = {}) {
  const state = normalizeLedger(ledger, now)
  if (state.unanswered < unansweredLimit) return false
  const anchor = state.lastOpenAt ?? state.lastUserAt
  if (anchor === null) return false
  return now - anchor >= silenceDays * DAY
}

/* 设置页 / 日记用的一句话 */
export function ledgerSummary(ledger, now = Date.now()) {
  const state = normalizeLedger(ledger, now)
  return {
    today: openingsToday(state, now),
    unanswered: state.unanswered,
    lastOpenAt: state.lastOpenAt,
    lastUserAt: state.lastUserAt,
    gaveUp: shouldGiveUp(state, { now }),
  }
}
