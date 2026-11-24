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
import { bondLevel, bondMood, normalizeBond, relationStageOf } from './bond.mjs'
import { RELATION_STAGES, resolveRelationStage } from './relationship-stage.mjs'
import { BODY, BOND, EMOTION, PRESENCE, RELATION, TIME } from '../standard.mjs'

const HOUR = TIME.HOUR
const DAY = TIME.DAY

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
const FRICTION_BASE = BOND.frictionBands
const FRICTION_TOLERANCE_BASE = BOND.irritationToleranceBase

export function frictionBandsFor(tolerance = FRICTION_TOLERANCE_BASE) {
  const raw = Number(tolerance)
  const value = Math.min(
    BOND.irritationToleranceMax,
    Math.max(BOND.irritationToleranceMin, Number.isFinite(raw) ? raw : FRICTION_TOLERANCE_BASE),
  )
  const shift = Math.round((FRICTION_TOLERANCE_BASE - value) * BOND.frictionToleranceShift)
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
const BODY_BANDS = BODY.bands

/** 数值 → 精力档。提示词与快照共用这一张表，别在别处再判一次阈值。 */
export function bodyBandOf(energy) {
  const value = Number.isFinite(Number(energy)) ? Number(energy) : BODY.defaultEnergy
  return bandOf(BODY_BANDS, value, 'max')
}

/* ---- 耦合增益：轴与轴之间的联动。采集层和快照层共用同一份口径，
 * 别在别处再判一次「累了 / 亲近」的阈值。 ---- */

/** 累了更容易被点着：见底/有点累（energy ≤ 45）时烦躁涨幅 ×1.5。 */
export function frictionGainFor(energy) {
  const band = bodyBandOf(energy)
  return band.key === 'spent' || band.key === 'tired' ? BOND.frictionGainTired : 1
}

/** 关系亲近（score ≥ 70）时更容易哄好：摩擦半衰期按 1.5 倍缩短。 */
export function frictionDecayFor(relationScore) {
  const closeStage = RELATION.stages.find((item) => item.key === 'close')
  if (closeStage === undefined) return 1
  return Number.isFinite(Number(relationScore)) && Number(relationScore) >= closeStage.scoreMin
    ? BOND.frictionDecayClose
    : 1
}

/* ---- 心情档：展示文案与情绪映射都取标准，快照不再各留一份。 ---- */
const MOOD_LABELS = EMOTION.moodBands

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
  const window = RELATION.trendWindowDays * DAY
  const threshold = RELATION.trendDelta
  let sum = 0
  for (const item of log) {
    if (now - Number(item.at) > window) continue
    sum += Number(item.delta) || 0
  }
  if (sum >= threshold) return 'up'
  if (sum <= -threshold) return 'down'
  return 'steady'
}

function frictionOf(raw, traits) {
  const value = Number.isFinite(Number(raw)) ? Number(raw) : 0
  const band = frictionBandOf(value, traits?.irritationTolerance)
  return { key: band.key, label: band.label, value }
}

function bodyOf(state) {
  const energy = Number.isFinite(Number(state?.energy)) ? Number(state.energy) : BODY.defaultEnergy
  const band = bodyBandOf(energy)
  return {
    key: band.key,
    label: band.label,
    phrase: band.phrase,
    needsRest: energy < BODY.needsRestEnergy || Number(state?.sleepDebt) >= BODY.needsRestSleepDebt,
    energy,
  }
}

/* 情绪层既可能给整份快照，也可能只给一个标签；两种都读得出来。 */
function afterglowOf(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return null
  return snapshot.afterglow !== null && typeof snapshot.afterglow === 'object' ? snapshot.afterglow : null
}

/* 情绪映射只留标准一份；这里只负责把「这一句」落到心情档。 */
const DIRECT_MOODS = EMOTION.moodFromEmotion

function moodOf(snapshot, friction, relationMood) {
  const pick = (key) => ({ key, ...MOOD_LABELS[key] })
  /* 绷不住的时候，心情不再看余波：人烦躁时很难真的轻快。 */
  if (friction.key === 'strained' || relationMood === 'serious') return pick('low')

  /* 这一句直接判出来的情绪最具体，先于余波。 */
  const direct = typeof snapshot === 'string' ? snapshot : null
  if (direct !== null && DIRECT_MOODS[direct] !== undefined) return pick(DIRECT_MOODS[direct])

  const afterglow = EMOTION.afterglow
  const source = afterglowOf(snapshot)
  const valence = Number.isFinite(source?.valence) ? source.valence : 0
  const arousal = Number.isFinite(source?.arousal) ? source.arousal : 0
  if (valence >= afterglow.positiveValence) {
    return arousal >= afterglow.excitedArousal ? pick('excited') : pick('bright')
  }
  if (valence <= afterglow.negativeValence) return pick('low')
  /*
   * 关系刚贴近时，余波可能还没跟上；只要不是负价，就让关系把底色抬到轻快。
   * 这是确定性联动：bondMood 只从最近事件和关系档来，不反过来改关系。
   */
  if ((relationMood === 'love' || relationMood === 'happy') && valence >= 0) return pick('bright')
  if (arousal >= afterglow.restlessArousal) return pick('restless')
  return pick('calm')
}

/* 由头：她现在有什么理由主动开口。没有由头就不该硬找话题。 */
function cuesOf({ now, body, friction, bond, lastTalkAt, scope }) {
  const cues = []
  if (scope !== 'desktop') return cues

  const hour = new Date(now).getHours()
  const cue = PRESENCE.cueHours
  if (hour >= PRESENCE.nightStartHour || hour < PRESENCE.lateNightEndHour) cues.push('late-night')
  if (hour >= cue.morningStart && hour < cue.morningEnd) cues.push('morning')
  if (hour >= cue.noonStart && hour < cue.noonEnd) cues.push('noon')
  if (hour >= cue.eveningStart && hour < cue.eveningEnd) cues.push('evening')

  const idle = Number.isFinite(Number(lastTalkAt)) ? now - Number(lastTalkAt) : Infinity
  if (idle >= PRESENCE.longAbsenceDays * DAY) cues.push('long-absence')
  else if (idle >= PRESENCE.shortAbsenceHours * HOUR) cues.push('short-absence')

  if (body.needsRest) cues.push('tired')
  if (friction.key === 'annoyed') cues.push('need-gentle')
  if (Number(bond?.closenessAt) > 0 && now - Number(bond.closenessAt) < BOND.moodClosenessHours * HOUR) {
    cues.push('after-closeness')
  }
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
  const relationMood = input.bond ? bondMood(input.bond, now) : 'calm'
  const mood = moodOf(input.emotion, friction, relationMood)

  /*
   * 群聊只保留「认不认识」这一层。
   * 阶段名、趋势、摩擦和私人心绪都不能从这里漏出去；需要完整关系时
   * 只能走桌面 scope。这里先投影成一份公开读数，下面的返回只读它。
   */
  const publicRelation =
    relation.key === 'first_meet'
      ? { key: 'first_meet', label: '还陌生' }
      : { key: 'acquainted', label: '见过' }
  const shownRelation = isDesktop
    ? {
        key: relation.key,
        label: relation.label,
        tone: relation.tone,
        trend: relation.trend,
        score: relation.score,
        stage: relation.stage,
      }
    : {
        key: publicRelation.key,
        label: publicRelation.label,
        tone: '保持礼貌的距离，不主动撒娇，不追问私事。',
        trend: 'steady',
        score: 0,
        stage: { key: publicRelation.key, label: publicRelation.label },
      }
  /* 耦合：这三条决定了「她此刻好不好接近」。 */
  const frictionGain = frictionGainFor(body.energy)
  const frictionDecay = frictionDecayFor(relation.score)
  const openingAllowed =
    friction.key !== 'strained' && !body.needsRest && scene !== 'idle'

  const shownFriction = isDesktop
    ? { key: friction.key, label: friction.label, visible: true, gain: frictionGain, decay: frictionDecay }
    : { key: 'settled', label: '平静', visible: false, gain: 1, decay: 1 }
  const shownMood = isDesktop
    ? { key: mood.key, label: mood.label, phrase: mood.phrase, visible: true }
    : { key: 'calm', label: '平静', phrase: '安稳，没有特别的起伏', visible: false }

  return {
    scope,
    scene,
    at: now,

    relation: {
      key: shownRelation.key,
      label: shownRelation.label,
      tone: shownRelation.tone,
      trend: shownRelation.trend,
      /* 桌面才给关系分数：群里只保留「认不认识」。 */
      score: shownRelation.score,
      /* 群聊里只保留「认不认识」，不给亲近程度。 */
      shared: isDesktop ? relation.label : publicRelation.label,
      /* 天数、行为边界与下一档只在本机给；群聊只留公开档名。 */
      stage: shownRelation.stage,
    },

    friction: shownFriction,

    body: {
      key: body.key,
      label: body.label,
      phrase: body.phrase,
      needsRest: body.needsRest,
    },

    mood: shownMood,

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
