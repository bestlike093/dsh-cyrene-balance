/**
 * 陪伴系统的统一标准。
 *
 * 这里只放「跨模块必须一致」的量：时间单位、记忆容量、衰减半衰期、
 * 情绪回落、关系权重、事件上限、提示词预算。
 *
 * 规则：
 * - 各模块从这里取基准值，不再各写一份魔法数字；
 * - 模块可以按自身语义做确定性微调，但必须在自己的文件里写明
 *   「标准值 × 本模块系数 = 实际值」，且系数是常量，不随输入漂移；
 * - 纯常量，不读设置、不碰文件、不依赖时间。
 *
 * 改动这里等于改整只桌宠的节奏，改完必须跑全量回归。
 */

export const STANDARD_VERSION = 2

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const TIME = Object.freeze({
  SECOND,
  MINUTE,
  HOUR,
  DAY,
})

/* ============================== 人格速度 ============================== */

/*
 * 灵敏度只乘事件权重，不改结构。
 * 低档是「慢一点」，高档是「更容易留下痕迹」，不是开关。
 */
export const SENSITIVITY = Object.freeze({
  low: 0.65,
  normal: 1,
  high: 1.4,
})

/*
 * 人格推导的公共刻度。
 * 各模块可以按语义取其中一项做确定性组合，但不能另写一套幅度。
 */
export const TRAITS = Object.freeze({
  /* 单维最多推 45%，给互相矛盾的人格描述留余地。 */
  gainBound: 0.45,
  /* 人格词命中 3 个就封顶，防止复读机把权重刷满。 */
  cueSaturation: 3,
  /* 烦躁增量：1.7 - 忍受度/100，再夹在 0.5..1.6。 */
  irritationBase: 1.7,
  irritationFactorMin: 0.5,
  irritationFactorMax: 1.6,
  /* 念旧投影：死区 0.15，死区外铺满 0.85，再收进 ±1/6。 */
  recallDeadZone: 0.15,
  recallSpan: 0.85,
  recallProjection: 6,
  /*
   * 人格问卷的换算刻度：维度分以 50 为中点映射到速度参数，
   * 各系数只决定「偏一档推多远」，不另立上下限。
   */
  assessment: Object.freeze({
    scoreMidpoint: 50,
    scoreSpan: 100,
    decimalPrecision: 100,
    warmthToleranceSpan: 18,
    reactivityToleranceSpan: 22,
    reactivityHalfLifeSpan: 0.7,
    vitalityDrainSpan: 0.35,
    attachmentAffinitySpan: 0.32,
    warmthAffinitySpan: 0.18,
    attachmentFamiliaritySpan: 0.35,
    opennessSpan: 0.5,
    boundaryOpennessSpan: 0.28,
    boundaryIntimacySpan: 18,
    warmthIntimacySpan: 10,
    draftHigh: 62,
    draftLow: 38,
    changeNoise: 8,
    uniformWarnMin: 8,
  }),
})

/* ============================== 主动开口 ============================== */

/*
 * 开口节奏的基准刻度。
 *
 * 间隔先按人格 scale 推出分钟数，再夹进 45~150；额度在 3~5 之间连续。
 * 抖动只作用于最终门槛，不改变人格方向的排序。
 */
export const OPENING = Object.freeze({
  minGapMinutes: 90,
  gapMinMinutes: 45,
  gapMaxMinutes: 150,
  gapScaleExponent: 1.2,
  scaleMin: 0.5,
  scaleMax: 1.8,
  quotaMin: 3,
  quotaMax: 5,
  quotaAnchorScale: 0.7,
  quotaAnchorSpan: 0.6,
  quotaRange: 2,
  jitter: 0.15,
  unansweredLimit: 3,
  silenceDays: 3,
  cueSharpness: 3,
  cueFloorRatio: 0.08,
  cueMinWeight: 0.01,
  /* 记忆回访的准入门槛：0.6 只剩最近反复提过的旧事，放到 0.35 让「久但重要」的也能回来。 */
  memoryMinWeight: 0.35,
  memoryPoolLimit: 3,
  cueBaseWeight: Object.freeze({
    schedule: 1,
    unfinished: 0.9,
    reunion: 0.85,
    memory: 0.7,
  }),
  /*
   * 情绪只调整同类由头的抽签分量，不改「有没有由头」。
   * 低落时少提日程、多留记忆；兴奋时反过来。情绪缺省按 neutral 处理。
   */
  cueEmotionBias: Object.freeze({
    neutral: Object.freeze({}),
    happy: Object.freeze({ schedule: 1.08, unfinished: 1.06, reunion: 1, memory: 1 }),
    excited: Object.freeze({ schedule: 1.12, unfinished: 1.08, reunion: 1, memory: 0.95 }),
    shy: Object.freeze({ schedule: 0.95, unfinished: 1, reunion: 1.04, memory: 1.04 }),
    sad: Object.freeze({ schedule: 0.55, unfinished: 0.85, reunion: 1.15, memory: 1.1 }),
    angry: Object.freeze({ schedule: 0.4, unfinished: 0.7, reunion: 0.9, memory: 1 }),
    tired: Object.freeze({ schedule: 0.5, unfinished: 0.7, reunion: 1, memory: 1.1 }),
    surprised: Object.freeze({ schedule: 1, unfinished: 1.08, reunion: 1.04, memory: 1 }),
    thinking: Object.freeze({ schedule: 1.02, unfinished: 1.08, reunion: 0.96, memory: 1.04 }),
    restless: Object.freeze({ schedule: 0.7, unfinished: 0.85, reunion: 1.05, memory: 1.05 }),
  }),
  ledgerEntries: 60,
  ledgerKeyLimit: 120,
  memoryUsedDays: 1,
})

/* ============================== 记忆 ============================== */

export const MEMORY = Object.freeze({
  /* 单条正文上限。写入时截断，读取时不再重复截。 */
  textLimit: 400,
  /* id / 作用域 / 发言人这类键的正文上限；随机后缀只用于生成不可读 id。 */
  idTextLimit: 64,
  idRandomLength: 8,
  evidenceTextLimit: 160,
  scoreDecimals: 4,
  mentionMin: 1,
  recallMinLimit: 1,

  /* 每个桶的容量：主人 / 每个私聊对象 / 每个群。 */
  ownerItems: 400,
  privateItems: 200,
  groupItems: 600,
  totalItems: 3_000,

  /* 清理：低于 minWeight 且超过 keepDays 的未固定条目会被清掉。 */
  keepDays: 180,
  minWeight: 0.2,

  /* 召回衰减：标准半衰期，人格的念旧/向前只做 ±1/6 的确定性投影。 */
  recallHalfLifeDays: 30,
  recallMinScore: 0.18,
  recallLimit: 5,

  /*
   * 召回排序的细调：提及次数、时间衰减与词面重合各占多少。
   * 这些值只决定「同一条记忆排多前」，不改变条目本身；模块可以按语义
   * 用这里的基准做确定性组合，但不能另写一套。
   */
  recallRanking: Object.freeze({
    mentionSaturation: 3,
    mentionWeight: 0.55,
    recencyWeight: 0.45,
    overlapWeight: 0.75,
    weightWeight: 0.25,
    gramMinLength: 2,
    /* 整句命中至少两个字才算真正相关，单字只走片段匹配。 */
    wholeQueryMinLength: 2,
    digestMinRaw: 10,
    /* 每人窗口：远端把 3 句 × 30 字抬到 6 句 × 60 字，与本地 4 × 40 同向；
       合并取远端那一档，两处共用这一个来源。 */
    digestRecent: 6,
    digestTextLimit: 60,
    /* 群摘要是一条压缩记录，允许比普通记忆更长；仍受总预算约束。 */
    digestTotalLimit: 800,
    digestPeerLimit: 6,
  }),

  /* 注入预算：条数、单条长度、结构化事实条数、事实摘要条数。 */
  promptLimit: 8,
  promptTextLimit: 200,
  factsLimit: 6,
  factDigestLimit: 4,
  /* 每轮注入总预算：单项都合规时，仍要有一条总闸，防止 11 段叠满。 */
  promptTurnCharBudget: 2_400,

  /*
   * 召回意图的预算投影：意图表给基准条数，这一层只负责把它压回可注入的区间。
   * 缩放与上下限放在标准里，模块可以按语义调基准，但不能各自另定一套上限。
   */
  recallPlan: Object.freeze({
    memoryScale: 0.35,
    factScale: 0.5,
    /* 人格轴灵敏度不能把召回压到零；再低也至少留一条。 */
    sensitivityMin: 0.2,
    countFloor: 1,
    memoryMin: 3,
    memoryMax: 12,
    factMin: 2,
    factMax: 8,
  }),

  /* 结构化事实：单条正文、库容量、久不提归档天数。 */
  factTextLimit: 160,
  scopeTextLimit: 120,
  sourceTextLimit: 80,
  factStoreLimit: 200,
  factArchiveDays: 45,
  saveDebounceMs: 800,
  strengthMin: 0,
  strengthMax: 3,
  defaultStrength: 1,
  /* 没给置信度就按「未确认」处理：0.45 低于 minReadyConfidence，先放进 unsure 池。 */
  defaultConfidence: 0.45,
  confidenceMin: 0,
  confidenceMax: 1,
  logExcerptLimit: 40,
  /* 纠正类事实总要先露头；一轮最多记下多少条已展示事实，供改口时回退。 */
  recentLessonLimit: 3,
  surfacedLimit: 12,

  /* 候选箱：待审计数上限，超过多少天未审转 rejected。 */
  candidateLimit: 120,
  candidateKeepDays: 7,
  candidateKeepDaysMin: 1,
  candidateConfidence: 0.6,

  /* 记忆台一次最多返回多少条；超过上限按上限截，统计仍按全集。 */
  console: Object.freeze({
    minLimit: 1,
    defaultLimit: 200,
    maxLimit: 2_000,
  }),

  /* 向量探针缓存与请求超时窗口。 */
  embedding: Object.freeze({
    probeTtlMs: 5 * MINUTE,
    defaultTimeoutMs: Math.round(1.5 * SECOND),
    timeoutMinMs: SECOND,
    timeoutMaxMs: 30 * SECOND,
  }),

  /* 分数保留四位小数，展示和比较用同一精度。 */
  scorePrecision: 10_000,

  /* 提及多少次才在注入行前标「常常想起」。 */
  mentionPrefixThreshold: 3,

  /*
   * 注入排序权重。分数是各项相加，越大越靠前：
   * pinned 是硬门槛；相关度决定「这句话在说什么」；
   * 置信度决定「这条记忆有多可靠」；槽权重决定「这类事有多重要」；
   * 提及次数和时间只做同分时的细调。
   */
  ranking: Object.freeze({
    pinned: 1_000,
    /* 当前句只要有一个实词命中，就该压过「最近常提但不相干」的旧事。 */
    relevance: 160,
    confidence: 60,
    slot: 24,
    mentions: 12,
    mentionsCap: 20,
    recency: 30,
    recencyWindowDays: 30,
    /* 时间只分三档：一天内、一周内、窗口内更早；分值放在标准里，排序模块不再写死。 */
    recencyBuckets: Object.freeze([
      Object.freeze({ withinDays: 1, score: 1 }),
      Object.freeze({ withinDays: 7, score: 0.7 }),
    ]),
    recencyFallback: 0.4,
    coldPenalty: 40,
    /* 结构化事实的合并、衰减与召回细调；各系数在模块内按语义直接取用。 */
    facts: Object.freeze({
      mergeThreshold: 0.55,
      supersedesThreshold: 0.5,
      reinforceStep: 0.6,
      dailyDecay: 0.02,
      lowConfidenceDailyDecay: 0.05,
      lowConfidenceThreshold: 0.5,
      lowConfidenceArchiveDays: 30,
      lowConfidenceArchiveStrength: 0.35,
      archiveStrength: 0.3,
      strengthWeight: 2,
      recencyBase: 1.5,
      recencyWindowDays: 30,
      relevanceWeight: 2.4,
      /* 两三个字的短 query 只有一两个 bigram，命中一个就接近满分；按固定系数降权。 */
      shortQueryLength: 3,
      shortQueryScale: 0.35,
      accessedBonus: 0.2,
      /* 召回加分在两周内线性退回 0，避免被召回过一次就永久抬高。 */
      accessedWindowDays: 14,
      doubtPenalty: 0.6,
      defaultSlotWeight: 0.3,
      minReadyConfidence: 0.5,
      oversampleFactor: 2,
      unsureLimit: 2,
      echoLimit: 3,
      denialWindowMinutes: 30,
      denialStrengthStep: 0.2,
    }),
  }),

  /* 本地 BM25 检索：参数、混合权重与时间衰减下限。 */
  search: Object.freeze({
    k1: 1.2,
    b: 0.75,
    /* BM25 的平滑项与空文档平均长度兜底，属于算法口径，不散落在检索模块里。 */
    idfOffset: 0.5,
    emptyAverageLength: 1,
    minScore: 0.01,
    vectorWeight: 0.6,
    recencyFloor: 0.6,
    reinforcementStep: 0.12,
    reinforcementCap: 0.3,
    pinBoost: 1.2,
  }),

  /* 冷记忆：超过这个天数没被提起，注入时加「很久没提起了」。 */
  coldAfterDays: 60,

  /* 主人记忆台的两种视图。all 只对主人开放。 */
  viewModes: Object.freeze(['owner', 'all']),
  defaultViewMode: 'owner',

  /*
   * 受控互通。默认两边都不通：主人想看，必须自己在记忆台里打开；
   * 群聊与私聊各自成桶，群聊再多也不会自动带上主人桶。
   */
  bridge: Object.freeze({
    ownerPrivate: false,
    ownerGroup: false,
  }),

  /*
   * 记忆读取三档：主人 / 私聊访客 / 群聊。
   * items 是一档一次能拿到的上限；私聊访客按熟悉度分层，越熟越能翻到旧事。
   * 群聊读不到私聊与主人桶，这条不受 bridge 开关影响。
   */
  access: Object.freeze({
    owner: Object.freeze({ items: 12, depth: 'all' }),
    peer: Object.freeze({
      items: 8,
      depth: 'own',
      bands: Object.freeze([
        Object.freeze({ minFamiliarity: 50, items: 8 }),
        Object.freeze({ minFamiliarity: 20, items: 5 }),
        Object.freeze({ minFamiliarity: 0, items: 3 }),
      ]),
    }),
    group: Object.freeze({ items: 3, depth: 'group' }),
  }),

  /* 物理分区：每个作用域一个独立文件，文件名不可互相推导。 */
  partition: Object.freeze({
    dir: 'memory-vault',
    owner: 'owner',
    privatePrefix: 'private-',
    groupPrefix: 'group-',
  }),
})

/* ============================== 身体 ============================== */

export const BODY = Object.freeze({
  /* 新存档的起点；只影响「第一次见到她」时的体力，不影响之后结算。 */
  defaultEnergy: 78,
  maxSleepDebt: 48,

  /*
   * 精力四档。上限是这一档的闭区间上界，按顺序取第一档。
   * 快照、排练、主动闸都读这一张表，别在别处再写 20/45/75。
   */
  bands: Object.freeze([
    Object.freeze({ key: 'spent', max: 20, label: '见底', phrase: '几乎撑不住了' }),
    Object.freeze({ key: 'tired', max: 45, label: '有点累', phrase: '说话会慢一点' }),
    Object.freeze({ key: 'okay', max: 75, label: '还撑得住', phrase: '平常状态' }),
    Object.freeze({ key: 'fresh', max: Infinity, label: '有精神', phrase: '话会比平时多' }),
  ]),

  /* 主动开口的体力门槛：累了就少说，欠觉多了也一样。 */
  needsRestEnergy: 35,
  needsRestSleepDebt: 8,

  /* 醒着每小时掉多少精力；人格的 energyDrainScale 只在这个区间内做确定性投影。 */
  energyDrain: Object.freeze({
    minPerHour: 1.5,
    maxPerHour: 9,
    defaultPerHour: 4,
  }),

  /*
   * 身体状态的起点与每小时变化率。
   * 睡眠恢复比醒着消耗快，这是身体层的固定口径；各模块只能乘固定系数，
   * 不能在自己的文件里另写 12 / 20 / 2.5 这类魔法数字。
   */
  init: Object.freeze({
    drowsiness: 20,
    hunger: 25,
    socialEnergy: 70,
    discomfort: 10,
  }),
  rates: Object.freeze({
    awake: Object.freeze({
      drowsinessPerHour: 5,
      hungerPerHour: 6,
      socialPerHour: 3,
      discomfortPerHour: 2,
    }),
    asleep: Object.freeze({
      energyPerHour: 12,
      drowsinessPerHour: -20,
      hungerPerHour: 2.5,
      socialPerHour: 6,
      discomfortPerHour: -6,
      sleepDebtPerHour: 0.7,
    }),
    sleepDebt: Object.freeze({
      awakePerHour: 0.12,
      latePerHour: 0.35,
      lateAfterHours: 16,
    }),
  }),

  /* 结算窗口与单次动作的基准量。 */
  catchupHours: 72,
  stepMinutes: 30,
  justWokeMinutes: 90,
  eatAmount: 55,
  chatCost: 2,
  chatCostMax: 4,
  chatCooldownSeconds: 45,
  dreamTextLimit: 80,
  statsPrecision: 10,

  /* 生理周期：默认关闭；长度只在这段区间内承认。 */
  cycleLength: 28,
  cycleLengthMin: 21,
  cycleLengthMax: 40,
  cyclePhases: Object.freeze({ menstrualEnd: 5, follicularEnd: 13, ovulationEnd: 16 }),

  /* 体感描述的分档；只决定哪一句该露头，不改变状态。 */
  describe: Object.freeze({
    drowsinessHigh: 70,
    drowsinessMid: 45,
    freshDrowsiness: 25,
    energyLow: 25,
    energyTired: 45,
    hungerHigh: 75,
    hungerMid: 55,
    socialLow: 25,
    socialMid: 45,
    sleepDebtHigh: 6,
    sleepDebtMid: 3,
    discomfortHigh: 65,
    maxLines: 3,
  }),

  /* 硬指标：给主动闸和系统降载用，不进提示词。 */
  flags: Object.freeze({
    lowEnergy: 35,
    sleepy: 65,
    hungry: 70,
    drained: 30,
    exhaustedEnergy: 20,
    exhaustedSleepDebt: 8,
  }),
})

/* ============================== 情绪 ============================== */

export const EMOTION = Object.freeze({
  /* 本地规则识别的有效期；它只给一句即时判断，余波另有半衰期。 */
  localTtlSeconds: 30,

  afterglow: Object.freeze({
    halfLifeMinutes: 30,
    minHalfLifeMinutes: 1,
    maxHalfLifeMinutes: 720,
    /* 一次刺激把读数拉向目标的比例，以及归零的静默阈值。 */
    impulseWeight: 0.35,
    epsilon: 0.01,
    /* 余波读数低于这组阈值就回到 neutral。 */
    neutralValence: 0.08,
    neutralArousal: 0.12,
    positiveValence: 0.25,
    negativeValence: -0.25,
    excitedArousal: 0.65,
    surprisedArousal: 0.7,
    /* 负价且唤醒度不低于这里，余波读作「生气」；低于则读作「难过」。 */
    angryArousal: 0.7,
    /* 余波读数的物理范围：价可负，唤醒度只向上。 */
    valenceMin: -1,
    valenceMax: 1,
    arousalMin: 0,
    arousalMax: 1,
    weightMin: 0,
    weightMax: 1,
    /* 没有明显正负、但唤醒度偏高时，心情记为「不安」。 */
    restlessArousal: 0.6,
    tiredArousal: 0.15,
    /* 第三轴 dominance：偏离中立(0)的量，正＝掌控/自信，负＝退让/羞怯；同半衰期回落到 0。 */
    dominanceMin: -1,
    dominanceMax: 1,
    proudDominance: 0.3,
    shyDominance: -0.3,
  }),

  /* 一句心情 → 余波刺激。只影响表情，不写提示词。 */
  impulse: Object.freeze({
    happy: Object.freeze({ valence: 0.5, arousal: 0.55, dominance: 0.25 }),
    excited: Object.freeze({ valence: 0.7, arousal: 0.85, dominance: 0.5 }),
    shy: Object.freeze({ valence: 0.4, arousal: 0.35, dominance: -0.45 }),
    gentle: Object.freeze({ valence: 0.35, arousal: 0.25, dominance: 0.1 }),
    sad: Object.freeze({ valence: -0.6, arousal: 0.25, dominance: -0.5 }),
    angry: Object.freeze({ valence: -0.5, arousal: 0.8, dominance: 0.55 }),
    surprised: Object.freeze({ valence: 0.1, arousal: 0.85, dominance: -0.2 }),
    tired: Object.freeze({ valence: -0.15, arousal: 0.1, dominance: -0.3 }),
    thinking: Object.freeze({ valence: 0.1, arousal: 0.45, dominance: 0.2 }),
    neutral: Object.freeze({ valence: 0, arousal: 0.3, dominance: 0 }),
  }),

  needs: Object.freeze({
    /* 每小时自然回升，0..1/小时。 */
    growthPerHour: Object.freeze({
      connection: 0.12,
      novelty: 0.08,
      achievement: 0.06,
      rest: 0.15,
    }),
    /* 一次回应带来的满足量。 */
    satisfy: Object.freeze({
      connection: 0.35,
      achievement: 0.25,
      novelty: 0.2,
      rest: 0.3,
    }),
    /* 只有休息需求确实压满，才压低主动开口。 */
    holdBackRest: 0.9,
    /* 不指定类别时，一次满足带走这么多。 */
    defaultSatisfy: 0.35,
    /* 需求读数的取值范围与快照保留精度。 */
    levelMin: 0,
    levelMax: 1,
    snapshotPrecision: 1_000,
    /* 主导需求领先第二名不足这个差值时，视为「没有明显主导」。 */
    dominantGap: 0.08,
    /*
     * 新鲜感的确定性判据：够长、且在这段时间内没说过同样的句子，才算一次新输入。
     * 重复说同一句话不该被当成探索；隔得够久再提，仍然可以算新鲜。
     */
    noveltyMinLength: 6,
    noveltyHistoryLimit: 20,
    noveltyKeyLimit: 80,
    noveltyWindowHours: 2,
  }),

  /* 难过时更需要连接，生气时连接感没那么容易满足；其余按 1 倍。 */
  needSatisfyFactor: Object.freeze({
    sad: 1.25,
    angry: 0.8,
    default: 1,
  }),

  /*
   * 情绪标签 → 心情档。
   * 快照、脉络、记忆台的投影必须用同一张表，否则同一句话在三处会读出
   * 「轻快 / 开心 / 雀跃」三种底色。这里只做档位映射，不改任何权重。
   */
  moodFromEmotion: Object.freeze({
    happy: 'bright',
    excited: 'excited',
    shy: 'bright',
    sad: 'low',
    angry: 'low',
    surprised: 'restless',
    restless: 'restless',
    tired: 'low',
    thinking: 'calm',
  }),

  /* 心情档的展示文案；快照与提示词共用同一份，改口径只改这里。 */
  moodBands: Object.freeze({
    bright: Object.freeze({ label: '轻快', phrase: '心情很好，愿意多说两句' }),
    excited: Object.freeze({ label: '雀跃', phrase: '有点按捺不住的高兴' }),
    calm: Object.freeze({ label: '平静', phrase: '安稳，没有特别的起伏' }),
    low: Object.freeze({ label: '低落', phrase: '情绪偏低，不太想展开' }),
    restless: Object.freeze({ label: '不安', phrase: '有点躁，静不下来' }),
  }),
})

/* ============================== 在场 / 心情 ============================== */

export const PRESENCE = Object.freeze({
  /* 连续陪到这么久，心情转成「陪得有点久了」。 */
  longSessionHours: 3,
  /* 最近一次被点到，多久之内算「刚被注意到」。 */
  recentContactMinutes: 10,
  /* 深夜边界：23:00 起、05:00 止。 */
  nightStartHour: 23,
  nightEndHour: 5,
  /* 快照里的「深夜」要覆盖到天亮前那一刻，和夜间静音窗的 05:00 分开。 */
  lateNightEndHour: 6,
  /* 由头的时段边界；只决定提示词里提不提「这个点了」，不参与静音判断。 */
  cueHours: Object.freeze({
    morningStart: 6,
    morningEnd: 9,
    noonStart: 11,
    noonEnd: 13,
    eveningStart: 17,
    eveningEnd: 20,
  }),
  /* 多久没说话算「离开了一阵」/「很久没来」。 */
  shortAbsenceHours: 8,
  longAbsenceDays: 2,
  /*
   * 一天怎么分段：until 是这一段的结束小时（不含），按顺序取第一段。
   * period 用于「深夜 / 清晨」这类时段，label 用于「凌晨 / 天快亮」这种更细的说法。
   */
  dayPeriods: Object.freeze([
    Object.freeze({ until: 5, label: '深夜' }),
    Object.freeze({ until: 9, label: '清晨' }),
    Object.freeze({ until: 12, label: '上午' }),
    Object.freeze({ until: 14, label: '中午' }),
    Object.freeze({ until: 18, label: '下午' }),
    Object.freeze({ until: 23, label: '晚上' }),
    Object.freeze({ until: 24, label: '深夜' }),
  ]),
  dayLabels: Object.freeze([
    Object.freeze({ until: 5, label: '凌晨' }),
    Object.freeze({ until: 6, label: '天快亮' }),
    Object.freeze({ until: 9, label: '早上' }),
    Object.freeze({ until: 12, label: '上午' }),
    Object.freeze({ until: 14, label: '午后' }),
    Object.freeze({ until: 18, label: '下午' }),
    Object.freeze({ until: 22, label: '晚上' }),
    Object.freeze({ until: 24, label: '深夜' }),
  ]),
  /* 天气缓存；桌面气泡不追求分钟级新鲜。 */
  weatherTtlMinutes: 15,
})

/* ============================== 关系 ============================== */

export const RELATION = Object.freeze({
  /*
   * 六维：好感 / 信任 / 熟悉 / 依赖 / 欣赏 / 亲密（C1 已锁）。
   *
   * 总分 = 好感 + 加成，加成 = 其余五维加权和 × bonusCoefficient，封顶 +40。
   * 不用加权平均：平均会让负好感被其余五维的正分补回来，
   * 「好感很高但信任很低」这种矛盾态就被抹平了。
   */
  weights: Object.freeze({
    affinity: 1,
    trust: 0.5,
    familiarity: 0.3,
    dependence: 0.4,
    admiration: 0.3,
    intimacy: 0.6,
  }),

  /* 五维各满 100 时加权和是 210；×0.19 ≈ 40，正好落在封顶附近。 */
  bonusCoefficient: 0.19,
  bonusCap: 40,

  /* 主人的起步锚点；与 baselines.owner 同源，留给老调用方读。 */
  ownerStart: Object.freeze({
    affinity: 62,
    familiarity: 65,
  }),

  /*
   * 六维的取值范围。只有好感可以为负；其余五维都不从负数开始。
   * 关系模块只从这里建维度表，别在别处再写 -100/100/50。
   */
  dimensions: Object.freeze({
    affinity: Object.freeze({ min: -100, max: 100, start: 0 }),
    trust: Object.freeze({ min: 0, max: 100, start: 50 }),
    familiarity: Object.freeze({ min: 0, max: 100, start: 0 }),
    dependence: Object.freeze({ min: 0, max: 100, start: 0 }),
    admiration: Object.freeze({ min: 0, max: 100, start: 0 }),
    intimacy: Object.freeze({ min: 0, max: 100, start: 0 }),
  }),

  /*
   * 各维自然回落的半衰期（天）。向自己的基线回归，0 不是回落目标：
   * 主人本来就在 60，掉到 0 再慢慢爬回来，等于每几天就重置一次关系。
   */
  halfLifeDays: Object.freeze({
    affinity: 30,
    trust: 60,
    familiarity: 90,
    dependence: 60,
    admiration: 45,
    intimacy: 45,
  }),

  /*
   * 当日净变化上限（C1 已锁）：先求和再截断，不允许逐条卡。
   * 逐条卡会让「十件小事」等于「一件小事」，而人是一整天才算一天。
   */
  dailyCap: Object.freeze({
    affinity: Object.freeze({ up: 8, down: 8 }),
    trust: Object.freeze({ up: 3, down: 20 }),
    familiarity: Object.freeze({ up: 4, down: 1 }),
    dependence: Object.freeze({ up: 5, down: 2 }),
    admiration: Object.freeze({ up: 5, down: 5 }),
    intimacy: Object.freeze({ up: 3, down: 10 }),
  }),

  /* 关系分只在判档时使用这一段区间；负分保留（负分自然落「初见」）。 */
  scoreCeil: 140,

  /* 关系读数统一保留两位小数；下一档提示保留一位，避免设置页出现长尾。 */
  precision: 100,
  nextScorePrecision: 10,

  /* 关系趋势只看最近 7 天的净和，±3 以内都算「稳」。 */
  trendWindowDays: 7,
  trendDelta: 3,

  /* 退档要先跌破门槛 −10，小抖不动档（C2 滞回）。 */
  stageHysteresis: 10,

  /* 阶段门槛：分数与天数必须同时满足，取同时满足的最高档。 */
  stages: Object.freeze([
    Object.freeze({ key: 'first_meet', scoreMin: -Infinity, daysMin: 0 }),
    Object.freeze({ key: 'acquainted', scoreMin: 15, daysMin: 1 }),
    Object.freeze({ key: 'familiar', scoreMin: 40, daysMin: 7 }),
    Object.freeze({ key: 'close', scoreMin: 70, daysMin: 30 }),
    Object.freeze({ key: 'attached', scoreMin: 85, daysMin: 60 }),
    Object.freeze({ key: 'bonded', scoreMin: 95, daysMin: 90 }),
  ]),
})

/* ============================== 好感事件 ============================== */

export const BOND = Object.freeze({
  /* 同一件事的新鲜度：窗口内重复，份量逐次衰减。 */
  noveltyWindow: 30 * MINUTE,
  noveltySteps: Object.freeze([1, 0.5, 0.3, 0.2]),

  /* 很久没联系：超过几天才算疏远，每天扣一点，总量封顶。 */
  neglectAfterDays: 3,
  neglectPerDay: 0.5,
  neglectCap: 8,
  /*
   * 事件档位的单次幅度边界（关系点尺度，C1 已锁）。
   * 各事件可以在档内按语义微调，但不能越档。
   * 日上限不在这里——按维净额由 RELATION.dailyCap 管，先求和再截断。
   */
  eventTiers: Object.freeze({
    micro: Object.freeze({ delta: Object.freeze([0.5, 1.5]) }),
    small: Object.freeze({ delta: Object.freeze([2, 4]) }),
    medium: Object.freeze({ delta: Object.freeze([6, 10]) }),
    moment: Object.freeze({ delta: Object.freeze([11, 15]) }),
    hurt: Object.freeze({ delta: Object.freeze([18, 26]) }),
    'deep-hurt': Object.freeze({ delta: Object.freeze([26, 30]) }),
  }),

  /* 烦躁：20 分钟半衰期；跌破 60 后尾巴拉长 1.8 倍。 */
  irritationHalfLife: 20 * MINUTE,
  irritationToleranceBase: 55,
  irritationTailBoundary: 60,
  irritationTailFactor: 1.8,
  irritationCooldown: 10 * MINUTE,
  /* 冷却期内的安抚只按正常比例的一小截生效；头十分钟听不进去。 */
  irritationCooldownScale: 0.3,
  irritationRelief: Object.freeze({ apology: 0.3, comfort: 0.15, soothe: 0.2 }),
  irritationFloor: 8,
  /* 烦躁读数的物理上界；与关系维度不是同一把尺。 */
  irritationMax: 100,

  /*
   * 留疤（P4）：伤不是当天的分数，是往后相处里一直带着的东西。
   *
   * 一次 deep-hurt 不会第二天就归零；它变成一道疤，跟着语气一起走。
   * 疤会随时间变淡，可以被道歉与照顾削薄，但档案不删——她记得发生过什么，
   * 只是不再让那件事决定这一刻怎么说话。
   */
  scar: Object.freeze({
    limit: 12,
    /* 一次伤害最初的分量：deep-hurt 是信任层面的裂口，记两倍。 */
    weight: Object.freeze({ hurt: 1, 'deep-hurt': 2 }),
    /* 同一件事再犯：旧疤加深，而不是长出一道新疤。 */
    repeatFactor: 0.6,
    /* 变淡速度：一次重话 90 天减半，信任上的裂口 180 天。 */
    halfLifeDays: Object.freeze({ hurt: 90, 'deep-hurt': 180 }),
    /* 低于这个分量算愈合：档案留着，不再进提示词。 */
    healAt: 0.15,
    /* 一次最多让几道疤进提示词：多了会把「这一刻」压成旧账。 */
    promptLimit: 2,
    /* 修复：道歉最有效，陪伴其次；只削未愈的疤。 */
    repairFactor: Object.freeze({ apologize: 0.35, comfort: 0.2, soothe: 0.15, comeBack: 0.1 }),
  }),

  /* 快照分档的基准线与忍受度投影系数；与上面的消气参数分开。 */
  frictionBands: Object.freeze({ annoyed: 59, strained: 84 }),
  /* 忍受度的有效区间：人格文本再极端，也只在这里面投影。 */
  irritationToleranceMin: 20,
  irritationToleranceMax: 90,
  frictionToleranceShift: 0.4,

  /*
   * 轴与轴的耦合：累了更容易被点着，关系亲近时消气更快。
   * 这两个倍率是标准值；各模块若再细分，只能乘固定系数，不能随输入漂移。
   */
  frictionGainTired: 1.5,
  frictionDecayClose: 1.5,

  /* 群里的人每人一份好感，最多保留这么多。 */
  peerLimit: 200,

  /*
   * 四档人群的六维基线（C1-T 已锁）。区间用稳定种子骰一个点，同一人刷新不变。
   * 这些值同时是起点和回落锚点：关系变淡时回归的那条线，就是这里的数。
   * 客人的好感 / 熟悉 / 欣赏写成区间，是因为它们由前十句判定锁档；
   * 没攒够十句之前，起点是 0，不提前给分。
   */
  tiers: Object.freeze({
    owner: Object.freeze({
      affinity: Object.freeze([60, 70]),
      trust: Object.freeze([70, 70]),
      familiarity: Object.freeze([60, 70]),
      dependence: Object.freeze([25, 35]),
      admiration: Object.freeze([40, 50]),
      intimacy: Object.freeze([35, 45]),
    }),
    important: Object.freeze({
      affinity: Object.freeze([50, 60]),
      trust: Object.freeze([60, 60]),
      familiarity: Object.freeze([50, 60]),
      dependence: Object.freeze([18, 25]),
      admiration: Object.freeze([30, 40]),
      intimacy: Object.freeze([25, 35]),
    }),
    secondary: Object.freeze({
      affinity: Object.freeze([30, 40]),
      trust: Object.freeze([55, 55]),
      familiarity: Object.freeze([30, 40]),
      dependence: Object.freeze([10, 15]),
      admiration: Object.freeze([20, 30]),
      intimacy: Object.freeze([15, 25]),
    }),
    guest: Object.freeze({
      affinity: Object.freeze([-20, 20]),
      trust: Object.freeze([50, 50]),
      familiarity: Object.freeze([0, 20]),
      dependence: Object.freeze([0, 0]),
      admiration: Object.freeze([0, 20]),
      intimacy: Object.freeze([0, 0]),
    }),
  }),

  /* 客人靠前十句判定锁档的维度；依赖与亲密判不出来，只能靠相处攒。 */
  probeDimensions: Object.freeze(['affinity', 'familiarity', 'admiration']),

  /* 前十句判定的区间：好感可负，另两维从 0 起。 */
  probeRange: Object.freeze({
    affinity: Object.freeze([-20, 20]),
    familiarity: Object.freeze([0, 20]),
    admiration: Object.freeze([0, 20]),
  }),

  /* 一次事件最多按多少次叠加；防止调用方传大数把一天的上限冲穿。 */
  amountCap: 10,
  /* 人格涨速只在这个区间内生效，避免某一维被推到失真。 */
  gainMin: 0.6,
  gainMax: 1.6,

  /* 前十句话的采样与打分刻度。 */
  probeLineLimit: 10,
  /* 逐句印象分累加后乘这个系数，再夹进 probeRange（-20 ~ +20）。 */
  probeScale: 2,
  probeTextLimit: 120,

  /* 好感日志只留最近这么多条，够解释最近的变化就行。 */
  logLimit: 80,

  /* 幅度抖动：同一时间片内稳定，整体落在 ±20%。 */
  jitterSlotMinutes: 10,
  jitterRange: Object.freeze({ min: 0.8, max: 1.2 }),

  /* 对方刚说完话，隔多久才允许桌宠主动插一句。 */
  initiateGapMinutes: 10,

  /* 当前心情只看最近 45 分钟；两个关系读数决定「亲近 / 疏远」。 */
  moodWindowMinutes: 45,
  moodHighAffinity: 60,
  moodLowAffinity: -10,
  /* 贴近后的「love」姿态只在这一段时间内优先，过了就回到关系分判断。 */
  moodClosenessHours: 24,
})

/* ============================== 反思 / 筛选 ============================== */

export const REFLECTION = Object.freeze({
  /* 攒够几轮才做一次内心状态评估。 */
  minTurns: 6,
  /* 一次评估最多收多少条事实，防止一轮写爆。 */
  maxFacts: 8,
  /* 评估时最多回看多少条已知事实；比 maxFacts 略宽，用来判重。 */
  knownFactsLimit: 10,
  /* 候选箱超过这个数就在日反思里提醒主人去审。 */
  candidateWarn: 5,
  /* 一天聊到这个轮数，反思里记为「很密」。 */
  busyRounds: 20,
  /* 一篇反思最多三条印象；证据原话只露一小截。 */
  maxImpressions: 3,
  /* 额外印象单独占位，不参与核心三条的竞争。 */
  extraLimit: 2,
  evidenceTextLimit: 26,
  /* 回读：只看最近两天、每天两条、每条一段；只给主人，群里与访客不注入。 */
  readDays: 2,
  readLinesPerDay: 2,
  readMaxChars: 120,
  promptLimit: 4,
  /* 桌面端可能在插件运行期间写新日记；最多一小时回读一次，别每轮都碰磁盘。 */
  refreshMs: 60 * 60 * 1000,
  /* 反思挑「最值得写的一条」时的确定性加分：今天确认过 > 有原话 > 已结束。 */
  witnessTodayScore: 4,
  witnessEvidenceScore: 2,
  witnessEndedPenalty: 3,
  /* 日期合法性边界与同日补记的时钟片段长度。 */
  yearMin: 1970,
  monthMin: 1,
  monthMax: 12,
  dayMin: 1,
  dayMax: 31,
  clockTextLength: 5,
  /* 日报最多带多少条待办；金额只保留两位小数。 */
  reviewTodoLimit: 20,
  balancePrecision: 100,
  /* 内心状态评估：调用上限、输出字段长度、采样温度与 token 预算。 */
  timeoutMs: 30_000,
  /* 好感是 0..100 的整数刻度，与关系维度的 -100..100 分开。 */
  favorMin: 0,
  favorMax: 100,
  /* 低于这条线，内心读数按「疏远」处理。 */
  favorDistant: 20,
  impressionLimit: 120,
  relationLimit: 120,
  readLimit: 60,
  adjustLimit: 80,
  factTextLimit: MEMORY.factTextLimit,
  temperature: 0.3,
  maxTokens: 500,
})

export const FILTER = Object.freeze({
  /* 记忆抽取：一段话最多提多少条，避免长文把库刷满。 */
  maxPerTurn: 5,
  /* 单条最短长度：太短的多半是语气词。 */
  minTextLength: 4,
  /* 单条消息先截到这里再分句；再长也只取前面的有效部分。 */
  messageTextLimit: 400,
  /* 句子长度窗口：过短像语气词，过长多半不是一句自述。 */
  sentenceMinLength: 3,
  sentenceMaxLength: 120,
  /* 候选正文与证据的上限；两侧用同一把尺，避免证据比正文还长。 */
  candidateTextLimit: 80,
  /* 一轮对话的总抽取上限；单条消息仍受 maxPerTurn 约束。 */
  perRoundLimit: 8,
  /* 自动放行线：低于候选箱门槛的值不直接进提示词，先留在候选箱等主人审。 */
  autoApproveConfidence: 0.7,
  autoApproveSlots: Object.freeze(['identity', 'preference', 'promise', 'project']),
  /*
   * 规则抽取的置信度分档：明确自称最高，时间模糊的事最低。
   * 各条规则只在自己这一档上取值，改口径时统一改这里。
   */
  extractConfidence: Object.freeze({
    name: 0.9,
    correction: 0.9,
    alias: 0.85,
    like: 0.85,
    dislike: 0.85,
    promise: 0.85,
    boundary: 0.75,
    habit: 0.7,
    goal: 0.7,
    doing: 0.7,
    fallback: 0.7,
    learned: 0.65,
    event: 0.6
  })
})

/* ============================== 脉络 ============================== */

export const THREAD = Object.freeze({
  /*
   * 事件分量：
   * - major：人格直接裁决，允许改变关系档、留下长期记忆；
   * - minor：人格给边界，子系统在边界内决定具体反应；
   * - micro：人格只定语气底色，具体由情绪/习惯/环境决定。
   */
  tiers: Object.freeze(['major', 'minor', 'micro']),

  /* 大事的最低分量：低于这个只算小事。 */
  majorWeight: 0.7,
  /* 小事与极小事的边界。 */
  minorWeight: 0.3,

  /* 一次脉络摘要最多带几个节点，避免提示词膨胀。 */
  maxNodes: 6,
  /* 每个节点最多几个字。 */
  nodeTextLimit: 60,

  /*
   * 分量算法的基准：槽位给底分，关键词、固定、置信度做确定性加减。
   * 这些量跨脉络与反思共用，放在这里；关键词表仍留在 threads.mjs。
   */
  slotBase: Object.freeze({
    identity: 0.38,
    preference: 0.22,
    knowledge: 0.4,
    project: 0.5,
    promise: 0.6,
    event: 0.42,
    relationship: 0.5,
    lesson: 0.45,
    habit: 0.28,
    emotion: 0.3,
    goal: 0.5,
    ritual: 0.45,
    plan: 0.55,
    boundary: 0.6,
  }),
  defaultSlotBase: 0.35,
  majorWordStep: 0.12,
  majorWordCap: 0.3,
  microWordPenalty: 0.06,
  microWordCap: 0.2,
  confidenceBaseline: 0.6,
  confidenceWeight: 0.15,
  pinnedBonus: 0.18,
  personaBonus: 0.12,
  /* 亲近度对身份 / 关系类节点的加成；与 personaBonus 分量相同，但语义独立。 */
  closenessBonus: 0.12,
  /*
   * 心情只投影「小事 / 极小事」的可见度，不改大事。
   * 这些是标准值；threads.mjs 直接取用，不再在模块里各写一份。
   */
  moodMicroBias: Object.freeze({
    bright: 0.05,
    excited: 0.07,
    calm: 0,
    low: -0.06,
    restless: -0.08,
    love: 0.03,
    serious: -0.05,
  }),
  /* 当前这句话作为脉络节点时的置信度：它是本人刚说出口的，按明确自述处理。 */
  currentTurnConfidence: 0.9,
  minNodeCap: 2,
  closenessBase: 0.6,
  closenessSpan: 0.4,
})

/* ============================== Live2D ============================== */

/*
 * 驱动侧的命令口径。默认时长与钳制边界放在这里，
 * live2d-command.mjs 只负责拼命令，不再自己写一套时间。
 */
export const LIVE2D = Object.freeze({
  expressionDefaultDurationMs: 30 * SECOND,
  expressionMinDurationMs: SECOND,
  poseDefaultDurationMs: 8 * SECOND,
  poseMinDurationMs: SECOND / 2,
  poseMaxDurationMs: 2 * MINUTE,
  sayTextMax: 400,
  /* 外部驱动桥：回环 HTTP 超时与口型单帧时长。 */
  bridgeTimeoutMs: 4000,
  lipSyncDurationMs: 120,
})

/* ============================== 素材 ============================== */

/* 素材包与模型解压的体积上限，防止一个压缩包把磁盘吃满。 */
export const ASSETS = Object.freeze({
  packMaxTotalBytes: 128 * 1024 * 1024,
  packMaxFileBytes: 16 * 1024 * 1024,
  modelExtractMaxTotalBytes: 512 * 1024 * 1024,
})

/* ============================== 投递 / 通道 ============================== */

/* 远程通道的边界：主人数量、附件体积、承接话有效期。 */
export const DELIVER = Object.freeze({
  qqMaxOwners: 5,
  qqImageMaxBytes: 4 * 1024 * 1024,
  qqVoiceMaxBytes: 5 * 1024 * 1024,
  qqWebhookMaxBodyBytes: 256 * 1024,
  handoffTtlMs: 2 * HOUR,
  decisionTimeoutMs: 5 * MINUTE,
})

/* ============================== 密钥派生 ============================== */

/*
 * 同步包与整库备份共用同一档 PBKDF2 强度。
 * 备份要兼容旧包，下限比同步低；两者都不能接受过低或过高的迭代次数。
 */
export const CRYPTO = Object.freeze({
  kdfIterations: 210_000,
  kdfMinIterations: 10_000,
  syncMinIterations: 100_000,
  kdfMaxIterations: 2_000_000,
})

/* ============================== 网络请求 ============================== */

/* 模型请求与注入项的兜底时间；单位毫秒。 */
export const NETWORK = Object.freeze({
  dailyPlanTimeoutMs: 40 * SECOND,
  chatTimeoutMs: 45 * SECOND,
  chatInjectionTimeoutMs: 3 * SECOND,
  chatLocalStateTimeoutMs: 500,
  chatProbeTimeoutMs: 12 * SECOND,
})

/**
 * 把标准值按模块系数缩放，并保证落在合理区间。
 * 系数必须是调用方文件里的常量，不能来自用户输入。
 */
export function scaled(value, factor, min = -Infinity, max = Infinity) {
  const base = Number(value)
  const scale = Number(factor)
  const raw = Number.isFinite(base) && Number.isFinite(scale) ? base * scale : base
  return Math.min(max, Math.max(min, raw))
}
