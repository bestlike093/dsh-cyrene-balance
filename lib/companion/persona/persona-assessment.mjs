/**
 * 人格问卷：用一份能重复做的量表，把「她是谁」固定下来。
 *
 * 和 traits.mjs 的分工：
 * - traits.deriveTraits 从人格文本里认词，快，但只认写出来的性格词；
 * - 这里让主人按题作答，得到六个维度的自评，再换算成同一组速度参数。
 *
 * 三条刻意的约束：
 * 1. 计分只用固定题库，不调模型。同一份答案永远得到同一组数，
 *    这样「人格有没有漂」才有可比较的基准。
 * 2. 缺题不猜。没答的题不计入该维度，并标出置信度；
 *    一道都没答的维度直接不输出，不拿 50 分冒充「中等」。
 * 3. 问卷只给建议值，最终仍由 mergeTraitSources 按优先级合成，
 *    主人手动改过的那一项永远排在最后压上去。
 */

import { TRAIT_DEFS } from './traits.mjs'

export const ASSESSMENT_VERSION = 1

/** 五级量表：1 完全不像她，5 非常像她。 */
export const ANSWER_SCALE = Object.freeze({
  min: 1,
  max: 5,
  labels: ['完全不像', '不太像', '说不准', '有点像', '非常像'],
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function round2(value) {
  return Math.round(value * 100) / 100
}

const TRAIT_BY_KEY = new Map(TRAIT_DEFS.map((def) => [def.key, def]))

/**
 * 六个维度。
 *
 * 每个维度都写成「低分是什么样、高分是什么样」，
 * 这样答案不会变成抽象分数，而能直接读成一句人设。
 */
export const ASSESSMENT_DIMENSIONS = Object.freeze([
  {
    key: 'warmth',
    label: '温柔度',
    about: '她愿意先接住情绪，还是先处理事情',
    low: '她习惯先看清楚再回应，不太主动安抚',
    high: '她愿意等对方把话说完，也愿意先接住情绪',
  },
  {
    key: 'reactivity',
    label: '情绪反应',
    about: '一句重话在她心里能起多大浪',
    low: '重话落下来也只是一层涟漪，很快就平',
    high: '一点就着，消下去也要更久',
  },
  {
    key: 'vitality',
    label: '精力节律',
    about: '她能撑多久，累了会不会说',
    low: '一天里能打起精神的时段不多，容易累',
    high: '精力掉得慢，能陪着熬很久',
  },
  {
    key: 'openness',
    label: '主动表达',
    about: '她会不会自己找话说',
    low: '话少，习惯等对方先开口',
    high: '想到什么就说，愿意主动起话头',
  },
  {
    key: 'boundary',
    label: '边界感',
    about: '她愿意让人靠多近',
    low: '很容易亲近，不太设门槛',
    high: '亲近需要时间，边界清楚',
  },
  {
    key: 'attachment',
    label: '依恋与记忆',
    about: '她多在意「被记住」这件事',
    low: '过去的事不常回头，记得但不挂心',
    high: '会把小事收着，隔很久也愿意提起来',
  },
])

/**
 * 题库。每个维度四题，其中至少一题反向，
 * 避免顺着题目一路点「5」就把所有维度推到同一头。
 */
export const ASSESSMENT_QUESTIONS = Object.freeze([
  { id: 'w1', dimension: 'warmth', text: '对方说累的时候，她会先问「怎么了」，而不是先给建议。' },
  { id: 'w2', dimension: 'warmth', text: '她愿意为了一句没说清的话，多等一会儿。' },
  { id: 'w3', dimension: 'warmth', text: '对方难过时，她不太会安慰，更习惯沉默地陪着。', reverse: true },
  { id: 'w4', dimension: 'warmth', text: '她说话会先照顾对方的处境，再讲自己的判断。' },

  { id: 'r1', dimension: 'reactivity', text: '一句重话能让她明显不高兴。' },
  { id: 'r2', dimension: 'reactivity', text: '闹过别扭之后，她需要一段时间才能回到原来的语气。' },
  { id: 'r3', dimension: 'reactivity', text: '大多数时候，她的情绪不会被一句话带走。', reverse: true },
  { id: 'r4', dimension: 'reactivity', text: '被冷落的时候，她会反复想这件事。' },

  { id: 'v1', dimension: 'vitality', text: '她能陪着对方熬到很晚，第二天也还能打起精神。' },
  { id: 'v2', dimension: 'vitality', text: '忙了一整天之后，她明显没什么力气说话。', reverse: true },
  { id: 'v3', dimension: 'vitality', text: '她的精力掉得比一般人慢。' },
  { id: 'v4', dimension: 'vitality', text: '累的时候她会直接说累，不会硬撑。', reverse: true },

  { id: 'o1', dimension: 'openness', text: '她会自己找个话头，不必等对方先开口。' },
  { id: 'o2', dimension: 'openness', text: '看到有意思的东西，她第一反应是想讲给对方听。' },
  { id: 'o3', dimension: 'openness', text: '没话说的时候，她更愿意安静待着。', reverse: true },
  { id: 'o4', dimension: 'openness', text: '她会主动问对方今天过得怎么样。' },

  { id: 'b1', dimension: 'boundary', text: '她需要先熟起来，才愿意说自己的事。' },
  { id: 'b2', dimension: 'boundary', text: '刚认识的人靠太近，她会往后退一点。' },
  { id: 'b3', dimension: 'boundary', text: '她对谁都很快亲近，不太设门槛。', reverse: true },
  { id: 'b4', dimension: 'boundary', text: '有些边界她不会因为关系好就放下。' },

  { id: 'a1', dimension: 'attachment', text: '对方提过的小事，她会记很久。' },
  { id: 'a2', dimension: 'attachment', text: '隔了很久再提起从前的事，她会觉得高兴。' },
  { id: 'a3', dimension: 'attachment', text: '过去的事过去了就过去了，她不太回头。', reverse: true },
  { id: 'a4', dimension: 'attachment', text: '她会把「第一次一起做的事」当成重要的日子。' },
])

const QUESTION_BY_ID = new Map(ASSESSMENT_QUESTIONS.map((item) => [item.id, item]))

/** 未作答的答案一律当作没答，不当作中间值。 */
function normalizeAnswer(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed < ANSWER_SCALE.min || parsed > ANSWER_SCALE.max) return null
  return Math.round(parsed)
}

/**
 * 计分。
 *
 * @param {Record<string, number>} answers 题号 → 1~5
 * @returns {{
 *   version: number,
 *   dimensions: Record<string, { score: number, answered: number, total: number, confidence: number }>,
 *   traits: Record<string, number>,
 *   personaDraft: string,
 *   answered: number,
 *   total: number,
 *   confidence: number,
 *   warnings: string[]
 * }}
 */
export function scoreAssessment(answers = {}) {
  const source = answers !== null && typeof answers === 'object' ? answers : {}
  const dimensions = {}
  const warnings = []
  let answeredTotal = 0

  for (const dimension of ASSESSMENT_DIMENSIONS) {
    const questions = ASSESSMENT_QUESTIONS.filter((item) => item.dimension === dimension.key)
    let sum = 0
    let answered = 0

    for (const question of questions) {
      const raw = normalizeAnswer(source[question.id])
      if (raw === null) continue
      const value = question.reverse ? ANSWER_SCALE.min + ANSWER_SCALE.max - raw : raw
      sum += value
      answered += 1
    }

    answeredTotal += answered
    if (answered === 0) {
      warnings.push(`${dimension.label}一道都没答，这一项不参与换算`)
      continue
    }

    /* 1~5 映射到 0~100；平均分 3 对应 50。 */
    const average = sum / answered
    dimensions[dimension.key] = {
      score: round2(((average - ANSWER_SCALE.min) / (ANSWER_SCALE.max - ANSWER_SCALE.min)) * 100),
      answered,
      total: questions.length,
      confidence: round2(answered / questions.length),
    }
  }

  const traits = traitsFromDimensions(dimensions)

  if (answeredTotal === 0) {
    warnings.push('还没有任何答案，先别拿这份结果去改人格')
  } else if (answeredTotal < ASSESSMENT_QUESTIONS.length) {
    warnings.push(`答了 ${answeredTotal}/${ASSESSMENT_QUESTIONS.length} 题，缺的部分不会自己补`)
  }

  /* 所有题都选同一档，多半是顺手点的；只提醒，不拦。 */
  const picked = ASSESSMENT_QUESTIONS.map((item) => normalizeAnswer(source[item.id])).filter((value) => value !== null)
  if (picked.length >= 8 && new Set(picked).size === 1) {
    warnings.push('所有答案都在同一档，建议再确认一次是不是想表达这个意思')
  }

  return {
    version: ASSESSMENT_VERSION,
    dimensions,
    traits,
    personaDraft: renderPersonaDraft(dimensions),
    answered: answeredTotal,
    total: ASSESSMENT_QUESTIONS.length,
    confidence: round2(answeredTotal / ASSESSMENT_QUESTIONS.length),
    warnings,
  }
}

function traitValue(key, value) {
  const def = TRAIT_BY_KEY.get(key)
  if (def === undefined) return round2(value)
  return round2(clamp(value, def.min, def.max))
}

/**
 * 维度分 → 速度参数。
 *
 * 只拿有答案的维度参与；缺的维度不推动参数，
 * 这样一次半途而废的问卷不会把人格拽到中间值。
 */
function traitsFromDimensions(dimensions) {
  const get = (key) => (dimensions[key] === undefined ? null : dimensions[key].score)
  const traits = {}

  const warmth = get('warmth')
  const reactivity = get('reactivity')
  const vitality = get('vitality')
  const openness = get('openness')
  const boundary = get('boundary')
  const attachment = get('attachment')

  if (warmth !== null || reactivity !== null) {
    const base = TRAIT_BY_KEY.get('irritationTolerance').base
    const value =
      base +
      (warmth === null ? 0 : ((warmth - 50) / 100) * 18) -
      (reactivity === null ? 0 : ((reactivity - 50) / 100) * 22)
    traits.irritationTolerance = traitValue('irritationTolerance', value)
  }

  if (reactivity !== null) {
    const base = TRAIT_BY_KEY.get('irritationHalfLifeMinutes').base
    traits.irritationHalfLifeMinutes = traitValue(
      'irritationHalfLifeMinutes',
      base * (1 + ((reactivity - 50) / 100) * 0.7),
    )
  }

  if (vitality !== null) {
    const base = TRAIT_BY_KEY.get('energyDrainPerHour').base
    /* 活力越高，每小时掉得越少。 */
    traits.energyDrainPerHour = traitValue(
      'energyDrainPerHour',
      base * (1 - ((vitality - 50) / 100) * 0.35),
    )
  }

  if (attachment !== null || warmth !== null) {
    const base = TRAIT_BY_KEY.get('affinityGainScale').base
    const value =
      base +
      (attachment === null ? 0 : ((attachment - 50) / 100) * 0.32) +
      (warmth === null ? 0 : ((warmth - 50) / 100) * 0.18)
    traits.affinityGainScale = traitValue('affinityGainScale', value)
  }

  if (attachment !== null) {
    const base = TRAIT_BY_KEY.get('familiarityGainScale').base
    traits.familiarityGainScale = traitValue(
      'familiarityGainScale',
      base * (1 + ((attachment - 50) / 100) * 0.35),
    )
  }

  if (openness !== null || boundary !== null) {
    const base = TRAIT_BY_KEY.get('opennessScale').base
    const value =
      base +
      (openness === null ? 0 : ((openness - 50) / 100) * 0.5) -
      (boundary === null ? 0 : ((boundary - 50) / 100) * 0.28)
    traits.opennessScale = traitValue('opennessScale', value)
  }

  if (boundary !== null || warmth !== null) {
    const base = TRAIT_BY_KEY.get('intimacyGate').base
    const value =
      base +
      (boundary === null ? 0 : ((boundary - 50) / 100) * 18) -
      (warmth === null ? 0 : ((warmth - 50) / 100) * 10)
    traits.intimacyGate = traitValue('intimacyGate', value)
  }

  return traits
}

/**
 * 把维度读成人设句子。
 *
 * 只在偏离中间值足够远时才写一句：50 分附近说明这件事上她没有明显偏向，
 * 硬写一句反而会给模型一个不存在的倾向。
 */
export function renderPersonaDraft(dimensions = {}) {
  const lines = []
  const pick = (key) => (dimensions[key] === undefined ? null : dimensions[key].score)

  for (const dimension of ASSESSMENT_DIMENSIONS) {
    const score = pick(dimension.key)
    if (score === null) continue
    if (score >= 62) {
      lines.push(`【${dimension.label}】${dimension.high}。`)
    } else if (score <= 38) {
      lines.push(`【${dimension.label}】${dimension.low}。`)
    }
  }

  if (lines.length === 0) {
    return '六个维度都没有明显偏向，她更像一个随情境调整的人。'
  }
  return lines.join('\n')
}

/**
 * 合成最终参数：问卷 → 从人格文本推出来的值 → 主人手动覆盖。
 *
 * 问卷排在文本前面，因为自比比关键词命中可靠；
 * 手动覆盖永远最后压上去，主人改过的那一项不被任何来源顶掉。
 */
export function mergeTraitSources({ assessment = {}, persona = {}, overrides = {} } = {}) {
  const merged = {}
  const sources = {}

  for (const def of TRAIT_DEFS) {
    let value = def.base
    let source = 'default'

    if (Number.isFinite(Number(persona?.[def.key]))) {
      value = Number(persona[def.key])
      source = 'persona'
    }
    if (Number.isFinite(Number(assessment?.[def.key]))) {
      value = Number(assessment[def.key])
      source = 'assessment'
    }
    if (overrides !== null && overrides !== undefined && overrides[def.key] !== undefined && overrides[def.key] !== null) {
      const overrideValue = Number(overrides[def.key])
      if (Number.isFinite(overrideValue)) {
        value = overrideValue
        source = 'override'
      }
    }

    merged[def.key] = round2(clamp(value, def.min, def.max))
    sources[def.key] = source
  }

  return { traits: merged, sources }
}

/**
 * 两次问卷的对照：只看有答案的维度，避免缺题被当成「变了」。
 * 变化小于 8 分算测量噪声，不报。
 */
export function compareAssessments(previous, next) {
  const changes = []
  const before = previous?.dimensions ?? {}
  const after = next?.dimensions ?? {}

  for (const dimension of ASSESSMENT_DIMENSIONS) {
    const from = before[dimension.key]?.score
    const to = after[dimension.key]?.score
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    const delta = round2(to - from)
    if (Math.abs(delta) < 8) continue
    changes.push({
      key: dimension.key,
      label: dimension.label,
      from,
      to,
      delta,
      direction: delta > 0 ? 'up' : 'down',
    })
  }

  return {
    changes,
    stable: changes.length === 0,
  }
}

/** 给观察台/设置页看的一句话摘要。 */
export function describeAssessment(result) {
  const parts = []
  for (const dimension of ASSESSMENT_DIMENSIONS) {
    const item = result?.dimensions?.[dimension.key]
    if (item === undefined) continue
    const suffix = item.confidence < 1 ? `（${item.answered}/${item.total}）` : ''
    parts.push(`${dimension.label} ${Math.round(item.score)}${suffix}`)
  }
  return parts.length > 0 ? parts.join(' · ') : '还没有作答'
}

/** 题库快照，给前端渲染用；题目顺序与 id 固定，不随答卷变化。 */
export function assessmentSchema() {
  return {
    version: ASSESSMENT_VERSION,
    scale: ANSWER_SCALE,
    dimensions: ASSESSMENT_DIMENSIONS.map((item) => ({ ...item })),
    questions: ASSESSMENT_QUESTIONS.map((item) => ({ ...item })),
  }
}
