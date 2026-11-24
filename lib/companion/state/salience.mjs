/**
 * salience.mjs —— 单一显著性纯函数（P1-b 结构半 · 刀③ 实施单§2-M1 承载项提前立骨架）
 *
 * 四条柱借来的判据（blueprint v4 §4-M1 / 12.1 二轮裁定）：一个显著性函数同时作用
 * 输出侧（回不回、注入多少）与写入侧（记不记、抽多少），配断言④：
 * 「注意力预算收紧时写入侧抽取量随之下降，不是恒定全抽」。
 *
 * 现网起点（§8.68 侦察）：写入侧已有 axisSensitivity('memory') 缩放——缩放源是
 * 性格定值，注意力预算再紧它也不动；本模块补的正是「预算→显著性」这一根线。
 *
 * 占位形态（结构半，主人裁定）：enabled 默认 false → factor 恒 1，逐字节走老逻辑；
 * budgetRatio 的真实数据源由 attentionBudgetRatio() 供给，M1 接注入侧时替换桩。
 * 纪律同 retention.mjs：本文件不写可调数值，floor 1 是「留一格通道」的结构常数。
 */

/**
 * 显著性单源：一处计算，两处消费（写侧 writeCapFor、读侧后续接注入）。
 * @param {{budgetRatio?:number, enabled?:boolean}} p
 * @returns {{enabled:boolean, score:number, factor:number}}
 */
export function salienceOf({ budgetRatio = 1, enabled = false }) {
  if (enabled !== true) return { enabled: false, score: 1, factor: 1 }
  const r = budgetRatio > 1 ? 1 : budgetRatio < 0 ? 0 : Number(budgetRatio) || 0
  return { enabled: true, score: r, factor: r }
}

/**
 * 写入侧名额：limit × factor，下限 1——收紧是调低量，不是掐死通道
 * （预算全禁走显式开关，不靠截零，「空是诚实」同款边界）。
 * @param {{limit:number, budgetRatio?:number, enabled?:boolean}} p
 * @returns {number}
 */
export function writeCapFor({ limit, budgetRatio = 1, enabled = false }) {
  const { factor } = salienceOf({ budgetRatio, enabled })
  return Math.max(1, Math.round(limit * factor))
}
