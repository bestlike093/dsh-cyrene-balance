/**
 * reflection-params.mjs —— 可演化参数表标注（P1 插座 · 2026-11-24 实施单§2-P1a）
 *
 * 三条边界的头一条落在这里：档位阈值 = 可演化参数，但**当前手工维护，反思未启用**。
 * 每个可推移字段标四件：base（现行手工值，取自 standard 不另抄）、boundary（宪法授权
 * 区间，改它只能由账本裁定）、rateCap（单次互动跳变上限）、trace（推移必进 sealed）。
 *
 * 本文件是纯标注数据：不被任何生产链 import（check-p1-socket S5 守），不改变任何行为。
 * 艾宾浩斯参数（λ/σ/分档阈值）住 retention 段——数值只准落这张表，代码里写死即闸红。
 */
import { RELATION } from '../standard.mjs'

const MANUAL = Object.freeze({ status: 'manual', reflectionEnabled: false, trace: 'sealed' })

/** 分数门槛可推移档（first_meet 为底档，scoreMin=-Infinity 不参与推移） */
const scoreThresholds = RELATION.stages
  .filter((s) => Number.isFinite(s.scoreMin))
  .map((s) => Object.freeze({
    path: `RELATION.stages.${s.key}.scoreMin`,
    base: s.scoreMin,
    boundary: Object.freeze([0, 100]),
    rateCapPerInteraction: 5,
    orderConstraint: '跨档单调：低档门槛不得追平高档',
    ...MANUAL,
  }))

/** 天数门槛可推移档（first_meet 的 daysMin=0 是天然底，不推移） */
const dayThresholds = RELATION.stages
  .filter((s) => s.daysMin > 0)
  .map((s) => Object.freeze({
    path: `RELATION.stages.${s.key}.daysMin`,
    base: s.daysMin,
    boundary: Object.freeze([1, 365]),
    rateCapPerInteraction: 7,
    orderConstraint: '跨档单调同分数轴',
    ...MANUAL,
  }))

export const REFLECTION_PARAMS = Object.freeze({
  contract: 'p1-reflection-socket-v1',
  note: '宪法授权区间只由账本裁定修改；enabled 翻真需要 2.1.0 宪法地基 + 3.x 反思通电，两层各要一次主人签字。',
  stageScoreThresholds: Object.freeze(scoreThresholds),
  stageDayThresholds: Object.freeze(dayThresholds),
  hysteresis: Object.freeze({
    path: 'RELATION.stageHysteresis',
    base: RELATION.stageHysteresis,
    boundary: Object.freeze([0, 30]),
    rateCapPerInteraction: 2,
    ...MANUAL,
  }),
  retention: Object.freeze({
    lambdaPerDay: Object.freeze({ path: 'retention.lambdaPerDay', base: 0.01, boundary: Object.freeze([0.001, 0.05]), rateCapPerInteraction: 0.002, ...MANUAL }),
    sigma: Object.freeze({ path: 'retention.sigma', base: 0.3, boundary: Object.freeze([0.1, 0.6]), rateCapPerInteraction: 0.05, ...MANUAL }),
    lightThreshold: Object.freeze({ path: 'retention.lightThreshold', base: 0.3, boundary: Object.freeze([0.05, 0.5]), constraint: 'light < pin', ...MANUAL }),
    pinThreshold: Object.freeze({ path: 'retention.pinThreshold', base: 0.8, boundary: Object.freeze([0.6, 0.95]), constraint: 'pin > light', ...MANUAL }),
  }),
})
