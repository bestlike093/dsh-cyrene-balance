/**
 * 性格速度参数：决定她「多容易被点着、多久消气、一天能撑多久」的那几个数。
 *
 * 这些数不该由人拍板。同样是「说了一句重话」，温柔的人心里只起一层涟漪，
 * 脾气急的人已经烧起来了；这属于人格的一部分，应该从人格提示词里长出来。
 *
 * 所以这里的顺序是：
 *   1. deriveTraits(人格文本) 先给一份自动值
 *   2. resolveTraits() 再让用户的逐项覆盖压上去
 *   3. 表达层与调度层只读最终值，不关心它来自哪一层
 *
 * 纯函数：不读文件、不碰宿主，文本由调用方注入。
 */

/* ---------------- 五轴灵敏度 ---------------- */

/** 五轴的名字固定，前端不用自己猜。 */
export const AXIS_KEYS = Object.freeze(['relation', 'friction', 'body', 'memory', 'proactive'])

export const SENSITIVITY_LEVELS = Object.freeze(['low', 'normal', 'high'])

/**
 * 灵敏度只乘事件权重，不改结构。
 * 低档不是「听不见」，是「慢一点」；高档也不是「一点就炸」，是「更容易留下痕迹」。
 */
export const SENSITIVITY_SCALE = Object.freeze({
  low: 0.65,
  normal: 1,
  high: 1.4,
})

export function sensitivityScaleOf(level) {
  return SENSITIVITY_SCALE[level] ?? 1
}

/* 每个参数的合理范围。超出的输入会被夹回来，避免一次手滑把节奏调坏。 */
export const TRAIT_DEFS = [
  {
    key: 'irritationTolerance',
    label: '烦躁忍受度',
    base: 55,
    min: 20,
    max: 90,
    unit: '',
    about: '同样的重话，能扛住几分才明显烦起来',
  },
  {
    key: 'irritationHalfLifeMinutes',
    label: '消气时间',
    base: 20,
    min: 5,
    max: 120,
    unit: '分钟',
    about: '烦躁消掉一半要多久',
  },
  {
    key: 'energyDrainPerHour',
    label: '精力消耗',
    base: 4,
    min: 1.5,
    max: 9,
    unit: '点/小时',
    about: '醒着的时候每小时掉多少精力',
  },
  {
    key: 'affinityGainScale',
    label: '好感涨速',
    base: 1,
    min: 0.6,
    max: 1.6,
    unit: '倍',
    about: '同一件事在她心里的分量',
  },
  {
    key: 'familiarityGainScale',
    label: '熟悉涨速',
    base: 1,
    min: 0.6,
    max: 1.6,
    unit: '倍',
    about: '多快从「认识」走到「熟」',
  },
  {
    key: 'opennessScale',
    label: '主动开口',
    base: 1,
    min: 0.5,
    max: 1.8,
    unit: '倍',
    about: '多久会自己找话说',
  },
  {
    /*
     * 亲近门槛：好感到这个分数，她才愿意再近一步。
     *
     * 这一项是「贴近时刻」的入场线，不是描写尺度。数值越低越好接近：
     * 黏人、浪漫的角色会往下走，冷淡、克制的角色会往上走。
     * 主人可以在设置里直接改这一项（traits 覆盖），第三人改不动。
     */
    key: 'intimacyGate',
    label: '亲近门槛',
    base: 60,
    min: 50,
    max: 75,
    unit: '分',
    about: '好感到这个数，才愿意再近一步',
  },
]

const TRAIT_BY_KEY = new Map(TRAIT_DEFS.map((def) => [def.key, def]))

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function round2(value) {
  return Math.round(value * 100) / 100
}

/*
 * 人格词汇 → 参数偏移。
 * 只认明确写出来的性格词，不做语义联想：宁可推得保守，也不要凭一句「可爱」
 * 就认定她脾气软。命中越多，偏移越大，但单个维度最多推 45%。
 */
const PERSONA_CUES = [
  {
    id: 'patience',
    // 温柔、能等、愿意体谅
    words: ['温柔', '耐心', '包容', '体贴', '体谅', '善解人意', '沉静', '从容', '好脾气', '不急不躁'],
    effect: { irritationTolerance: 0.14, irritationHalfLifeMinutes: -0.1, intimacyGate: -0.02 },
  },
  {
    id: 'temper',
    // 一点就着、嘴硬心软、敏感
    words: ['傲娇', '毒舌', '急躁', '易怒', '暴躁', '脾气', '小性子', '敏感', '刀子嘴', '嘴硬', '别扭'],
    effect: { irritationTolerance: -0.14, irritationHalfLifeMinutes: 0.14, intimacyGate: 0.03 },
  },
  {
    id: 'softHeart',
    // 毒舌只是壳，里子是软的：抵消一部分 temper 的副作用，别把「心软」读成「易怒」。
    words: ['心软', '刀子嘴豆腐心', '嘴硬心软', '豆腐心'],
    effect: { irritationTolerance: 0.1, irritationHalfLifeMinutes: -0.1 },
  },
  {
    id: 'lively',
    // 话多、情绪外放
    words: ['活泼', '元气', '话多', '热闹', '黏人', '撒娇', '雀跃', '兴奋', '开朗', '跳脱'],
    /*
     * opennessScale 单独放大到 0.3：它要撑起「多久找一次人」这条可见差异，
     * 原先 0.14 推出来的区间太窄，映射到间隔只剩 1.6 倍，用户看不出性格。
     * 同一组的 energyDrainPerHour 与 intimacyGate 维持原值，免得把其它在用参数一起带跑。
     */
    effect: { energyDrainPerHour: 0.12, opennessScale: 0.3, intimacyGate: -0.05 },
  },
  {
    id: 'quiet',
    // 话少、收着
    words: ['寡言', '冷淡', '冷静', '克制', '沉默', '疏离', '清冷', '内敛', '不主动', '不爱说话', '话少', '安静'],
    effect: { energyDrainPerHour: -0.1, opennessScale: -0.3, intimacyGate: 0.08 },
  },
  {
    id: 'warm',
    // 容易被小事打动
    words: ['浪漫', '柔软', '细腻', '眷恋', '深情', '偏爱', '记得', '珍惜'],
    effect: { affinityGainScale: 0.1, familiarityGainScale: 0.06, intimacyGate: -0.06 },
  },
]

/** 数一数每个 cue 在文本里出现了几次（同一个词只算一次，避免复读机把权重刷爆）。 */
function countCues(text) {
  const hits = {}
  for (const cue of PERSONA_CUES) {
    const matched = cue.words.filter((word) => text.includes(word))
    if (matched.length > 0) hits[cue.id] = { count: matched.length, words: matched }
  }
  return hits
}

/* 稳定的短指纹：同一份词表永远同一个值，用来判断 state 里那份基于哪版词表推的。 */
function fnv1a(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/*
 * 推导口径的结构版本。
 *
 * 管公式与字段形状；词表内容不靠它，靠下面的 WORDSET_ID 自己变。
 * v2：念旧归一化从 (pos-neg)/(total+1) 改为 (pos-neg)/(total+3)，
 *     默认人格不再饱和在 +0.9 附近，多命中仍有可见梯度。
 */
export const TRAITS_VERSION = 2

/*
 * 念旧词集（recallBias 的唯一来源）。
 *
 * 只收指向「记忆 / 回望」的词，七段 persona 默认文案里都真实出现过。
 * 故意不收「陪伴」「等待」：它们是关系词，任何温柔人设都会写，
 * 留在表里会变成「温柔 → 念旧」的假因果（和 affinityGainScale 的共线同源）。
 * 「珍惜」「眷恋」保留：比关系词更贴记忆，但要盯住别让温柔型漂回正端。
 *
 * 词集扩了也不会让满量程漂移，因为归一化看的是 pos+neg，不是词表长度。
 */
const NOSTALGIA_WORDS = [
  '记得', '提过的小事',
  '舍不得', '记录', '走过', '漫长',
  '回望', '过往', '回溯', '逆溯', '回到最初',
  '涟漪', '珍惜', '眷恋',
]

/*
 * 向前看的原形词。
 *
 * 这一组不参与否定前缀反转：「不回头」本身就是反向，
 * 再被「不」翻一次会变正。命中即负，不看前后文。
 */
const FORWARD_WORDS = ['翻篇', '向前看', '不回头', '不沉溺', '往前走', '不翻旧账']

/*
 * 词表指纹。
 *
 * 词集一变这里自然变，不靠人记得去改常量——上一轮移出「陪伴／等待」就是活例子。
 * 两个列表之间用 \u0002 隔开，防止拼接歧义。
 */
export const WORDSET_SIZE = NOSTALGIA_WORDS.length + FORWARD_WORDS.length
export const WORDSET_ID = fnv1a(
  [...NOSTALGIA_WORDS, '\u0002', ...FORWARD_WORDS].join('\u0001'),
).slice(0, 6)

/* 只认紧贴在词前的否定词；「不必」这类后面接的不是正向词，不会误伤。 */
const NEGATION_BEFORE = /(?:不|从不|不再|不会|没有|别|莫|未)$/

function countNostalgia(text) {
  let pos = 0
  let neg = 0
  const hits = []
  /*
   * 第一次命中记满，重复命中按 1/3 步长递减（封顶 +2/3）。
   * 提到一次就该算数；软化只防复读机把权重刷爆。
   */
  const soften = (n) => (n === 0 ? 0 : 1 + Math.min(2, n - 1) / 3)

  for (const word of NOSTALGIA_WORDS) {
    let from = 0
    let plain = 0
    let flipped = 0
    while (true) {
      const index = text.indexOf(word, from)
      if (index === -1) break
      const before = text.slice(Math.max(0, index - 3), index)
      if (NEGATION_BEFORE.test(before)) flipped += 1
      else plain += 1
      from = index + word.length
    }
    if (plain > 0) {
      pos += soften(plain)
      hits.push({ word, count: plain, side: 'pos' })
    }
    if (flipped > 0) {
      neg += soften(flipped)
      hits.push({ word, count: flipped, side: 'neg' })
    }
  }

  /*
   * 向前看词：命中即负，不做否定反转。
   * 「不回头」本身就是反向，再翻一次会变正；
   * 前面又出现「不」时也仍然只算一次负向。
   */
  for (const word of FORWARD_WORDS) {
    let from = 0
    let hit = 0
    while (true) {
      const index = text.indexOf(word, from)
      if (index === -1) break
      hit += 1
      from = index + word.length
    }
    if (hit > 0) {
      neg += soften(hit)
      hits.push({ word, count: hit, side: 'neg' })
    }
  }

  return { pos, neg, hits }
}

/**
 * 命中明细：给验收脚本和调试面板看「这几个字为什么让它偏了」。
 * 只读，不参与权重计算。
 */
export function nostalgiaDetail(text = '') {
  return countNostalgia(typeof text === 'string' ? text : '')
}

/**
 * 念旧倾向：正 = 念旧（衰减更慢），负 = 向前看。
 *
 * 归一化用 (pos - neg) / (pos + neg + 3)：单次正向命中给 0.25，
 * 正负相等给 0，不命中给 0，且永远够不到 ±1——即使默认人格命中
 * 十几个念旧词，也只是「明显念旧」，而不是顶死在 +0.92 上失去梯度。
 * 结果再过一次 clamp，防止将来改词集时把值域撑破。
 */
export function nostalgiaBias(text = '') {
  const { pos, neg } = countNostalgia(typeof text === 'string' ? text : '')
  const total = pos + neg
  if (total === 0) return 0
  return clamp((pos - neg) / (total + 3), -1, 1)
}

/*
 * 念旧倾向落到衰减上的那一层：半衰期。
 *
 * 死区 0.15、满量程 ±1/6 与 weightOf 共用同一份公式；
 * 这里给的是唯一实现，memory-store 也引这一份，免得两处各算一遍。
 * 只投影，不改 bias 本身。
 */
export const RECALL_HALF_LIFE_DAYS = 30

export function halfLifeDaysOf(bias = 0) {
  const raw = Number(bias)
  const level = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0
  const mag = Math.max(0, Math.abs(level) - 0.15) / 0.85
  const eff = Math.sign(level) * mag / 6
  return RECALL_HALF_LIFE_DAYS * (1 + eff)
}

/**
 * 从人格文本推导参数。
 *
 * @param {string} personaText 完整人格提示词（基底 + 补充）
 * @returns {{ traits: object, hits: object, source: string }}
 */
export function deriveTraits(personaText = '') {
  const text = typeof personaText === 'string' ? personaText : ''
  const traits = {}
  for (const def of TRAIT_DEFS) traits[def.key] = def.base
  if (text.trim() === '') {
    return {
      traits,
      hits: {},
      source: 'default',
      recallBias: 0,
      traitsVersion: TRAITS_VERSION,
      wordsId: WORDSET_ID,
      recallDetail: {
        pos: 0,
        neg: 0,
        halfLifeDays: 0,
        hits: [],
        zeroHitWords: [
          ...NOSTALGIA_WORDS.map((word) => ({ word, side: 'pos' })),
          ...FORWARD_WORDS.map((word) => ({ word, side: 'neg' })),
        ],
      },
    }
  }

  const hits = countCues(text)
  const deltas = {}
  for (const cue of PERSONA_CUES) {
    const hit = hits[cue.id]
    if (!hit) continue
    /* 命中 1 个词算 1/3，3 个词封顶；避免一段长文里反复出现同一个词把值推到边界。 */
    const weight = Math.min(3, hit.count) / 3
    for (const [key, value] of Object.entries(cue.effect)) {
      deltas[key] = (deltas[key] ?? 0) + value * weight
    }
  }

  for (const def of TRAIT_DEFS) {
    const delta = deltas[def.key] ?? 0
    /* 最多推 45%，留出人格描述本身可能互相矛盾的空间。 */
    const bounded = clamp(delta, -0.45, 0.45)
    traits[def.key] = round2(clamp(def.base * (1 + bounded), def.min, def.max))
  }

  /*
   * 第 8 个产物：念旧倾向，连同账一起交出去。
   *
   * 只算一次 detail，由它推出 bias，避免两处口径各算一遍。
   * recallDetail 是给面板与验收脚本的既有事实——面板只投影，不再调词表；
   * 词表或公式要改，改的仍然是这一处。
   */
  const recallDetailRaw = nostalgiaDetail(text)
  const recallBias = nostalgiaBias(text)
  const recallDetail = {
    pos: round2(recallDetailRaw.pos),
    neg: round2(recallDetailRaw.neg),
    /* 面板要显示的半衰期也从这一份出，不在视图层再算一遍。 */
    halfLifeDays: round2(halfLifeDaysOf(recallBias)),
    hits: recallDetailRaw.hits,
    /*
     * 未命中的词，按 side 分开。
     * 反向词也给 side：写「不往前走」会被剥掉否定前缀，极性和预期相反。
     */
    zeroHitWords: [
      ...NOSTALGIA_WORDS.map((word) => ({ word, side: 'pos' })),
      ...FORWARD_WORDS.map((word) => ({ word, side: 'neg' })),
    ].filter((entry) => !recallDetailRaw.hits.some((hit) => hit.word === entry.word)),
  }

  return {
    traits,
    hits,
    source: 'persona',
    recallBias,
    recallDetail,
    traitsVersion: TRAITS_VERSION,
    wordsId: WORDSET_ID,
  }
}

/**
 * 合并自动值与用户覆盖。
 * 覆盖是逐项的：用户只改了消气时间，其它几项仍然跟着人格走。
 */
export function resolveTraits({ auto = {}, overrides = {} } = {}) {
  const out = {}
  const detail = []
  for (const def of TRAIT_DEFS) {
    const autoValue = Number.isFinite(Number(auto?.[def.key]))
      ? clamp(Number(auto[def.key]), def.min, def.max)
      : def.base
    const hasOverride = overrides !== null && overrides !== undefined && overrides[def.key] !== undefined && overrides[def.key] !== null
    const overrideValue = hasOverride ? Number(overrides[def.key]) : NaN
    const value = clamp(Number.isFinite(overrideValue) ? overrideValue : autoValue, def.min, def.max)
    out[def.key] = round2(value)
    detail.push({
      key: def.key,
      label: def.label,
      value: out[def.key],
      auto: round2(autoValue),
      overridden: hasOverride && Number.isFinite(overrideValue),
      unit: def.unit,
      about: def.about,
      min: def.min,
      max: def.max,
    })
  }
  return { traits: out, detail }
}

/**
 * 烦躁增量按忍受度缩放。
 * 忍受度 55 是基准；越高同样的重话涨得越少，越低越容易点着。
 */
export function scaleIrritationGain(delta, traits) {
  const tolerance = Number.isFinite(Number(traits?.irritationTolerance))
    ? Number(traits.irritationTolerance)
    : TRAIT_BY_KEY.get('irritationTolerance').base
  const factor = clamp(1.7 - tolerance / 100, 0.5, 1.6)
  const amount = Number(delta)
  if (!Number.isFinite(amount)) return 0
  return round2(amount * factor)
}

/** 好感和熟悉的增量按各自的倍率缩放。 */
export function scaleBondDelta(delta, traits, axis = 'affinity') {
  const key = axis === 'familiarity' ? 'familiarityGainScale' : 'affinityGainScale'
  const scale = Number.isFinite(Number(traits?.[key]))
    ? Number(traits[key])
    : TRAIT_BY_KEY.get(key).base
  const amount = Number(delta)
  if (!Number.isFinite(amount)) return 0
  return round2(amount * scale)
}

/** 消气半衰期（毫秒）。 */
export function irritationHalfLifeMs(traits) {
  const minutes = Number.isFinite(Number(traits?.irritationHalfLifeMinutes))
    ? Number(traits.irritationHalfLifeMinutes)
    : TRAIT_BY_KEY.get('irritationHalfLifeMinutes').base
  return Math.max(60_000, Math.round(minutes * 60_000))
}

/** 给设置页/观察台的一句话：这一项是自动推的，还是被手动改过。 */
export function describeTraits(detail = []) {
  return (Array.isArray(detail) ? detail : []).map((item) => {
    const suffix = item.overridden ? '（手动）' : '（按人格）'
    const unit = item.unit ? ` ${item.unit}` : ''
    return `${item.label} ${item.value}${unit}${suffix}`
  })
}

/** 只把命中的人格词取出来，方便观察台解释「为什么推成这样」。 */
export function traitEvidence(hits = {}) {
  const lines = []
  for (const cue of PERSONA_CUES) {
    const hit = hits?.[cue.id]
    if (!hit) continue
    lines.push(`${cue.id}: ${hit.words.join('、')}`)
  }
  return lines
}
