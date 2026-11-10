/**
 * 状态快照：陪伴系统的唯一读数出口。
 *
 * 为什么要有这一层：
 * 好感、烦躁、精力、心情原来各算各的，表达层每个地方自己判断阈值，
 * 同一轮里可能一边说「很亲近」一边说「还有点生分」。
 *
 * 这里做三件事：
 *   1. 把四条轴换算成档位（不吐原始数值，模型看见数字会当事实复述）
 *   2. 一次性算出轴与轴之间的耦合（累了更容易被点着、亲近时消气更快）
 *   3. 按 scope 做门禁，群聊拿不到私人关系与贴近状态
 *
 * 纯函数：不读文件、不碰宿主、时间由调用方注入。
 * 表达层只读这里的结果，不再直接读 bond / body / emotion。
 */

/* 关系档位直接复用 bond 的判档口径，避免两处阈值各说各的。 */
import { bondLevel, normalizeBond, relationStageOf } from './bond.mjs'
import { RELATION_STAGES, resolveRelationStage } from './relationship-stage.mjs'

const HOUR = 3600_000
const DAY = 24 * HOUR

/* ---- 关系档：bondLevel 的 score = affinity + trust*0.2 + familiarity*0.3 ----
 * 档位表只有 relationship-stage.mjs 一份，这里不再留本地常量。
 */

/* ---- 摩擦档：越高越容易被点着，也越不想多说 ----
 * 三档是刻意的：四档以后「烦了」和「明显烦」在提示词里演不出区别，
 * 多出来的档名只占字数。60 以下不写进提示词，平常就当没有这回事。
 *
 * 边界跟着性格参数 irritationTolerance 走：忍受度 55 是基准，
 * 越不耐（20）门槛越靠下，越能扛（90）门槛越靠上。
 * 人格文本 → deriveTraits → 这里，是同一条链。
 */
const FRICTION_BASE = Object.freeze({ annoyed: 59, strained: 84 })
const FRICTION_TOLERANCE_BASE = 55

export function frictionBandsFor(tolerance = FRICTION_TOLERANCE_BASE) {
  const raw = Number(tolerance)
  const value = Math.min(90, Math.max(20, Number.isFinite(raw) ? raw : FRICTION_TOLERANCE_BASE))
  const shift = Math.round((FRICTION_TOLERANCE_BASE - value) * 0.4)
  return [
    { key: 'settled', max: FRICTION_BASE.annoyed - shift, label: '平静' },
    { key: 'annoyed', max: FRICTION_BASE.strained - shift, label: '有点烦' },
    { key: 'strained', max: Infinity, label: '很烦' },
  ]
}

export const FRICTION_BANDS = frictionBandsFor(FRICTION_TOLERANCE_BASE)

/** 数值 → 摩擦档。提示词与快照共用这一张表，别在别处再判一次阈值。 */
export function frictionBandOf(raw, tolerance = FRICTION_TOLERANCE_BASE) {
  const value = Number.isFinite(Number(raw)) ? Number(raw) : 0
  const bands = tolerance === FRICTION_TOLERANCE_BASE ? FRICTION_BANDS : frictionBandsFor(tolerance)
  return bandOf(bands, value, 'max')
}

/* ---- 精力档 ---- */
const BODY_BANDS = [
  { key: 'spent', max: 20, label: '见底', phrase: '几乎撑不住了' },
  { key: 'tired', max: 45, label: '有点累', phrase: '说话会慢一点' },
  { key: 'okay', max: 75, label: '还撑得住', phrase: '平常状态' },
  { key: 'fresh', max: Infinity, label: '有精神', phrase: '话会比平时多' },
]

/** 数值 → 精力档。提示词与快照共用这一张表，别在别处再判一次阈值。 */
export function bodyBandOf(energy) {
  const value = Number.isFinite(Number(energy)) ? Number(energy) : 78
  return bandOf(BODY_BANDS, value, 'max')
}

/* ---- 耦合增益：轴与轴之间的联动。采集层和快照层共用同一份口径，
 * 别在别处再判一次「累了 / 亲近」的阈值。 ---- */

/** 累了更容易被点着：见底/有点累（energy ≤ 45）时烦躁涨幅 ×1.5。 */
export function frictionGainFor(energy) {
  const band = bodyBandOf(energy)
  return band.key === 'spent' || band.key === 'tired' ? 1.5 : 1
}

/** 关系亲近（score ≥ 70）时更容易哄好：摩擦半衰期按 1.5 倍缩短。 */
export function frictionDecayFor(relationScore) {
  return Number.isFinite(Number(relationScore)) && Number(relationScore) >= 70 ? 1.5 : 1
}

/* ---- 心情档 ---- */
const MOOD_LABELS = {
  bright: { label: '轻快', phrase: '心情很好，愿意多说两句' },
  excited: { label: '雀跃', phrase: '有点按捺不住的高兴' },
  calm: { label: '平静', phrase: '安稳，没有特别的起伏' },
  low: { label: '低落', phrase: '情绪偏低，不太想展开' },
  restless: { label: '不安', phrase: '有点躁，静不下来' },
}

function bandOf(bands, value, field = 'min') {
  if (field === 'min') {
    let hit = bands[0]
    for (const band of bands) if (value >= band.min) hit = band
    return hit
  }
  for (const band of bands) if (value <= band.max) return band
  return bands[bands.length - 1]
}

function relationOf(bond, now) {
  if (bond === null || bond === undefined) {
    const stage = resolveRelationStage({ score: 0, firstMetAt: null, now })
    return {
      key: stage.key,
      legacyId: stage.legacyId,
      min: stage.scoreMin,
      label: stage.label,
      tone: stage.tone,
      score: 0,
      trend: 'steady',
      stage,
    }
  }
  /* 先归一化一次：老存档的 firstMetAt 要在这里推导出来，阶段才拿得到天数。 */
  const normalized = normalizeBond(bond, now)
  const level = bondLevel(normalized)
  /* 判档口径只留在 relationship-stage（经 bond 转手），快照不再自己算一遍。 */
  const stage = relationStageOf(normalized, now)
  return {
    key: stage.key,
    legacyId: stage.legacyId,
    min: stage.scoreMin,
    label: stage.label,
    tone: stage.tone,
    score: level.score,
    trend: trendOf(normalized, now),
    stage,
  }
}

/* 趋势只看最近 7 天的事件净和，够粗就行；不预测，只描述方向。 */
function trendOf(bond, now) {
  const log = Array.isArray(bond?.log) ? bond.log : []
  let sum = 0
  for (const item of log) {
    if (now - Number(item.at) > 7 * DAY) continue
    sum += Number(item.delta) || 0
  }
  if (sum >= 3) return 'up'
  if (sum <= -3) return 'down'
  return 'steady'
}

function frictionOf(raw, traits) {
  const value = Number.isFinite(Number(raw)) ? Number(raw) : 0
  const band = frictionBandOf(value, traits?.irritationTolerance)
  return { key: band.key, label: band.label, value }
}

function bodyOf(state) {
  const energy = Number.isFinite(Number(state?.energy)) ? Number(state.energy) : 78
  const band = bodyBandOf(energy)
  return {
    key: band.key,
    label: band.label,
    phrase: band.phrase,
    needsRest: energy < 35 || Number(state?.sleepDebt) >= 8,
    energy,
  }
}

function moodOf(snapshot, friction) {
  const pick = (key) => ({ key, ...MOOD_LABELS[key] })
  /* 绷不住的时候，心情不再看余波：人烦躁时很难真的轻快。 */
  if (friction.key === 'strained') return pick('low')
  const valence = Number.isFinite(snapshot?.afterglow?.valence) ? snapshot.afterglow.valence : 0
  const arousal = Number.isFinite(snapshot?.afterglow?.arousal) ? snapshot.afterglow.arousal : 0
  if (valence >= 0.25) return arousal >= 0.65 ? pick('excited') : pick('bright')
  if (valence <= -0.25) return pick('low')
  if (arousal >= 0.6) return pick('restless')
  return pick('calm')
}

/* 由头：她现在有什么理由主动开口。没有由头就不该硬找话题。 */
function cuesOf({ now, body, friction, bond, lastTalkAt, scope }) {
  const cues = []
  if (scope !== 'desktop') return cues

  const hour = new Date(now).getHours()
  if (hour >= 23 || hour < 6) cues.push('late-night')
  if (hour >= 6 && hour < 9) cues.push('morning')
  if (hour >= 11 && hour < 13) cues.push('noon')
  if (hour >= 17 && hour < 20) cues.push('evening')

  const idle = Number.isFinite(Number(lastTalkAt)) ? now - Number(lastTalkAt) : Infinity
  if (idle >= 2 * DAY) cues.push('long-absence')
  else if (idle >= 8 * HOUR) cues.push('short-absence')

  if (body.needsRest) cues.push('tired')
  if (friction.key === 'annoyed') cues.push('need-gentle')
  if (Number(bond?.closenessAt) > 0 && now - Number(bond.closenessAt) < DAY) cues.push('after-closeness')
  return cues
}

/**
 * 构建快照。
 *
 * @param {object} input
 * @param {object} input.bond       bond 状态（bond.json）
 * @param {number} input.irritation 当前烦躁值 0..100
 * @param {object} input.body       body 状态（body.json）
 * @param {object} input.emotion    emotion-runtime.snapshot() 的返回值
 * @param {object} input.intimacy   intimacy 状态
 * @param {string} input.scope      desktop | qq:private | qq:group
 * @param {string} input.scene      chat | proactive | idle
 * @param {number} input.lastTalkAt 上一次对话时间戳
 * @param {number} input.now
 */
export function buildCompanionSnapshot(input = {}) {
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now()
  const scope = typeof input.scope === 'string' ? input.scope : 'desktop'
  const scene = typeof input.scene === 'string' ? input.scene : 'chat'
  const isDesktop = scope === 'desktop'

  const relation = relationOf(input.bond, now)
  const friction = frictionOf(input.irritation, input.traits)
  const body = bodyOf(input.body)
  const mood = moodOf(input.emotion, friction)

  /* 耦合：这三条决定了「她此刻好不好接近」。 */
  const frictionGain = frictionGainFor(body.energy)
  const frictionDecay = frictionDecayFor(relation.score)
  const openingAllowed =
    friction.key !== 'strained' && !body.needsRest && scene !== 'idle'

  return {
    scope,
    scene,
    at: now,

    relation: {
      key: relation.key,
      label: relation.label,
      tone: relation.tone,
      trend: relation.trend,
      /* 群聊里只保留「认不认识」，不给亲近程度。 */
      shared: isDesktop ? relation.label : relation.key === 'first_meet' ? '还陌生' : '见过',
      /* 天数、行为边界与下一档只在本机给；群聊只留阶段名。 */
      stage: isDesktop
        ? relation.stage
        : { key: relation.stage.key, label: relation.stage.label },
    },

    friction: {
      key: friction.key,
      label: friction.label,
      /* 群聊里不暴露私人摩擦。 */
      visible: isDesktop,
      gain: frictionGain,
      decay: frictionDecay,
    },

    body: {
      key: body.key,
      label: body.label,
      phrase: body.phrase,
      needsRest: body.needsRest,
    },

    mood: { key: mood.key, label: mood.label, phrase: mood.phrase },

    intimacy: isDesktop
      ? { open: input.intimacy?.enabled === true, tone: input.intimacy?.tone ?? '' }
      : { open: false, tone: '' },

    cues: cuesOf({ now, body, friction, bond: input.bond, lastTalkAt: input.lastTalkAt, scope }),
    openingAllowed: isDesktop && openingAllowed,
  }
}

/**
 * 把快照压成一行给表达层用。只给档位和行为倾向，不给数值。
 * 空字符串表示这一轮没什么要说的，调用方直接跳过。
 */
export function describeSnapshot(snapshot) {
  if (snapshot === null || snapshot === undefined) return ''
  const parts = []
  if (snapshot.relation?.label) parts.push(`关系：${snapshot.relation.label}`)
  if (snapshot.body?.label) parts.push(`精力：${snapshot.body.label}`)
  if (snapshot.mood?.label) parts.push(`心情：${snapshot.mood.label}`)
  if (snapshot.friction?.visible && snapshot.friction.key !== 'settled') {
    parts.push(`摩擦：${snapshot.friction.label}`)
  }
  return parts.join(' / ')
}

export const SNAPSHOT_LEVELS = {
  relation: RELATION_STAGES.map((item) => item.key),
  friction: FRICTION_BANDS.map((item) => item.key),
  body: BODY_BANDS.map((item) => item.key),
  mood: Object.keys(MOOD_LABELS),
}
