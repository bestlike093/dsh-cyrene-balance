/**
 * 好感层：事件表 + 当日净额上限 + 各维向基线半衰回归。
 *
 * 一个数字撑不起「像人」。亲近会冷会热，信任不该因为三天没说话就掉，
 * 熟悉度是共同经历堆出来的，只增不减。
 *
 * 约束：零 Electron、零宿主依赖、纯函数为主，时间由调用方注入。
 * 规则可被外部 JSON 覆盖，方便以后调参而不改代码。
 *
 * 尺度口径（C1/C2 决议，2026-11-13 拍板；本文件在 fde4214 之前仍是旧的小数尺度）：
 *   - 单次事件走「关系点」尺度，档位边界由 standard 的 BOND.eventTiers 给，
 *     正向基准 moment=13、负向基准 hurt=25（decisions.md :30）。
 *   - 日上限按维走 RELATION.dailyCap，**先求和再截断**（decisions.md :31），
 *     逐条 dailyCap 与 dailyCapFactor 那一层已经废止。
 *   - 自然回落走 RELATION.halfLifeDays 向基线回归；线性 decayPerDay 废止
 *     （decisions.md :121），负总分不钳 0（:119）。
 *   - 六维（依赖/欣赏/亲密）的消费端与旧存档基线迁移属后续工程，本文件当前
 *     仍只结算 affinity / trust / familiarity 三维；未接线的维度不假装在跑。
 */
/* B2-006：媒体占位标记不占探针采样名额 —— 它会挤掉真句，把分数拉成 0。 */
import { isMediaNoteOnly } from '../memory/media-note.mjs'

/* v3：主人按标准起点入场；重要/次重要各有起点；路人看前十句话。 */
export const BOND_VERSION = 3

/* 阶段判档只在这里做一次，快照和提示词都从这里取。 */
import { RELATION, BOND, TIME } from '../standard.mjs'
import { personaDayKey } from '../persona/persona-time.mjs'
import { resolveRelationStage } from './relationship-stage.mjs'
import { validateStageOutput } from './stage-contract.mjs'

/* 维度与取值范围来自统一标准：affinity 会掉到负数，trust / familiarity 不会 */
export const BOND_DIMENSIONS = RELATION.dimensions

/*
 * 合法阶段键集合，从 RELATION.stages 现取。
 * 存档时用它筛掉猜出来的档名；这里不抄第二份六档清单——抄了就是一张本地重定义的表。
 */
const STAGE_KEYS = new Set((RELATION.stages ?? []).map((stage) => stage.key))

/* 关系档只留 policy 一份（relationship-stage.mjs）。
 * 这里原本还有一张按加权分切档的表，口径与阶段表不一致，已经撤掉。 */

const DAY = TIME.DAY
const HOUR = TIME.HOUR

/* 新鲜度窗口与份量台阶都由统一标准给，这里只做命名映射。 */
const NOVELTY_WINDOW_MS = BOND.noveltyWindow
const NOVELTY_STEPS = BOND.noveltySteps

function noveltyScale(bond, rule, now) {
  if (rule.novelty === false) return 1
  const recent = bond.log.filter(
    (item) => item.type === rule.id && now - item.at >= 0 && now - item.at < NOVELTY_WINDOW_MS,
  ).length
  return NOVELTY_STEPS[Math.min(recent, NOVELTY_STEPS.length - 1)]
}

/**
 * 默认事件表（关系点尺度）。
 *
 * 分级原则（tier）来自 standard 的 BOND.eventTiers，档内可按语义微调：
 *   micro      0.5 ~ 1.5   日常微互动，靠次数和陪伴累积
 *   small        2 ~ 4     一次互动里能感到分量的小事
 *   medium       6 ~ 10    被理解、被接住、被记住
 *   moment      11 ~ 15    特殊时刻；13 就是 C1 锁的好感正向基准
 *   hurt        18 ~ 26    受伤；25 就是 C1 锁的好感负向基准
 *   deep-hurt   26 ~ 30    信任层面的裂口
 *
 * 「像人」的两个约束：
 *   - 日常不能猛涨：micro / small 加起来一天也不该越过一次 moment
 *   - 特殊时刻允许大跳：moment 一次可以顶十几句闲聊，这是记忆锚点
 *
 * noveltyWindow 内重复同一事件会递减（见 applyBondEvent），
 * 连夸三次的快乐不该等于夸三次。
 *
 * 这里没有 dailyCap 字段：日上限按维走 RELATION.dailyCap，先求和再截断。
 * 逐条卡上限会把「十件小事」压成「一件小事」，人是一整天才算一天。
 */
export const DEFAULT_BOND_RULES = [
  /* ---- 日常微互动：micro 档 ---- */
  { id: 'greet', dim: 'affinity', delta: 1, tier: 'micro', label: '你跟她打了招呼' },
  { id: 'initiate', dim: 'affinity', delta: 1.5, tier: 'micro', label: '你主动找她说话' },
  { id: 'reply', dim: 'affinity', delta: 0.5, tier: 'micro', label: '你认真回了她一句' },
  { id: 'thanks', dim: 'affinity', delta: 1, tier: 'micro', label: '你跟她说了谢谢' },

  /* ---- 小型正面：small 档 ---- */
  { id: 'together', dim: 'familiarity', delta: 2, tier: 'small', label: '一起在 DSH 里忙了一阵' },
  { id: 'seen', dim: 'familiarity', delta: 2, tier: 'small', label: '又见到这个人说话' },
  { id: 'praise', dim: 'affinity', delta: 3, tier: 'small', label: '你夸了她' },
  { id: 'teased', dim: 'affinity', delta: 2, tier: 'small', label: '你把她逗笑了' },
  { id: 'shareJoy', dim: 'affinity', delta: 3, tier: 'small', label: '你把好消息告诉了她' },
  { id: 'sharePain', dim: 'trust', delta: 3, tier: 'small', label: '你跟她说了难过的事' },
  { id: 'lateNight', dim: 'affinity', delta: 2.5, tier: 'small', label: '很晚了还在一起' },
  { id: 'quietCompany', dim: 'affinity', delta: 2, tier: 'small', label: '安安静静陪着，没有出声' },

  /* ---- 中型：被理解、被接住、被记住 ---- */
  { id: 'comfort', dim: 'trust', delta: 8, tier: 'medium', label: '她难过的时候，你安慰了她' },
  { id: 'apologize', dim: 'trust', delta: 6, tier: 'medium', label: '她认错，你接住了' },
  { id: 'soothe', dim: 'affinity', delta: 6, tier: 'medium', label: '她有点生气，你哄好了' },
  { id: 'care', dim: 'trust', delta: 6, tier: 'medium', label: '你累了，她体贴了你' },
  { id: 'recall', dim: 'trust', delta: 6, tier: 'medium', label: '她准确提起了旧事' },
  { id: 'recallPraise', dim: 'affinity', delta: 7, tier: 'medium', label: '你记得她随口说过的小事' },
  { id: 'corrected', dim: 'trust', delta: 6, tier: 'medium', label: '你指出她错了，她听进去了' },
  { id: 'comeBack', dim: 'affinity', delta: 10, tier: 'medium', label: '隔了很久，你又回来了' },
  { id: 'longSession', dim: 'familiarity', delta: 8, tier: 'medium', label: '陪她熬过一段很长的活' },
  { id: 'closeness', dim: 'affinity', delta: 7, tier: 'medium', label: '贴近了一小会儿' },

  /* ---- 特殊时刻：moment 档，一次顶得上一整天的日常 ---- */
  { id: 'firstTime', dim: 'familiarity', delta: 11, tier: 'moment', label: '第一次一起做成一件事' },
  { id: 'promise', dim: 'trust', delta: 13, tier: 'moment', label: '你们约定了以后' },
  { id: 'deepTalk', dim: 'affinity', delta: 14, tier: 'moment', label: '聊到了心里很深的地方' },
  { id: 'shareSecret', dim: 'trust', delta: 15, tier: 'moment', label: '第一次把没跟别人说过的事告诉了她' },
  { id: 'anniversary', dim: 'affinity', delta: 15, tier: 'moment', label: '一起过的日子被记住了' },
  { id: 'birthday', dim: 'affinity', delta: 14, tier: 'moment', label: '她的生日，你在' },

  /* ---- 负面：小事几乎不动，裂口才扣得深 ---- */
  { id: 'perfunctory', dim: 'affinity', delta: -1, tier: 'micro', label: '连续几句都敷衍' },
  { id: 'interrupt', dim: 'affinity', delta: -2, tier: 'small', label: '她话没说完就被打断' },
  { id: 'ignoredQuestion', dim: 'affinity', delta: -3, tier: 'small', label: '她问了话，没有等到回答' },
  { id: 'rejected', dim: 'affinity', delta: -3, tier: 'small', label: '她凑过来，被推开了' },
  { id: 'coldReply', dim: 'affinity', delta: -2.5, tier: 'small', label: '她认真说话，只收到冷淡' },
  { id: 'misremember', dim: 'trust', delta: -6, tier: 'medium', label: '她记错了要紧的事' },
  { id: 'brokenPromise', dim: 'trust', delta: -8, tier: 'medium', label: '说好的事没有做到' },
  { id: 'mockTrust', dim: 'trust', delta: -18, tier: 'hurt', label: '她认真说过的事被拿来开玩笑' },
  { id: 'harshWords', dim: 'affinity', delta: -25, tier: 'hurt', label: '对她说了很重的话' },
  { id: 'betray', dim: 'trust', delta: -26, tier: 'deep-hurt', label: '信任被辜负了' },

  /* ---- 依赖／欣赏／亲密：档案 :58-91 已锁定的三条事件源 ----
   * 幅度直接照档案数值（依赖 :65 +3/−2，欣赏 :76 +3/−3，亲密 :87 +2/−8），
   * 档位由 |delta| 落进 BOND.eventTiers 现取，不自己定区间。
   * 日上限早已在 RELATION.dailyCap 里齐着（5/2、5/5、3/10），
   * applyBondEvent 按维取表，这三键接上 dim 就自动受管。
   */
  { id: 'needMe', dim: 'dependence', delta: 3, tier: 'small', label: '她有事第一个想到你' },
  { id: 'relyOn', dim: 'dependence', delta: 3, tier: 'small', label: '这段日子的事都交给你了' },
  { id: 'coldShoulder', dim: 'dependence', delta: -2, tier: 'small', label: '她找你的时候，你不在' },
  { id: 'impress', dim: 'admiration', delta: 3, tier: 'small', label: '你把一件事做得很漂亮' },
  { id: 'kindAct', dim: 'admiration', delta: 3, tier: 'small', label: '她看见你对陌生人释放的善意' },
  { id: 'disappoint', dim: 'admiration', delta: -3, tier: 'small', label: '你让她失望了一次' },
  { id: 'openUp', dim: 'intimacy', delta: 2, tier: 'small', label: '她说了心事，你接住了' },
  { id: 'refused', dim: 'intimacy', delta: -8, tier: 'medium', label: '她袒露到一半，被推回去了' },
  /* 疏远走 micro：每天一点点，累计封顶由 BOND.neglectCap 管（见 applyBondEvent）。 */
  { id: 'neglect', dim: 'affinity', delta: -BOND.neglectPerDay, tier: 'micro', label: '很久没有联系' },
]


/*
 * 事件表是模块内的语义微调，但每一条都必须落在 BOND.eventTiers 声明的区间内。
 * 这里在加载时自检，避免以后调数字时悄悄越档。
 * 日上限不在自检范围：档位表里没有 cap，净额上限按维走 RELATION.dailyCap。
 */
for (const rule of DEFAULT_BOND_RULES) {
  const bounds = BOND.eventTiers[rule.tier]
  if (bounds === undefined) throw new Error(`未知的好感档位：${rule.tier}`)
  const delta = Math.abs(rule.delta)
  if (delta < bounds.delta[0] || delta > bounds.delta[1]) {
    throw new Error(`好感事件 ${rule.id} 的单次变化越档：${delta} ∉ [${bounds.delta[0]}, ${bounds.delta[1]}]`)
  }
}



/* ------------------------------------------------------------------ *
 * 关系起点：不是所有人都该从 0 开始认识她。
 * 主人一进门就有 60 以上的好感；熟悉度只垫一小段，高阶段仍要靠相处。
 * 重要/次重要由主人在设置里点名；路过的群友看完前十句话才知道该站在哪儿。
 * ------------------------------------------------------------------ */

const TIER_LABELS = {
  owner: '主人',
  important: '重要的人',
  secondary: '次重要的人',
  guest: '路过的人',
}

/*
 * 四档六维的起点区间整张由 standard 给（decisions.md :102-109 那张矩阵已锁死）。
 *
 * 原先这里给 owner 单开了一例、只抄 affinity 与 familiarity 两维，
 * 于是 standard 明写着的主人信任 70 在消费端根本没有入口，
 * 六维里也只剩两维拿得到区间——起点只好对所有档共用一个全局值。
 */
export const BOND_TIERS = Object.fromEntries(
  Object.entries(BOND.tiers).map(([tier, band]) => [tier, { ...band, label: TIER_LABELS[tier] ?? tier }]),
)

/*
 * 探针维名单由 standard 给：BOND.probeDimensions = affinity / familiarity / admiration，
 * 与 :104 / :106 / :108 客人列的「前十句…锁」同一条。表里既然列着，本地就不该再抄一份。
 * 锁档之前这几维既没有起点分，也没有回落锚点——没有锚点就不能假装锚在 0。
 */
const PROBE_DIMENSIONS = Array.isArray(BOND.probeDimensions) ? BOND.probeDimensions : []

function isProbeHeld(tier, dimension) {
  return tier === 'guest' && PROBE_DIMENSIONS.includes(dimension)
}

/* 用「档位 + 键名」做种子：同一个人的起点稳定，不会刷新一次换一个数。 */
function seededUnit(seedText) {
  let seed = 2166136261
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  return ((seed >>> 0) % 1000) / 1000
}

/**
 * 某个档位、某个分维的起点：在 standard 给的那一档区间里取一个稳定点。
 *
 * 旧写法是一句三元：`dimension === 'familiarity' ? band.familiarity : band.affinity`——
 * 除了熟悉度，任何维度传进来都落回好感区间，依赖／欣赏／亲密根本没有取值路径。
 * 现在按维度名去表里取，取不到就给 0，不拿别的维度的区间凑数。
 *
 * 种子串的算法一字未动：档案 :100 要求「同一人不变」，改了串就等于给所有老用户重掷起点。
 */
export function startValueOf(tier, seedText = '', dimension = 'affinity') {
  const band = BOND_TIERS[tier] ?? BOND_TIERS.guest
  const range = band?.[dimension]
  if (!Array.isArray(range)) return 0
  /* 探针维在锁档之前不给起点分：前十句还没读完，凭什么站进那个区间。 */
  if (isProbeHeld(tier, dimension)) return 0
  const [min, max] = range
  if (max <= min) return round2(min)
  return round2(min + (max - min) * seededUnit(`${tier}:${seedText}`))
}

/**
 * 各维的回落锚点（C1 :32「主人＝骰定值，客人＝锁档值」）。
 *
 * 客人那三个探针维在前十句读完之前没有锚点，返回 null——
 * 0 在这里是一个都不给的分数，不是一个可以回落回去的位置，两者不能混用。
 * 锚点串与 startValueOf 同一条算法，建档时基线恒等于起点。
 */
export function baselineOf(tier, dimension = 'affinity', seedText = '') {
  if (isProbeHeld(tier, dimension)) return null
  return startFor(tier, seedText, dimension)
}

/* 起点与锚点共用这一条取数路径，免得两处各写一份「好感不加后缀」的特例。 */
function startFor(tier, seedText, dimension) {
  const seed = `${tier}:${seedText}`
  return startValueOf(tier, dimension === 'affinity' ? seed : `${seed}:${dimension}`, dimension)
}

const IMPRESSION_GOOD = ['谢谢', '你好', '请问', '麻烦', '辛苦', '喜欢', '厉害', '可爱', '感谢', '棒', '哈哈']
const IMPRESSION_BAD = ['滚', '闭嘴', '烦死', '傻', '蠢', '讨厌', '别烦我', '垃圾', '无聊']

/**
 * 前十句话定第一印象，返回一个可负的分。
 *
 * 刻度全在表里，本函数不发明数：逐句按词表命中记 ±1、累加后乘 `BOND.probeScale`，
 * 再夹进 `BOND.probeRange.affinity`——standard 给 probeScale 写的注释就是这一句，
 * 上下界 −20/+20 也正是档案 :104 客人列那条锁档区间。
 *
 * 旧写法两头都错：它去读一个 standard 里根本不存在的 `BOND.firstImpression`
 * （真正在位的是 probeScale / probeRange / probeLineLimit / probeTextLimit 这一组），
 * 又把结果 clamp 到从 0 起——带刺的前十句被压成 0，「讨厌」在这一格里等于没发生过。
 * 刻度取不到时返回 null：不猜一套参数顶上，也不静默给个默认分蒙混定档。
 */
export function scoreFirstImpression(lines = []) {
  const scale = Number(BOND.probeScale)
  const range = BOND.probeRange?.affinity
  if (!Number.isFinite(scale) || !Array.isArray(range)) return null
  const sample = (Array.isArray(lines) ? lines : [])
    .filter((line) => typeof line === 'string' && line.trim() !== '' && !isMediaNoteOnly(line))
    .slice(0, Number(BOND.probeLineLimit))
  if (sample.length === 0) return 0
  const textLimit = Number(BOND.probeTextLimit)
  let total = 0
  for (const line of sample) {
    const text = Number.isFinite(textLimit) && textLimit > 0 ? line.trim().slice(0, textLimit) : line.trim()
    const good = IMPRESSION_GOOD.reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0)
    const bad = IMPRESSION_BAD.reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0)
    total += good - bad
  }
  return round2(clamp(total * scale, range[0], range[1]))
}

/**
 * 按已攒下的探针句定一次档：三个探针维同时落分，锚点跟着一起改。
 *
 * 锁档值就是这一维往后的回落基线（C1 :32「客人＝锁档值」），
 * 所以 baseline 必须同步——只改当前值不改锚点，等于让她慢慢掉回建档前的那个数。
 *
 * `probeLineLimit` 是采样上限，不是结算门槛：只说了三句也该能定档。
 * 旧写法在这里加了 `lines.length < probeLineLimit` 这道硬门，攒不满就永远不判。
 * 一句都没有时才不判，原样交回。
 */
export function settleFirstImpression(bond, now = Date.now()) {
  const next = normalizeBond(bond, now)
  if (next.probe.done === true) return { bond: next, settled: false, score: 0 }
  const score = scoreFirstImpression(next.probe.lines)
  if (score === null) {
    /* 表里的刻度没就位：probe 原样留着，等键补齐那天还能正常定档，不假装已经锁过。 */
    return { bond: next, settled: false, score: 0, skipped: 'first-impression-unconfigured' }
  }
  if (next.probe.lines.length === 0) return { bond: next, settled: false, score: 0 }
  for (const dimension of PROBE_DIMENSIONS) {
    const range = BOND.probeRange?.[dimension]
    if (!Array.isArray(range)) continue
    /* 好感可负，熟悉与欣赏的区间下界本来就是 0：同一句 clamp 自然分开，不写两套分支。 */
    const value = round2(clamp(score, range[0], range[1]))
    const bounds = BOND_DIMENSIONS[dimension]
    next[dimension] = value
    next.baseline[dimension] = bounds
      ? clamp(value, bounds.min, bounds.max)
      : value
  }
  next.probe = { lines: [], done: true }
  next.updatedAt = now
  next.log = [...next.log, { at: now, type: 'firstImpression', dim: 'affinity', delta: next.affinity }].slice(-BOND.logLimit)
  return { bond: next, settled: true, score }
}

export function defaultBond(now = Date.now(), tier = 'guest', seedText = '') {
  const starts = {}
  const baseline = {}
  for (const dimension of Object.keys(BOND_DIMENSIONS)) {
    starts[dimension] = startFor(tier, seedText, dimension)
    baseline[dimension] = baselineOf(tier, dimension, seedText)
  }
  return {
    version: BOND_VERSION,
    updatedAt: now,
    /* 认识的第一天。关系阶段要拿它算天数，只写一次，之后不再动。 */
    firstMetAt: now,
    /* 档位落进快照：normalizeBond 补六维、老存档推起点都得读它。 */
    tier,
    ...starts,
    /*
     * 建档即落锚：起点值就是回落基线（C1 :32「主人＝骰定值，客人＝锁档值」）。
     * 信任走的是各档区间里的值，不再对所有档共用那个全局 50（档案 :114 点名的改造项）。
     */
    baseline,
    affinityLocked: false,
    closenessAt: null,
    closenessCount: 0,
    counters: { day: todayOf(now), today: {}, neglect: 0 },
    lastDecayAt: now,
    /* probe：前十条消息的原文。攒满十句定第一次档，之后清空。 */
    probe: { lines: [], done: tier !== 'guest' },
    log: [],
  }
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

/* 每日累计按人格时区切，和开口额度、反思共用同一个「今天」。 */
function todayOf(now) {
  return personaDayKey(now)
}

/* 两位小数：日常一次只该挪 0.02 这种量级，一位小数会被舍成 0。 */
function round2(value) {
  return Math.round(value * RELATION.precision) / RELATION.precision
}

/*
 * 老存档没有 firstMetAt：退到最早一条记录，再退到 updatedAt。
 * 只推导、不写回，等下一次真正写盘时才落成固定日期。
 * log 只留 80 条，所以这个值是「能追到的最早」，不是绝对的第一天。
 */
function resolveFirstMet(raw, log, now) {
  const direct = Number(raw?.firstMetAt)
  if (Number.isFinite(direct) && direct > 0 && direct <= now) return direct
  let earliest = null
  for (const item of log) {
    if (earliest === null || item.at < earliest) earliest = item.at
  }
  if (earliest !== null) return Math.min(earliest, now)
  const updated = Number(raw?.updatedAt)
  if (Number.isFinite(updated) && updated > 0 && updated <= now) return updated
  return now
}

export function normalizeBond(raw, now = Date.now()) {
  const base = defaultBond(now)
  if (raw === null || typeof raw !== 'object') return base
  const counters = raw.counters !== null && typeof raw.counters === 'object' ? raw.counters : {}
  const today = counters.today !== null && typeof counters.today === 'object' ? counters.today : {}
  const log = Array.isArray(raw.log)
    ? raw.log
        .filter((item) => item !== null && typeof item === 'object')
        .map((item) => ({
          at: Number.isFinite(Number(item.at)) ? Number(item.at) : now,
          type: typeof item.type === 'string' ? item.type.slice(0, 32) : 'unknown',
          // 六维全列，且必须留在同一行：check-value-contracts 帧G 的抽取器靠「同一行有 .dim=== 与三元」
          // 收本行字面量当 allowed，再与 RELATION.dimensions 的键集比集合。写成 hasOwnProperty 动态判定
          // 会让抽取器一处都命中不到，帧G 退化成「找不到判定入口，登记待人工确认」——判据丢了载体。
          // 表动则红，这是它该有的样子：漂移由闸守，不由代码结构消。
          dim: item.dim === 'affinity' || item.dim === 'trust' || item.dim === 'familiarity' || item.dim === 'dependence' || item.dim === 'admiration' || item.dim === 'intimacy' ? item.dim : 'affinity',
          delta: Number.isFinite(Number(item.delta)) ? round2(Number(item.delta)) : 0,
        }))
        .slice(-BOND.logLimit)
    : []
  /*
   * 档位先定下来，缺的维度才知道该往哪一档补。
   * 老存档没有 tier 这个键，只有 ownerStartApplied 这个一次性标记——照它认成主人。
   */
  const tier = typeof raw.tier === 'string' && BOND_TIERS[raw.tier]
    ? raw.tier
    : (raw.ownerStartApplied === true ? 'owner' : base.tier)
  const seedText = typeof raw.seedText === 'string' ? raw.seedText : ''
  const values = {}
  for (const [dimension, range] of Object.entries(BOND_DIMENSIONS)) {
    const given = Number(raw[dimension])
    /*
     * 缺哪一维就用它自己那一档的起点补，不从 0 起。
     * 主人一进门就带着依赖与欣赏，拿 0 补齐等于把老主人当路过的人重算。
     */
    const filled = Number.isFinite(given) ? given : startFor(tier, seedText, dimension)
    values[dimension] = clamp(filled, range.min, range.max)
  }
  /*
   * 各维回落锚点。老存档没有这一项：把当前值落成基线，等于这一维不再往下掉。
   * 宁可不动，也不拿一个猜出来的基线抹掉已经攒下来的关系；真正的基线迁移属后续工程。
   * 探针维锁档前是 null：没有锚就不回落，绝不把 null 读成 0 再往 0 拖。
   */
  const rawBaseline = raw.baseline !== null && typeof raw.baseline === 'object' ? raw.baseline : {}
  const baseline = {}
  for (const [dimension, range] of Object.entries(BOND_DIMENSIONS)) {
    if (rawBaseline[dimension] === null) {
      baseline[dimension] = null
      continue
    }
    const given = Number(rawBaseline[dimension])
    baseline[dimension] = Number.isFinite(given)
      ? clamp(given, range.min, range.max)
      : values[dimension]
  }
  /*
   * 上一档。滞回要靠它（档案 :118「退档须跌破门槛 −10」），
   * relationship-stage.mjs:225 的注释早把键名定死成 bond.stageKey，等这边产出来。
   * 非法值一律当没读过，不拿一个猜出来的档位骗自己已经有历史。
   */
  const stageKey = typeof raw.stageKey === 'string' && STAGE_KEYS.has(raw.stageKey) ? raw.stageKey : null

  return {
    version: BOND_VERSION,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
    firstMetAt: resolveFirstMet(raw, log, now),
    tier,
    ...values,
    baseline,
    stageKey,
    affinityLocked: raw.affinityLocked === true,
    /* 主人起步价只补一次；之后就算手动调低，也不会被反复拉回去。 */
    ownerStartApplied: raw.ownerStartApplied === true,
    closenessAt: Number.isFinite(Number(raw.closenessAt)) ? Number(raw.closenessAt) : null,
    closenessCount: Math.max(0, Math.trunc(Number(raw.closenessCount) || 0)),
    counters: {
      day: typeof counters.day === 'string' ? counters.day.slice(0, 10) : base.counters.day,
      today,
      neglect: round2(Math.max(0, Number(counters.neglect) || 0)),
    },
    lastDecayAt: Number.isFinite(Number(raw.lastDecayAt)) ? Number(raw.lastDecayAt) : now,
    /* 老数据没有 probe：视为已完成，不拿旧记录回头重算第一印象。 */
    probe: {
      lines: Array.isArray(raw.probe?.lines)
        ? raw.probe.lines.filter((line) => typeof line === 'string' && line.trim() !== '' && !isMediaNoteOnly(line)).slice(-BOND.probeLineLimit)
        : [],
      done: typeof raw.probe?.done === 'boolean' ? raw.probe.done : true,
    },
    log,
  }
}

/*
 * 合成式按 decisions.md :94：总分 = 好感 + 加成，
 * 加成 = 其余五维加权和 × RELATION.bonusCoefficient，封顶 RELATION.bonusCap。
 *
 * 不用加权平均（:95 明写）：平均式会让负好感被其余五维的正分补回来，
 * 矛盾态的张力就被抹平了——好感掉到 -30 的人不该还被信任 70 抬进「亲近」。
 *
 * 权重、系数、封顶全部从 RELATION 活表取，本文件不写字面数；
 * 依赖 / 欣赏 / 亲密 三维此刻尚未被结算，缺键按 0 计入加成，不猜值。
 */
export function bondLevel(bond) {
  const snapshot = normalizeBond(bond)
  let bonusRaw = 0
  for (const [dim, weight] of Object.entries(RELATION.weights)) {
    if (dim === 'affinity') continue
    const value = Number(snapshot[dim])
    bonusRaw += (Number.isFinite(value) ? value : 0) * weight
  }
  const bonus = Math.min(RELATION.bonusCap, bonusRaw * RELATION.bonusCoefficient)
  const score = snapshot.affinity * RELATION.weights.affinity + bonus
  /* bonus 要一起返出去：判定「五维有没有替负好感翻案」得能单独看这一项，不能只给合起来的分。 */
  return { score: round2(score), bonus: round2(bonus) }
}

/**
 * 关系阶段：把 bond 折算成分，再交给阶段表。
 *
 * 负分不钳 0（C2 去除 scoreFloor）：阶段表里 first_meet 的 scoreMin 是 -Infinity，
 * 负总分自然落在最低一档，「讨厌」由各维独立值进提示词表达。
 * 上限仍钳住 scoreCeil，防止加成把分数推到阶段表之外。
 */
export function relationStageOf(bond, now = Date.now()) {
  const normalized = normalizeBond(bond, now)
  const level = bondLevel(normalized)
  return resolveRelationStage({
    score: Math.min(RELATION.scoreCeil, level.score),
    firstMetAt: normalized.firstMetAt,
    now,
    /*
     * 上一档从快照带进去。relationship-stage.mjs:225 早就按这个契约写的
     * 「prevKey 由调用方从 bond.stageKey 带进来」，这边不传，滞回在主链路上等于没装：
     * 分数在门槛附近抖一下就真降档，档案 :118 那条缓冲带白写。
     */
    prevKey: normalized.stageKey,
  })
}

/*
 * 回落维度集合直接从 RELATION.halfLifeDays 现取键名，表里有几维就回落几维。
 * 原先这里手抄了三个名字（affinity / trust / familiarity），依赖、欣赏、亲密
 * 即使接上事件源也永远回不了落——那份清单比表少三行，且不会有人想起来去补它。
 */
const DECAY_DIMENSIONS = Object.keys(RELATION.halfLifeDays)

/*
 * 自然回落：各维向自己的基线做半衰回归（RELATION.halfLifeDays）。
 * 线性 decayPerDay 已由 C2 废止（decisions.md :121），亲近不再一路掉到 0。
 * 0 不是回落目标：主人本来就在 60，掉到 0 再慢慢爬回来等于反复重置关系。
 *
 * 基线缺失的老存档：把当前值落成基线，等于这一维不再往下掉。
 * 宁可不动，也不拿一个猜出来的基线把老关系抹掉；真正的基线迁移属后续工程。
 */
export function decayBond(bond, now = Date.now()) {
  const next = normalizeBond(bond, now)
  const elapsedMs = now - next.lastDecayAt
  if (!(elapsedMs > 0)) return next
  for (const dim of DECAY_DIMENSIONS) {
    if (dim === 'affinity' && next.affinityLocked === true) continue
    /* 客人探针维锁档前没有锚：Number(null) 会安静变成 0，把这一维一路拖到 0。 */
    if (next.baseline[dim] === null || next.baseline[dim] === undefined) continue
    const baseline = Number(next.baseline[dim])
    const halfLifeDays = Number(RELATION.halfLifeDays[dim])
    if (!Number.isFinite(baseline) || !Number.isFinite(halfLifeDays) || halfLifeDays <= 0) continue
    const kept = Math.pow(0.5, elapsedMs / (halfLifeDays * DAY))
    const range = BOND_DIMENSIONS[dim]
    next[dim] = round2(clamp(baseline + (next[dim] - baseline) * kept, range.min, range.max))
  }
  /* 结算点一律推到现在：锁定期间也推，解锁后不会一次性补扣。 */
  next.lastDecayAt = now
  next.updatedAt = now
  return next
}

/* 设置页手动设定亲近度；不影响信任与熟悉度，也不触发事件记账 */
export function setAffinity(bond, value, now = Date.now()) {
  const next = normalizeBond(bond, now)
  next.affinity = round2(clamp(value, BOND_DIMENSIONS.affinity.min, BOND_DIMENSIONS.affinity.max))
  next.updatedAt = now
  return next
}

/* 设置页加减亲近度；结果仍夹在 -100 ~ 100 */
export function adjustAffinity(bond, delta, now = Date.now()) {
  const next = normalizeBond(bond, now)
  const amount = Number(delta)
  if (!Number.isFinite(amount) || amount === 0) return next
  next.affinity = round2(clamp(next.affinity + amount, BOND_DIMENSIONS.affinity.min, BOND_DIMENSIONS.affinity.max))
  next.updatedAt = now
  return next
}

/* 锁定后自动涨落与衰减都跳过亲近度，手动设定仍然可用 */
export function setAffinityLocked(bond, locked, now = Date.now()) {
  const next = normalizeBond(bond, now)
  next.affinityLocked = locked === true
  next.updatedAt = now
  return next
}

function findRule(rules, type) {
  return rules.find((rule) => rule.id === type) ?? null
}

/* 幅度抖动：同一件事，今天的分量和昨天本来就该有点差别。
   用事件名 + 10 分钟时间片做种子——同一时间片内稳定，不会一刷新就跳。
   输出 0.8 ~ 1.2，±20%；想让某条规则绝对固定就给它加 jitter: false。 */
function jitterOf(rule, now) {
  if (rule.jitter === false) return 1
  const slot = Math.floor(now / (BOND.jitterSlotMinutes * TIME.MINUTE))
  const key = `${rule.id}:${slot}`
  let seed = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    seed ^= key.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  const span = BOND.jitterRange.max - BOND.jitterRange.min
  return BOND.jitterRange.min + (((seed >>> 0) % 1000) / 1000) * span
}

/**
 * 记一次事件。
 *
 * 返回 { bond, applied }，applied 里有实际变化、是否被每日上限截住，
 * 方便设置页和日记解释「今天为什么涨/跌了」。
 */
export function applyBondEvent(bond, event, { rules = DEFAULT_BOND_RULES, now = Date.now(), gainScale = null } = {}) {
  const next = decayBond(bond, now)
  if (event === null || typeof event !== 'object') return { bond: next, applied: null }

  const type = typeof event.type === 'string' ? event.type : ''
  const rule = findRule(rules, type)
  if (rule === null) return { bond: next, applied: null }

  /* 新的一天：重置当日累计；neglect 的总量跨天保留，避免天天刷同一条 */
  const day = todayOf(now)
  if (next.counters.day !== day) {
    next.counters.day = day
    next.counters.today = {}
  }

  const amount = Number(event.amount)
  const rawScale = Number.isFinite(amount) && amount > 0 ? amount : 1
  const scale = Math.min(rawScale, BOND.amountCap)
  let delta = rule.delta * scale * noveltyScale(next, rule, now) * jitterOf(rule, now)

  /* neglect 按天数结算：每天 -0.05，总和封顶 -1.5（约 30 天没联系） */
  if (rule.id === 'neglect') {
    const remaining = Math.max(0, BOND.neglectCap - next.counters.neglect)
    const days = Math.max(1, Math.round(rawScale))
    delta = -Math.min(remaining, days * BOND.neglectPerDay)
    next.counters.neglect = round2(next.counters.neglect + Math.abs(delta))
  }

  /* 性格决定的好感/熟悉涨速：只缩放正向事件，惩罚不因为性子软就变轻。 */
  if (delta > 0 && gainScale !== null && typeof gainScale === 'object') {
    const factor = Number(gainScale[rule.dim])
    if (Number.isFinite(factor) && factor > 0) {
      delta *= Math.min(BOND.gainMax, Math.max(BOND.gainMin, factor))
    }
  }

  /*
   * 当日净额上限（C1 :31）：先把这一笔并进当日该维累计，再把整天截在 cap 内。
   * 逐条 dailyCap 与 dailyCapFactor 那一层已废止——逐条卡会把「十件小事」
   * 压成「一件小事」，人是一整天才算一天。
   * neglect 例外：它按天数结算，自己的累计封顶由 BOND.neglectCap 管。
   */
  const dim = rule.dim
  const before = Number(next.counters.today[rule.id] ?? 0)
  let dimToday = 0
  for (const [id, value] of Object.entries(next.counters.today)) {
    const entryRule = findRule(rules, id)
    if (entryRule?.dim === dim) dimToday += Number(value) || 0
  }
  let allowed = delta
  if (rule.id !== 'neglect') {
    const cap = RELATION.dailyCap[dim]
    const up = Number(cap?.up)
    const down = Number(cap?.down)
    let net = dimToday + delta
    if (Number.isFinite(up)) net = Math.min(net, up)
    if (Number.isFinite(down)) net = Math.max(net, -down)
    allowed = net - dimToday
  }
  if (dim === 'affinity' && next.affinityLocked === true) {
    return {
      bond: next,
      applied: {
        id: rule.id,
        label: rule.label,
        dim,
        delta: 0,
        requested: round2(delta),
        capped: true,
        locked: true,
      },
    }
  }
  const range = BOND_DIMENSIONS[dim]
  const nextValue = clamp(next[dim] + allowed, range.min, range.max)
  const real = round2(nextValue - next[dim])
  next[dim] = round2(nextValue)
  next.counters.today[rule.id] = round2(before + real)
  next.updatedAt = now

  if (rule.id === 'closeness' && real > 0) {
    next.closenessAt = now
    next.closenessCount += 1
  }

  if (real !== 0) {
    next.log = [...next.log, { at: now, type: rule.id, dim, delta: real }].slice(-BOND.logLimit)
  }

  /*
   * 档位写回快照。走到这里 next.stageKey 还是旧档（normalizeBond 原样读出来的），
   * relationStageOf 拿它当 prevKey 判一次，得的就是这一笔之后的新档：
   * 升档看门槛、退档要跌破门槛 −10，都在这一步落定，下一次读档才拿得到上一档。
   *
   * P1-b 断言②（2026-11-24 实施单§2）：粘住期间档位冻结。affinityLocked 是主人
   * 「别让她再算了」的形态——其余维度照常记账（上面的涨落与 log 都真实发生），
   * 唯独 stageKey 不再重算；直到显式解锁（setAffinityLocked false，「交还给她自己算」）
   * 才恢复跟随。此前该锁只护 affinity 单维，五维合分照样把档位推走（证红
   * attached→familiar 在 §8.67），钉的是档，不是整本账。
   *
   * P1-b 刀④ 契约接生产输出（§8.69）：档位写回前过 stage-contract v1 的门。
   * STAGE_CONTRACT_ENFORCE=false（默认）违例只算不拦——门已挂在出口、行为逐字节
   * 等价；翻真那天违例保旧档（回落形态），无效档位永不入库。3.x 模型版从同一个
   * 门进，接线不用再动。
   */
  const STAGE_CONTRACT_ENFORCE = false
  if (next.affinityLocked !== true) {
    const stage = relationStageOf(next, now)
    const verdict = validateStageOutput({
      stageKey: stage.key,
      source: 'auto',
      confidence: 1,
      traceId: `bond:${stage.key}:${now}`,
    })
    if (verdict.ok || STAGE_CONTRACT_ENFORCE !== true) next.stageKey = stage.key
  }

  return {
    bond: next,
    applied: {
      id: rule.id,
      label: rule.label,
      dim,
      delta: real,
      requested: round2(delta),
      capped: round2(delta) !== real,
    },
  }
}

/**
 * 当前心情：只从最近 45 分钟的事件和关系档推出来，给立绘换姿态用。
 * 优先级从「需要被看见」到「日常」：疏远 / 亲近 / 被哄 / 被照顾 / 一起忙 / 平静。
 */
export function bondMood(bond, now = Date.now()) {
  const snapshot = decayBond(bond, now)
  const window = BOND.moodWindowMinutes * TIME.MINUTE
  const recent = new Set(
    snapshot.log.filter((item) => now - item.at >= 0 && now - item.at < window).map((item) => item.type),
  )
  if (recent.has('neglect') || snapshot.affinity <= BOND.moodLowAffinity) return 'serious'
  if (snapshot.closenessAt !== null && now - snapshot.closenessAt < BOND.moodClosenessHours * HOUR) return 'love'
  if (snapshot.affinity >= BOND.moodHighAffinity) return 'love'
  if (recent.has('soothe') || recent.has('closeness')) return 'happy'
  if (recent.has('care') || recent.has('comfort') || recent.has('apologize')) return 'gentle'
  if (recent.has('together')) return 'focused'
  return 'calm'
}

/* 设置页 / 日记用：三个数 + 关系档 + 最近一次贴近 */
export function bondSummary(bond, now = Date.now()) {
  const snapshot = decayBond(bond, now)
  const stage = relationStageOf(snapshot, now)
  return {
    affinity: snapshot.affinity,
    trust: snapshot.trust,
    familiarity: snapshot.familiarity,
    level: stage.key,
    levelLabel: stage.label,
    closenessAt: snapshot.closenessAt,
    closenessCount: snapshot.closenessCount,
    today: snapshot.counters.today,
  }
}

/* 日记：把当天的事件翻译成人话，不暴露公式 */
export function explainToday(bond, now = Date.now()) {
  const snapshot = normalizeBond(bond, now)
  const day = todayOf(now)
  if (snapshot.counters.day !== day) return []
  return Object.entries(snapshot.counters.today)
    .filter(([, value]) => Number(value) !== 0)
    .map(([id, value]) => {
      const rule = findRule(DEFAULT_BOND_RULES, id)
      return {
        id,
        label: rule === null ? id : rule.label,
        delta: round2(Number(value)),
      }
    })
}

/* 便利构造器：让宿主只注入 filePath 就能读写，规则可覆盖 */
export function nextBond(current, event, options = {}) {
  return applyBondEvent(current, event, options).bond
}

/* ------------------------------------------------------------------ *
 * 多对象好感：主人 / 每个私聊的人 / 群里每个发言人各一份。
 * 桌面沿用原来的单一 bond，键固定为 desktop，旧数据不需要迁移。
 * ------------------------------------------------------------------ */

export const PEER_BOND_LIMIT = BOND.peerLimit

/** 一个人在哪儿说话，就对应一把好感键。群里必须带上发言人，否则整个群共用一份好感。 */
export function peerKeyOf(scope, source) {
  if (source?.channel !== 'qq') return 'desktop'
  const chatId = typeof source.openId === 'string' ? source.openId.trim() : ''
  if (source.chatType === 'group') {
    const sender = typeof source.senderOpenId === 'string' ? source.senderOpenId.trim() : ''
    if (chatId === '') return 'qq:group'
    return sender === '' ? `qq:group:${chatId}` : `qq:group:${chatId}#${sender}`
  }
  if (chatId !== '') return `qq:private:${chatId}`
  const fallback = typeof scope === 'string' && scope !== '' ? scope : 'qq:private'
  return fallback
}

/** 取某个键的好感；没有就按这个人的身份给起点，不写回。 */
export function peerBondOf(bonds, key, now = Date.now(), { tier = 'guest' } = {}) {
  const map = bonds !== null && typeof bonds === 'object' ? bonds : {}
  const raw = map[key]
  if (raw === undefined) return defaultBond(now, tier, key)
  return normalizeBond(raw, now)
}

/** 写回某个键；超过上限时丢掉最久没动过的，避免群里人越多文件越大。 */
export function withPeerBond(bonds, key, bond, now = Date.now()) {
  const map = bonds !== null && typeof bonds === 'object' ? { ...bonds } : {}
  map[key] = normalizeBond(bond, now)
  const keys = Object.keys(map)
  if (keys.length > PEER_BOND_LIMIT) {
    keys
      .sort((a, b) => Number(map[a]?.updatedAt ?? 0) - Number(map[b].updatedAt ?? 0))
      .slice(0, keys.length - PEER_BOND_LIMIT)
      .forEach((stale) => delete map[stale])
  }
  return map
}

/** 观察台用：每个人一条摘要，按最近活动排序。 */
export function peerBondSummaries(bonds, now = Date.now()) {
  const map = bonds !== null && typeof bonds === 'object' ? bonds : {}
  return Object.entries(map)
    .map(([key, raw]) => ({ key, ...bondSummary(raw, now), updatedAt: Number(raw?.updatedAt ?? 0) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/* ------------------------------------------------------------------ *
 * 烦躁度：短时情绪，不是关系。攒起来会自己消，不需要每日上限。
 * ------------------------------------------------------------------ */

export const IRRITATION_HALF_LIFE_MS = BOND.irritationHalfLife

/* 余怒比火头缠得久：60 以上按原半衰期，跌破 60 之后半衰期拉长。
   不这么做的话，一次吵架过一夜就归零，第二天提起像没发生过。 */
export const IRRITATION_TAIL_BOUNDARY = BOND.irritationTailBoundary
export const IRRITATION_TAIL_FACTOR = BOND.irritationTailFactor

/*
 * 连续衰减，不是整段跳。
 * 原来用 floor(elapsed / span) 数「过了几个半衰期」，20 分钟内数值一动不动，
 * 第 20 分钟忽然减半；现在按指数走，任何时刻读到的都是当下该有的值。
 */
function decayIrritation(value, elapsed, span) {
  if (elapsed <= 0) return value
  const boundary = IRRITATION_TAIL_BOUNDARY
  const tailSpan = span * IRRITATION_TAIL_FACTOR
  if (value <= boundary) return value * Math.pow(0.5, elapsed / tailSpan)
  const timeToBoundary = span * Math.log2(value / boundary)
  if (elapsed <= timeToBoundary) return value * Math.pow(0.5, elapsed / span)
  return boundary * Math.pow(0.5, (elapsed - timeToBoundary) / tailSpan)
}

/** 按半衰期回落到 0~100 的整数。半衰期由性格参数传入，缺省用旧值。 */
export function irritationOf(state, now = Date.now(), halfLifeMs = IRRITATION_HALF_LIFE_MS) {
  const value = Number(state?.value)
  if (!Number.isFinite(value) || value <= 0) return 0
  const at = Number(state?.at)
  const elapsed = Number.isFinite(at) ? Math.max(0, now - at) : 0
  const span = Number.isFinite(Number(halfLifeMs)) ? Math.max(TIME.MINUTE, Number(halfLifeMs)) : IRRITATION_HALF_LIFE_MS
  const decayed = decayIrritation(Math.min(BOND.irritationMax, value), elapsed, span)
  return Math.round(Math.min(BOND.irritationMax, Math.max(0, decayed)))
}

/* 挨骂之后的头十分钟，安抚只能带走一点点：还在气头上，听不进去。
   过了这段时间，道歉才真的管用。 */
export const IRRITATION_COOLDOWN_MS = BOND.irritationCooldown
export const IRRITATION_RELIEF = BOND.irritationRelief
/* 再怎么道歉，也留一点余温；一句「对不起」不该像按了清零键。 */
export const IRRITATION_FLOOR = BOND.irritationFloor

/**
 * 道歉 / 安慰的即时回温。时间是另一条路，交给 irritationOf。
 * 返回 { state, cooling, relieved }：state 直接写回，另外两个给日记和调试看。
 */
export function easeIrritation(
  state,
  { kind = 'comfort', now = Date.now(), halfLifeMs = IRRITATION_HALF_LIFE_MS } = {},
) {
  const current = irritationOf(state, now, halfLifeMs)
  const at = Number(state?.at)
  const since = Number.isFinite(at) ? Math.max(0, now - at) : Number.POSITIVE_INFINITY
  const cooling = since < IRRITATION_COOLDOWN_MS
  const baseRatio = IRRITATION_RELIEF[kind] ?? IRRITATION_RELIEF.comfort
  const ratio = cooling ? baseRatio * BOND.irritationCooldownScale : baseRatio
  if (current <= IRRITATION_FLOOR) {
    return { state: { value: current, at: now }, cooling, relieved: 0 }
  }
  /* 比例降温，但至少留 IRRITATION_FLOOR，也只能带走现有的量。 */
  const relieved = Math.min(current - IRRITATION_FLOOR, current * ratio)
  return {
    state: { value: Math.round(Math.max(IRRITATION_FLOOR, current - relieved)), at: now },
    cooling,
    relieved: Math.round(relieved),
  }
}

/** 烦躁 +delta；返回新的 { value, at }，值域 0~100。 */
export function bumpIrritation(state, delta, now = Date.now(), halfLifeMs = IRRITATION_HALF_LIFE_MS) {
  const amount = Number(delta)
  const base = irritationOf(state, now, halfLifeMs)
  const next = Number.isFinite(amount) ? base + amount : base
  return { value: Math.round(Math.min(BOND.irritationMax, Math.max(0, next))), at: now }
}
