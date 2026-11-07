/**
 * 公开版亲密层占位：整条功能不随包发布。
 */
export const INTIMACY_EDITION = 'public'
export const IS_PUBLIC_EDITION = true
export const INTIMACY_EDITION_LABEL = '公开版'
export const INTIMACY_DEFAULTS = Object.freeze({ perDay: 0, cooldownHours: 24, idleHours: 1, aftercareMinutes: 5 })
export const STAGE_LABELS = Object.freeze({ none: '', near: '靠近', lean: '依偎', edge: '临界', peak: '爆发', afterglow: '余韵' })
export const STAGE_TURNS = Object.freeze({ near: 2, lean: 3, edge: 3, peak: 2 })
export const STAGE_ORDER = Object.freeze(['near', 'lean'])
export const DESIRE_ENTER = 38
export const DESIRE_RISE = 4
export const DESIRE_MAX = 50
export const DESIRE_REST = 36
export const ENERGY_MIN = 30
export const ENERGY_COST = 12
export const REFUSE_QUIET_MS = 30 * 60 * 1000
export const INITIATIVE_MIN = 0.7
export const LEVEL_LABELS = Object.freeze({ repress: '收着', flirt: '擦边', deep: '深入' })
export const LEVEL_RISE = Object.freeze({ flirt: 4, deep: 12 })
export const TONE_CEILING = Object.freeze({ repress: 'soft', flirt: 'edge', deep: 'peak' })
export const AFFECTION_EDGE = 50
export const AFFECTION_DEEP = 75
export const SAFE_LINES = Object.freeze(['……今天先这样吧。'])
export const INTIMACY_PROMPTS = Object.freeze({})
export const INTIMACY_PROMPT_ZH = ''

export function levelOf(rise) {
  const value = Number(rise)
  if (!Number.isFinite(value) || value < LEVEL_RISE.flirt) return 'repress'
  return value < LEVEL_RISE.deep ? 'flirt' : 'deep'
}

export function capTone(tone) {
  return tone
}

export function initiativeOf() {
  return 0
}

export function narrowLevel() {
  return 'repress'
}

export function capByAffection() {
  return 'repress'
}

export function redlineFor() {
  return Object.freeze([])
}

export function safetyBlock() {
  return '公开版不提供亲密层'
}

export function promptsFor() {
  return Object.freeze({})
}

export function createIntimacyGate() {
  const closed = { open: false, reason: 'edition', cue: 'none', stage: 'none', level: 'repress', tone: 'none', proactive: false, label: '' }
  return {
    load: () => undefined,
    flush: () => undefined,
    check: () => ({ ...closed }),
    promptFor: () => '',
    noteTurn: () => ({ ended: false }),
    noteOpen: () => ({ ended: false }),
    noteExit: () => undefined,
    hasExited: () => false,
    filterReply: (text) => ({ ok: true, text: String(text ?? ''), reason: 'public' }),
    snapshot: () => ({ count: 0, stage: 'none' }),
    reset: () => undefined
  }
}

export function describeIntimacy() {
  return '贴近时刻：公开版不提供'
}
