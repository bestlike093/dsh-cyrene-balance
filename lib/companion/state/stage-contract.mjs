/**
 * stage-contract.mjs —— 档位算子契约卡（P1 插座 · 实施单§2-P1 步5）
 *
 * 蓝本 v4 §8 口径：契约先于实现、版本稳定。规则版（现在的 relationship-stage）
 * 与将来 3.x 的模型版实现同一张契约——可互换、可对拍、可回落。本格只立形状，
 * 模型版插槽空着。
 *
 * validateStageOutput 是「结构完整性 = 免费质检员」的可执行形态：
 * 输出不合契约即违例——接线格（P1-c）里违例即触发回落规则版/升级，不静默吞。
 * 纯函数、零生产 import（check-p1-socket S5 守）。
 */
import { RELATION } from '../standard.mjs'

export const STAGE_CONTRACT = Object.freeze({
  contractId: 'stage-operator-contract-v1',
  status: 'shape-only',
  input: Object.freeze({
    access: 'readOnly',
    fields: Object.freeze(['affinityScore', 'daysKnown', 'peerId', 'mainScopeKey', 'nowMs', 'sessionFavor', 'retentionR']),
    note: '模型版接线时，这里读的一切进快照留痕；对拍用同一输入。',
  }),
  output: Object.freeze({
    required: Object.freeze(['stageKey', 'source', 'confidence', 'traceId']),
    stageKeys: Object.freeze(RELATION.stages.map((s) => s.key)),
    sources: Object.freeze(['auto', 'override']),
    confidenceRange: Object.freeze([0, 1]),
  }),
  invariants: Object.freeze([
    '档位来源单一：auto 或 override，不同时两源（来源计数==1）',
    'override 粘住期间 auto 不得写回，直到显式「交还给她自己算」',
    '输出越宪法授权区间：判无效、只留痕、不入库',
    '结构完整性违例：触发回落规则版（模型永不唯一实现）',
  ]),
})

/**
 * 契约校验（输出侧）。违例逐条命名，供日志与升级触发用。
 * @param {unknown} output
 * @returns {{ok:boolean, violations:string[]}}
 */
export function validateStageOutput(output) {
  const violations = []
  const o = output && typeof output === 'object' ? output : {}
  for (const k of STAGE_CONTRACT.output.required) {
    const v = o[k]
    if (v === undefined || v === null || v === '') violations.push(`缺字段:${k}`)
  }
  if (o.stageKey !== undefined && !STAGE_CONTRACT.output.stageKeys.includes(o.stageKey)) {
    violations.push('stageKey 越宪法档位表')
  }
  if (o.source !== undefined && !STAGE_CONTRACT.output.sources.includes(o.source)) {
    violations.push('source 违例（只许 auto/override 单一）')
  }
  if (typeof o.confidence === 'number' && (o.confidence < 0 || o.confidence > 1)) {
    violations.push('confidence 越界（须 ∈[0,1]）')
  }
  return Object.freeze({ ok: violations.length === 0, violations })
}
