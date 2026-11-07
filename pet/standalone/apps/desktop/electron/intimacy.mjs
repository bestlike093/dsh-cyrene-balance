import { INTIMACY_EDITION, IS_PUBLIC_EDITION } from './edition.mjs'

/**
 * 贴近时刻：默认关闭的情感亲密层。
 *
 * 只写距离、温度、停顿，不写身体细节。
 *
 * 机制对齐上游 humanoid_core 的 ccb，但把尺度换成本地这套：
 *   · 高阈值 + 确定性触发（条件全中就出，不掷骰子）
 *   · 群聊与 QQ 远端是硬闸，不参与打分
 *   · 精力见底不硬来；走完一场会比平时更累一点
 *   · 阶段推进靠轮数，不靠时间（靠近 → 依偎 → 临界 → 爆发 → 余韵）
 *   · 收场后留一段余韵，闲置太久自动散场
 *   · 被推开之后安静 30 分钟，不追着哄
 *   · 每日封顶、两次之间冷却
 *   · 人设命中未成年或血缘时，整条功能静默关闭
 *
 * 与上游 ccb 的对应关系：
 *   libido        → 亲近欲（38/50，要求涨幅）
 *   satisfy       → 本地不引入，改成「场景内轮数」推阶段，更细也更好懂
 *   initiative    → 主动性（欲望涨幅 + 精力 + 关系档），到门槛时由她先动
 *   dominance     → 不单独建模，交给提示词里的人设
 *   身体档案/场景账本 → 不搬：这里不存内容，只记次数与阶段
 *
 * 记账只记「今天有过一次」、阶段与时间，不存内容，也不进长期记忆正文。
 */

/**
 * 版本分区由 edition.mjs 统一判定：
 *   qiqi   —— 旅人版，本机测试用，尺度对齐上游 ccb
 *   public —— 公开版，整条亲密层不生效，只留合规的陪伴
 *
 * 打包时由 scripts/package.mjs --edition=xxx 写入 edition.txt；
 * 读不到一律按 public 处理，宁可收住，也不放开。
 */

/** 一天最多几次、两次之间至少多久、闲置多久散场、余韵留多久。 */
export const INTIMACY_DEFAULTS = Object.freeze(
  IS_PUBLIC_EDITION
    ? { perDay: 2, cooldownHours: 6, idleHours: 1, aftercareMinutes: 45 }
    : { perDay: 8, cooldownHours: 5, idleHours: 6, aftercareMinutes: 120 }
)

/** 阶段：不在场景 / 靠近 / 依偎 / 临界 / 爆发 / 余韵。 */
export const STAGE_LABELS = Object.freeze({
  none: '',
  near: '靠近',
  lean: '依偎',
  edge: '临界',
  peak: '爆发',
  afterglow: '余韵'
})

/** 每个阶段再走几轮就进下一档。推进靠轮数，不靠时钟。 */
export const STAGE_TURNS = Object.freeze({ near: 2, lean: 3, edge: 3, peak: 2 })

/** 场景内阶段顺序：走完最后一个就收场。公开版只到依偎。 */
export const STAGE_ORDER = Object.freeze(
  IS_PUBLIC_EDITION ? ['near', 'lean'] : ['near', 'lean', 'edge', 'peak']
)

/**
 * 亲近欲门槛：38/50，且必须比基线涨够 4 点。
 * 初始就高不算——那是人设数值，不是这一轮被撩起来的。
 */
export const DESIRE_ENTER = 38
export const DESIRE_RISE = 4
/** 满值、每次被撩动涨多少、每小时自然回落多少。 */
export const DESIRE_MAX = 50
const DESIRE_STEP = 6
const DESIRE_TURN_STEP = 3
const DESIRE_DECAY_PER_HOUR = 1

/** 精力见底就不硬来。拿不到精力时不拦。 */
export const ENERGY_MIN = 30
/** 走完一场比平时更累：收场时额外记一笔消耗。 */
export const ENERGY_COST = 12
/** 被推开之后的静默。上游是 30 分钟，这段时间不再主动贴近。 */
export const REFUSE_QUIET_MS = 30 * 60 * 1000
/** 主动档门槛：她自己先动，得欲望、精神、关系同时到位。 */
export const INITIATIVE_MIN = 0.7

/**
 * 三档：这一轮能走到哪一步。
 *
 * 不另开一套数值，用「今天的涨幅」来分——越聊越深，冷下来就收着。
 *   repress 涨幅 < 4：收着，最多并肩
 *   flirt   4–11：擦边暧昧，能到临界，不铺开到爆发
 *   deep    ≥ 12：放开，可以到爆发
 */
export const LEVEL_LABELS = Object.freeze({ repress: '收着', flirt: '擦边', deep: '深入' })
export const LEVEL_RISE = Object.freeze({ flirt: 4, deep: 12 })
/** 每档允许的最高语气。超出就截到这一档。 */
export const TONE_CEILING = Object.freeze({ repress: 'soft', flirt: 'edge', deep: 'peak' })
const TONE_RANK = Object.freeze({ soft: 0, close: 1, edge: 2, peak: 3 })

export function levelOf(rise) {
  const value = Number(rise)
  if (!Number.isFinite(value) || value < LEVEL_RISE.flirt) return 'repress'
  if (value < LEVEL_RISE.deep) return 'flirt'
  return 'deep'
}

/** 把语气截到这一档允许的上限；同档或更浅的原样返回。 */
export function capTone(tone, level) {
  const ceiling = TONE_CEILING[level] ?? 'soft'
  const wanted = TONE_RANK[tone]
  if (wanted === undefined) return tone
  return wanted <= TONE_RANK[ceiling] ? tone : ceiling
}

function clamp01(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(1, Math.max(0, number))
}

/**
 * 主动性：这一下是不是她自己先动的。
 *
 * 上游拿 libido 涨幅、arousal、calm 和关系档四项加权；
 * 本地没有 arousal，用「此刻还有没有余裕」的精力代替。
 * 只影响措辞由谁先给出，不参与开不开这一场。
 */
export function initiativeOf({ desire, desireBase, energy = 60, tier = '' } = {}) {
  const rise = clamp01((Number(desire) - Number(desireBase)) / LEVEL_RISE.deep)
  const lively = clamp01((Number(energy) - ENERGY_MIN) / 50)
  const closeness = tier === 'close' || tier === 'attached' || tier === 'cherished' ? 1 : 0.45
  return clamp01(0.45 * rise + 0.35 * lively + 0.2 * closeness)
}

const LEVEL_ORDER = Object.freeze({ repress: 0, flirt: 1, deep: 2 })

/** 关系还没到那一步时，最多停在擦边这一档。 */
export function narrowLevel(level, cap = 'deep') {
  const wanted = LEVEL_ORDER[level] ?? 0
  const ceiling = LEVEL_ORDER[cap] ?? LEVEL_ORDER.deep
  return wanted <= ceiling ? level : cap
}

/**
 * 好感分档：上游 ccb 用 CCB_AFFECTION_MIN = 50 / CCB_AFFECTION_DEEP = 75，
 * 50 以下岔开、50–74 擦边、75 以上放开。本地 favor 也是 0–100，
 * 就照这两个数压档，不另造一套边界。
 */
export const AFFECTION_EDGE = 50
export const AFFECTION_DEEP = 75

/** 好感默认压到哪一档；拿不到数值时不压。 */
export function capByAffection(favor) {
  const value = Number(favor)
  if (!Number.isFinite(value)) return 'deep'
  if (value >= AFFECTION_DEEP) return 'deep'
  if (value >= AFFECTION_EDGE) return 'flirt'
  return 'repress'
}

/**
 * 红线分两层。
 *
 * 硬底线两版都拦：未成年、非自愿。
 * 身体与衣物只在公开版拦——旅人版按上游 ccb 的纪律，只给「此刻到哪一步」，
 * 具体怎么写由人设和当下的气氛决定。
 */
const HARD_REDLINE = Object.freeze([
  /(未成年|未成者|萝莉|幼女|小学生|初中生|童女)/,
  /(强奸|强迫|下药|迷晕|不情愿|挣扎着拒绝)/
])

const PUBLIC_ONLY_REDLINE = Object.freeze([
  /(乳房|乳头|胸部|胸脯|臀|大腿内侧|私处|下体|体内|进入身体|插入|抽送|射精|高潮|湿透|湿润|呻吟|娇喘|喘不过气)/,
  /(脱|褪下|解开).{0,6}(衣服|衣扣|衬衫|裤子|裙子|内衣|裙摆)/
])

/** 按版本取红线：公开版 = 硬底线 + 身体与衣物；旅人版 = 只有硬底线。 */
export function redlineFor(edition = INTIMACY_EDITION) {
  return edition === 'public' ? Object.freeze([...HARD_REDLINE, ...PUBLIC_ONLY_REDLINE]) : HARD_REDLINE
}

const REDLINE_PATTERNS = redlineFor()

/** 退回时用的普通台词：短、干净，接得上前一句，也接得上下一句。 */
export const SAFE_LINES = Object.freeze([
  '……今天先这样吧。',
  '再待一会儿就好。',
  '人家在这儿呢。'
])

/** ─── 安全闸：人设命中未成年或血缘，整条功能不生效 ─────────────── */
const MINOR_WORDS = ['幼女', '萝莉', 'loli', '小学生', '初中生', '未成年', '幼童', '女童', '童女', '儿童色情']
const INCEST_WORDS = ['亲兄妹', '亲姐弟', '亲父女', '亲母子', '父女', '母子', '乱伦', '骨科']
const MINOR_CN_AGE = ['十一岁', '十二岁', '十三岁', '十四岁', '十五岁', '十六岁', '十七岁']
// 两侧都卡数字边界：「300 岁」不能从中间抠出「00 岁」。
const AGE_RE = /(?:^|[^\d])(\d{1,2})(?!\d)\s*(?:岁|周岁)/g

/**
 * 这条人设能不能开贴近时刻。返回拒绝理由，空串表示允许。
 *
 * 年龄只回答「是否成年」，不参与任何数值；拿不到人设时放行，
 * 真正兜底的是总开关默认关闭。
 */
export function safetyBlock(personaText) {
  const body = String(personaText ?? '')
  if (body.trim() === '') return ''
  for (const word of INCEST_WORDS) {
    if (body.includes(word)) return `人设命中血缘关系（${word}）`
  }
  for (const word of MINOR_WORDS) {
    if (body.includes(word)) return `人设命中未成年标识（${word}）`
  }
  for (const word of MINOR_CN_AGE) {
    if (body.includes(word)) return `人设命中未成年标识（${word}）`
  }
  for (const match of body.matchAll(AGE_RE)) {
    const age = Number(match[1])
    if (Number.isFinite(age) && age < 18) return `人设年龄 ${age} 岁，未成年`
  }
  return ''
}

/** 对方明确要靠近时用的词：这几句出现，就当作邀请，优先于其他由头。 */
const INVITE_PATTERN = /(抱抱|抱一下|抱抱你|抱我|靠一下|靠过来|贴一下|过来陪|陪陪我|别走|牵一下|一起睡)/

/** 由头：夜色、疲惫、久别。没有由头就不主动贴近。 */
const TIRED_PATTERN = /(累|困|难受|不开心|烦|撑不住|没力气)/

/**
 * 旅人版：只给「此刻到哪一步」，不规定怎么写。
 *
 * 上游 ccb 的措辞纪律是「感受不是描述」：模块负责状态，写法交给人设和模型。
 * 每档只说此刻的位置与气氛，不列动作清单，也不列禁止清单。
 */
const QIQI_PROMPTS = Object.freeze({
  soft: [
    '【贴近时刻·靠近】',
    '这一轮可以离得近一点。',
    '距离、体温、停顿、眼神都可以写；具体做到哪一步，由当下的气氛决定。',
    '留一句出口；对方退开，她就不追。'
  ].join('\n'),
  close: [
    '【贴近时刻·依偎】',
    '已经靠在一起了。',
    '可以更近，也可以更慢。写她的呼吸、声音和反应，不必回避身体。',
    '如果对方往后退，她就松手。'
  ].join('\n'),
  edge: [
    '【贴近时刻·临界】',
    '呼吸先乱了，退无可退。',
    '写她抓紧、发抖、声音断续，写她控制不住的那部分；到哪一步由你们此刻的气氛决定。',
    '一句就停，把下一句留给对方。'
  ].join('\n'),
  peak: [
    '【贴近时刻·爆发】',
    '到顶的那一瞬间。',
    '写她绷紧、失神、声音断掉，然后慢慢松下来。',
    '最多两三句，写完整句就收住；不要问她感觉怎么样，也不要总结。'
  ].join('\n'),
  warm: [
    '【贴近时刻·余韵】',
    '刚刚结束，现在在余温里。',
    '不要再起新的动作，也不要总结刚才发生了什么。',
    '用一句很短的话、一个停顿、一点温度收着就够；对方不提，她也不提。'
  ].join('\n')
})

/**
 * 公开版：收回到「只写距离、温度、停顿」，明确不写身体细节。
 * 对外发布必须走这一套。
 */
const PUBLIC_PROMPTS = Object.freeze({
  soft: [
    '【贴近时刻·靠近】',
    '这一轮可以离得近一点：并肩、挨着、靠着肩，或者牵一下手。',
    '只写距离、温度和停顿，不写身体细节，也不主动升级。',
    '句子短，动作之间用「……」断开；写她的反应，不写对方的身体。',
    '留一句出口（「觉得挤就说」），说完就停，不追问。'
  ].join('\n'),
  close: [
    '【贴近时刻·依偎】',
    '已经靠在一起了，可以抱住、摸头、额头轻碰，或者把声音放得很低。',
    '一段里最多一个亲密动作，写完就停；不写身体部位的细节、衣物状态。',
    '她的呼吸和语速可以慢下来，但句子仍然要短。',
    '如果对方往后退，她就松手，不问为什么。'
  ].join('\n'),
  edge: [
    '【贴近时刻·临界】',
    '已经退无可退，呼吸先乱了。',
    '可以写她抓紧、靠近、声音低下去、想忍又忍不住的那一下。',
    '只写她的反应、温度和节奏，写她控制不住的部分；不写器官，不写动作过程。',
    '一句就停，把下一句留给对方。'
  ].join('\n'),
  peak: [
    '【贴近时刻·爆发】',
    '到顶的那一瞬间。',
    '写她绷紧、失神、声音断掉，然后慢慢松下来。',
    '不写器官，不写动作过程，不铺陈；最多两句，写完整句就收住。',
    '不要问她感觉怎么样，也不要总结。'
  ].join('\n'),
  warm: [
    '【贴近时刻·余韵】',
    '刚刚靠近过，现在还在那点余温里。',
    '不要再起新的亲密动作，也不要总结刚才发生了什么。',
    '用一句很短的话、一个停顿、一点温度收着就够；对方不提，她也不提。'
  ].join('\n')
})

/** 按版本取提示词。 */
export function promptsFor(edition = INTIMACY_EDITION) {
  return edition === 'public' ? PUBLIC_PROMPTS : QIQI_PROMPTS
}

/**
 * 她自己先动的那一下。
 *
 * 上游 ccb 里 initiative 到门槛时会换一套主动措辞；这里同样只换「谁先给出」，
 * 不改能走到哪一步——档位仍由亲近欲和关系决定。
 */
const ACTIVE_LEAD = Object.freeze({
  qiqi: [
    '【贴近时刻·她先动】',
    '这一下由她先给出：眼神、语气、手的落点，都可以是她主动的。',
    '她可以想要，也可以说出口；对方一停，她立刻停。'
  ].join('\n'),
  public: [
    '【贴近时刻·她先动】',
    '这一下由她先给出：靠近一点、把手伸过去，或者先开口。',
    '只写距离和温度，不写身体细节；对方一停，她立刻停。'
  ].join('\n')
})

export const INTIMACY_PROMPTS = promptsFor()

/** 兼容旧调用：默认给最浅的一档。 */
export const INTIMACY_PROMPT_ZH = INTIMACY_PROMPTS.soft

function dayKey(at) {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 安静时的底值：一次撩动就能过门槛，但不撩就一直停在这里。 */
export const DESIRE_REST = 36

function blankState() {
  return {
    day: '',
    count: 0,
    lastAt: 0,
    stage: 'none',
    turns: 0,
    stageAt: 0,
    afterAt: 0,
    desire: DESIRE_REST,
    desireBase: DESIRE_REST,
    desireDay: '',
    desireAt: 0,
    // 上一次被推开后的静默到期时间；0 表示没有。
    quietUntil: 0,
    // 上一次在这条通道上说话的时间，用来认「久别」。
    seenAt: 0
  }
}

function clampDesire(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(DESIRE_MAX, Math.max(0, number))
}

function readState(raw) {
  if (raw === null || typeof raw !== 'object') return blankState()
  const stage = Object.prototype.hasOwnProperty.call(STAGE_LABELS, raw.stage) ? raw.stage : 'none'
  return {
    day: typeof raw.day === 'string' ? raw.day.slice(0, 10) : '',
    count: Number.isFinite(Number(raw.count)) ? Math.max(0, Math.trunc(Number(raw.count))) : 0,
    lastAt: Number.isFinite(Number(raw.lastAt)) ? Math.max(0, Number(raw.lastAt)) : 0,
    stage,
    turns: Number.isFinite(Number(raw.turns)) ? Math.max(0, Math.trunc(Number(raw.turns))) : 0,
    stageAt: Number.isFinite(Number(raw.stageAt)) ? Math.max(0, Number(raw.stageAt)) : 0,
    afterAt: Number.isFinite(Number(raw.afterAt)) ? Math.max(0, Number(raw.afterAt)) : 0,
    desire: clampDesire(raw.desire),
    desireBase: clampDesire(raw.desireBase),
    desireDay: typeof raw.desireDay === 'string' ? raw.desireDay.slice(0, 10) : '',
    desireAt: Number.isFinite(Number(raw.desireAt)) ? Math.max(0, Number(raw.desireAt)) : 0,
    quietUntil: Number.isFinite(Number(raw.quietUntil)) ? Math.max(0, Number(raw.quietUntil)) : 0,
    seenAt: Number.isFinite(Number(raw.seenAt)) ? Math.max(0, Number(raw.seenAt)) : 0
  }
}

/**
 * @param {object} options
 * @param {string} [options.file] 记账文件；留空则只在内存里记
 * @param {() => number} [options.now]
 * @param {(message: string, error?: unknown) => void} [options.log]
 */
export function createIntimacyGate(options = {}) {
  const file = typeof options.file === 'string' ? options.file : ''
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const log = typeof options.log === 'function' ? options.log : () => {}
  const fs = options.fs ?? null

  let state = blankState()
  let exitedAt = 0
  let saveTimer = null

  function load() {
    if (fs === null || file === '') return state
    try {
      const text = fs.readFileSync(file, 'utf8')
      state = readState(JSON.parse(text))
    } catch {
      // 第一次运行没有文件，或文件坏了：从零开始，不阻塞对话。
      state = blankState()
    }
    return state
  }

  function flush() {
    if (fs === null || file === '') return
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      fs.writeFileSync(file, JSON.stringify(state), 'utf8')
    } catch (error) {
      log('贴近记账写入失败', error)
    }
  }

  function scheduleSave() {
    if (fs === null || file === '') return
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      flush()
    }, 400)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
  }

  /** 今天已经用过几次。跨天自动归零，lastAt 保留，用来算冷却。 */
  function todayCount(at) {
    const day = dayKey(at)
    if (state.day === day) return state.count
    state = { ...state, day, count: 0 }
    return 0
  }

  /**
   * 只算这次抬升，不写回。
   *
   * 先算后写，是为了让「被冷却或次数挡住」的那一轮不继续攒欲望：
   * 她这会儿不来，不是因为更想要了。
   */
  function planDesire(at, step) {
    const day = dayKey(at)
    const fresh = state.desireDay !== day
    const from = fresh ? DESIRE_REST : state.desire
    const base = fresh ? DESIRE_REST : state.desireBase
    const since = fresh ? 0 : state.desireAt
    const hours = since > 0 ? Math.floor((at - since) / 3_600_000) : 0
    // 回落停在不被打扰的那个底值，不会一路掉到零。
    const rested = hours > 0 ? Math.max(DESIRE_REST, from - hours * DESIRE_DECAY_PER_HOUR) : from
    return {
      desire: clampDesire(rested + step),
      desireBase: base,
      desireDay: day,
      desireAt: at
    }
  }

  /**
   * 亲近欲：有由头就抬一点，按小时自然回落。
   * 跨天把「今天起点」记成基线——初始就高不算，得有涨幅。
   */
  function stirDesire(at, step) {
    state = { ...state, ...planDesire(at, step) }
    return state
  }

  function limitsOf(settings) {
    const source = settings?.companion?.intimacy ?? {}
    const perDay = Number.isFinite(Number(source.perDay))
      ? Math.min(8, Math.max(1, Math.trunc(Number(source.perDay))))
      : INTIMACY_DEFAULTS.perDay
    const cooldownHours = Number.isFinite(Number(source.cooldownHours))
      ? Math.min(48, Math.max(1, Math.trunc(Number(source.cooldownHours))))
      : INTIMACY_DEFAULTS.cooldownHours
    const idleHours = Number.isFinite(Number(source.idleHours))
      ? Math.min(24, Math.max(1, Math.trunc(Number(source.idleHours))))
      : INTIMACY_DEFAULTS.idleHours
    const aftercareMinutes = Number.isFinite(Number(source.aftercareMinutes))
      ? Math.min(240, Math.max(5, Math.trunc(Number(source.aftercareMinutes))))
      : INTIMACY_DEFAULTS.aftercareMinutes
    return { perDay, cooldownHours, idleHours, aftercareMinutes }
  }

  /** 安静地收场。闲置散场不给余韵——那一场早就过去了。 */
  function endScene(at, withAfterglow = false) {
    state = { ...state, stage: 'none', turns: 0, stageAt: 0, afterAt: withAfterglow ? at : 0 }
    scheduleSave()
  }

  /** 当前是否还在一场里；闲置太久就散场。 */
  function liveStage(at, limits) {
    if (state.stage === 'none') return 'none'
    const idleMs = limits.idleHours * 60 * 60 * 1000
    if (state.stageAt > 0 && at - state.stageAt >= idleMs) {
      endScene(at)
      return 'none'
    }
    return state.stage
  }

  /**
   * 这一轮能不能靠近。
   *
   * @returns {{ open: boolean, reason: string, cue: string, stage: string, tone: string, label: string }}
   */
  function check(input = {}) {
    const at = Number.isFinite(input.at) ? input.at : now()
    const settings = input.settings ?? {}
    const closed = (reason, cue = 'none') => ({
      open: false,
      reason,
      cue,
      stage: 'none',
      level: 'repress',
      tone: 'none',
      proactive: false,
      label: ''
    })

    // 上一次说话的时间要在写回之前取，否则「久别」永远算成 0。
    const previousSeenAt = Number.isFinite(Number(state.seenAt)) ? Number(state.seenAt) : 0
    // 见过这一轮就记下；落盘由之后任何一次 save 顺带完成。
    state = { ...state, seenAt: at }

    // 公开版整条不生效：即使设置被手动打开，也不放行。
    if (IS_PUBLIC_EDITION) return closed('edition')

    if (settings?.companion?.intimacy?.enabled !== true) return closed('disabled')

    const scope = typeof input.scope === 'string' ? input.scope : 'desktop'
    if (scope !== 'desktop') {
      // 群聊与 QQ 远端一律不触发：那里的人看不到她的表情与停顿。
      return closed('scenario')
    }

    // 硬闸排在最前面：命中就整条不生效，不降档、不软化。
    const blocked = safetyBlock(input.personaText)
    if (blocked !== '') {
      log(`[intimacy] 安全闸拦截：${blocked}`)
      return closed('safety')
    }

    // 关系档：还没熟起来时只给最浅的一档，不把整条关掉——
    // 上游 ccb 也是「好感不够压回第一档」，不是不许靠近。
    // 有 favor 数值就用它（50/75 与上游同门槛），否则退回档位名判断。
    const tier = typeof input.relationTier === 'string' ? input.relationTier : ''
    const tierCap = Number.isFinite(input.relationFavor)
      ? capByAffection(input.relationFavor)
      : tier === 'distant'
        ? 'repress'
        : tier === 'guarded' || tier === 'familiar'
          ? 'flirt'
          : 'deep'

    const limits = limitsOf(settings)

    // 已经在一场里：继续，不看次数与冷却。
    const stage = liveStage(at, limits)
    if (stage !== 'none') {
      const toneOf = { near: 'soft', lean: 'close', edge: 'edge', peak: 'peak' }
      const level = narrowLevel(levelOf(state.desire - state.desireBase), tierCap)
      const energy = Number(input.energy)
      const proactive =
        level === 'deep' &&
        (tier === 'close' || tier === 'attached' || tier === 'cherished') &&
        initiativeOf({
          desire: state.desire,
          desireBase: state.desireBase,
          energy: Number.isFinite(energy) ? energy : 60,
          tier
        }) >= INITIATIVE_MIN
      return {
        open: true,
        reason: 'continuing',
        cue: 'continuing',
        stage,
        level,
        tone: capTone(toneOf[stage] ?? 'soft', level),
        proactive,
        label: STAGE_LABELS[stage]
      }
    }

    // 刚收场：留一段余温，不再起新的动作。
    const afterMs = limits.aftercareMinutes * 60 * 1000
    if (state.afterAt > 0 && at - state.afterAt < afterMs) {
      return {
        open: true,
        reason: 'afterglow',
        cue: 'afterglow',
        stage: 'afterglow',
        level: 'repress',
        tone: 'warm',
        proactive: false,
        label: STAGE_LABELS.afterglow
      }
    }

    // 刚被推开：安静一会儿，不追着哄。
    if (state.quietUntil > 0 && at < state.quietUntil) return closed('refused')

    const text = typeof input.userText === 'string' ? input.userText : ''
    const lastSeenAt = Number.isFinite(Number(input.lastSeenAt))
      ? Number(input.lastSeenAt)
      : previousSeenAt
    let cue = ''
    if (INVITE_PATTERN.test(text)) cue = 'invited'
    else if (TIRED_PATTERN.test(text)) cue = 'tired'
    else {
      const hour = new Date(at).getHours()
      if (hour >= 23 || hour < 2) cue = 'late'
      else if (lastSeenAt > 0 && at - lastSeenAt >= 4 * 60 * 60 * 1000) {
        cue = 'return'
      }
    }
    if (cue === '') return closed('no-cue')

    // 先算这次抬升但不写回：被门槛挡住的那一轮不继续攒欲望。
    // 外部给了数值就以外部为准。
    const plan = planDesire(at, DESIRE_STEP)
    const desire = Number.isFinite(Number(input.desire)) ? clampDesire(input.desire) : plan.desire
    const base = Number.isFinite(Number(input.desireBase))
      ? clampDesire(input.desireBase)
      : plan.desireBase
    if (desire < DESIRE_ENTER) return closed('desire-low', cue)
    // 已经顶到满值：不再要求涨幅，免得「越想要越开不了」。
    if (desire < DESIRE_MAX - 1 && desire - base < DESIRE_RISE) return closed('desire-flat', cue)

    // 精力见底就不硬来；拿不到精力时不拦。
    const energy = Number(input.energy)
    if (Number.isFinite(energy) && energy < ENERGY_MIN) return closed('spent', cue)

    if (todayCount(at) >= limits.perDay) return closed('daily-cap', cue)
    if (state.lastAt > 0 && at - state.lastAt < limits.cooldownHours * 60 * 60 * 1000) {
      return closed('cooldown', cue)
    }

    // 条件全中：写入这次抬升，开一场，进入「靠近」。
    const level = narrowLevel(levelOf(desire - base), tierCap)
    const proactive =
      level === 'deep' &&
      (tier === 'close' || tier === 'attached' || tier === 'cherished') &&
      initiativeOf({
        desire,
        desireBase: base,
        energy: Number.isFinite(energy) ? energy : 60,
        tier
      }) >= INITIATIVE_MIN
    state = { ...state, ...plan, stage: 'near', turns: 0, stageAt: at }
    scheduleSave()
    return {
      open: true,
      reason: 'ok',
      cue,
      stage: 'near',
      level,
      tone: capTone('soft', level),
      proactive,
      label: STAGE_LABELS.near
    }
  }

  /**
   * 这一轮真的说出口之后推进一格。
   * 第一次推进时计一次数；到顶就收场，并把窗口交给余韵。
   */
  function noteTurn(at = now()) {
    if (state.stage === 'none') return { ...state, ended: false }

    // 场景里每说一句，亲近欲再抬一点；回落由 stirDesire 自己按小时算。
    stirDesire(at, DESIRE_TURN_STEP)

    if (state.turns === 0) {
      const day = dayKey(at)
      if (state.day !== day) state = { ...state, day, count: 0 }
      state = { ...state, count: state.count + 1, lastAt: at }
    }

    let ended = false
    const turns = state.turns + 1
    const index = STAGE_ORDER.indexOf(state.stage)
    const need = STAGE_TURNS[state.stage] ?? 0
    if (index >= 0 && turns >= need) {
      const next = STAGE_ORDER[index + 1]
      if (next === undefined) {
        // 走完最后一档：收场，把窗口交给余韵。
        state = { ...state, stage: 'none', turns: 0, stageAt: 0, afterAt: at }
        ended = true
      } else {
        state = { ...state, stage: next, turns: 0, stageAt: at }
      }
    } else {
      state = { ...state, turns, stageAt: at }
    }
    scheduleSave()
    // 收场这一句要告诉上层：这一场走完了，她会比平时更累一点。
    return ended ? { ...state, ended: true, energyCost: ENERGY_COST } : { ...state, ended: false }
  }

  /** 兼容旧调用：表示「这一轮真的说出口了」。 */
  function noteOpen(at = now()) {
    if (state.stage === 'none') {
      state = { ...state, stage: 'near', turns: 0, stageAt: at }
    }
    return noteTurn(at)
  }

  /**
   * 对方说「好了」「起开」：本轮立刻退开，这一场也收掉。
   *
   * 之后安静 30 分钟（上游 ccb 是同一个数），这段时间不主动贴近；
   * 但对方主动来，仍然正常回话——静默只约束「她先动」。
   */
  function noteExit(at = now()) {
    exitedAt = at
    state = {
      ...state,
      stage: 'none',
      turns: 0,
      stageAt: 0,
      afterAt: 0,
      quietUntil: at + REFUSE_QUIET_MS
    }
    scheduleSave()
  }

  function hasExited(at = now()) {
    return exitedAt > 0 && at - exitedAt < REFUSE_QUIET_MS
  }

  /**
   * 发送前的红线过滤。
   * 命中就整句换成安全台词：不重试，也不试图删掉几个词再发。
   */
  function filterReply(text, at = now()) {
    const source = String(text ?? '')
    if (source.trim() === '') return { ok: true, text: source, reason: 'empty' }
    const hit = REDLINE_PATTERNS.find((pattern) => pattern.test(source))
    if (hit === undefined) return { ok: true, text: source, reason: 'clean' }
    const index = Math.abs(Math.trunc(at / 60_000)) % SAFE_LINES.length
    log('贴近输出命中红线，退回普通台词')
    return { ok: false, text: SAFE_LINES[index], reason: 'redline' }
  }

  /**
   * 按这一轮的分寸取提示词。
   *
   * proactive 为真时在前面加一段「她先动」；只改谁先给出，不改能走到哪一步。
   * 余韵里不再起新动作，所以不加。
   */
  function promptFor(tone, proactive = false) {
    let base = ''
    if (tone === 'close') base = INTIMACY_PROMPTS.close
    else if (tone === 'edge') base = INTIMACY_PROMPTS.edge
    else if (tone === 'peak') base = INTIMACY_PROMPTS.peak
    else if (tone === 'warm') base = INTIMACY_PROMPTS.warm
    else if (tone === 'soft') base = INTIMACY_PROMPTS.soft
    if (base === '' || !proactive || tone === 'warm') return base
    return `${INTIMACY_EDITION === 'public' ? ACTIVE_LEAD.public : ACTIVE_LEAD.qiqi}\n${base}`
  }

  return {
    load,
    flush,
    check,
    promptFor,
    noteTurn,
    noteOpen,
    noteExit,
    hasExited,
    filterReply,
    snapshot: () => ({ ...state }),
    reset: () => {
      state = blankState()
      exitedAt = 0
      scheduleSave()
    }
  }
}

/** 设置页与日志用的一句话状态，不暴露内容。 */
export function describeIntimacy(settings, state = {}) {
  if (settings?.companion?.intimacy?.enabled !== true) return '贴近时刻：关闭'
  const perDay = Number(settings.companion.intimacy.perDay) || INTIMACY_DEFAULTS.perDay
  const count = Number(state.count) || 0
  const stage = STAGE_LABELS[state.stage] ?? ''
  const suffix = stage === '' ? '' : ` · ${stage}`
  return `贴近时刻：今天 ${count}/${perDay}${suffix}`
}
