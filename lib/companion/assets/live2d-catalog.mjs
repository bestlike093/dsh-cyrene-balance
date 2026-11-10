/**
 * Live2D catalog 解析：把驱动上报的 catalog 结构做成纯函数接口。
 *
 * 结构形状与部位参数表、姿势预设来自 castorice-l2d-driver/0.1.0
 * （web/driver.mjs 的 analyzeCapability / CAPABILITY_PARAMS / POSE_PRESETS），
 * 思路参考鲸语 jingyu-live2d，代码自写。这里只做解析与校验，不碰渲染。
 *
 * catalog 形状（驱动原生输出）：
 *   driver, model, generatedAt,
 *   parameters: [{ index, id, min, max, def }],
 *   expressions: [{ index, name, file }],
 *   motionGroups: { 组名: [{ index, name, file }] },
 *   groups: [{ target, name, ids }], hitAreas: [{ name, id }],
 *   capability: { score, level, levelLabel, can, derived, cannot, present, ... }
 */

/** 部位 → 标准参数名。用来判断这具模型身上有哪些能用的部件。 */
const CAPABILITY_PARAMS = {
  eyes: ['ParamEyeLOpen', 'ParamEyeROpen'],
  eyeBall: ['ParamEyeBallX', 'ParamEyeBallY'],
  brows: ['ParamBrowLY', 'ParamBrowRY', 'ParamBrowLForm', 'ParamBrowRForm'],
  mouth: ['ParamMouthOpenY', 'ParamMouthForm', 'ParamMouthShrug'],
  cheeks: ['ParamCheekPuff', 'ParamCheek'],
  head: ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'],
  body: ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'],
  arms: ['ParamArmLA', 'ParamArmRA', 'ParamHandL', 'ParamHandR'],
  legs: ['ParamLegL', 'ParamLegR'],
  hair: ['ParamHairFront', 'ParamHairSide', 'ParamHairBack'],
  breath: ['ParamBreath'],
}

/** 摆姿势预设：直接压参数，用来拼模型没自带的情绪。照驱动原表保留。 */
const POSE_PRESETS = {
  angry: { ParamBrowLY: -1, ParamBrowRY: -1, ParamBrowLForm: 1, ParamBrowRForm: 1, ParamMouthForm: -1 },
  sad: { ParamBrowLY: 0.2, ParamBrowRY: 0.2, ParamBrowLForm: -1, ParamBrowRForm: -1, ParamMouthForm: -0.9 },
  shy: { ParamBrowLY: 0.35, ParamBrowRY: 0.35, ParamMouthForm: 0.4, ParamCheekPuff: 0.7 },
  surprise: { ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamMouthOpenY: 0.7 },
  sleepy: { ParamEyeLOpen: 0.15, ParamEyeROpen: 0.15, ParamBrowLY: -0.2, ParamBrowRY: -0.2 },
  lookLeft: { ParamEyeBallX: -0.9, ParamAngleX: -18 },
  lookRight: { ParamEyeBallX: 0.9, ParamAngleX: 18 },
}

/** 能力档位标签，与驱动一致。 */
const LEVEL_LABEL = { 5: '很丰富', 4: '丰富', 3: '一般', 2: '单薄', 1: '很少' }

/** 只认最小合法形状：缺参数表或动作组的不是 catalog。 */
export function isCatalogLike(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray(value.parameters) &&
      value.parameters.length > 0 &&
      Array.isArray(value.expressions) &&
      typeof value.motionGroups === 'object' &&
      value.motionGroups !== null
  )
}

/** 解析 catalog：接受 JSON 字符串或对象，结构不对返回 null。 */
export function parseCatalog(raw) {
  let catalog = raw
  if (typeof raw === 'string') {
    try {
      catalog = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!isCatalogLike(catalog)) return null
  return catalog
}

/** 参数 id → min/max 边界表；钳制数值时用它。 */
export function paramBounds(catalog) {
  const bounds = new Map()
  for (const item of catalog.parameters) {
    if (item && typeof item.id === 'string') {
      bounds.set(item.id, {
        min: Number.isFinite(Number(item.min)) ? Number(item.min) : 0,
        max: Number.isFinite(Number(item.max)) ? Number(item.max) : 1,
      })
    }
  }
  return bounds
}

/** 这具模型认识的参数 id 集合。 */
export function paramIds(catalog) {
  return new Set(catalog.parameters.map((item) => item?.id).filter((id) => typeof id === 'string'))
}

/** 表情名清单（顺序照 catalog）。 */
export function expressionNames(catalog) {
  return catalog.expressions.map((item) => item?.name).filter((name) => typeof name === 'string')
}

/** 按名或下标找表情；找不到返回 null。 */
export function resolveExpression(catalog, nameOrIndex) {
  if (nameOrIndex === null || nameOrIndex === undefined) return null
  if (typeof nameOrIndex === 'number') {
    const item = catalog.expressions[nameOrIndex]
    return item && typeof item.name === 'string' ? item : null
  }
  const key = String(nameOrIndex)
  return catalog.expressions.find((item) => item?.name === key) ?? null
}

/** 动作名清单（全组展开，保留重复：同名动作属于不同组时都算）。 */
export function motionNames(catalog) {
  return Object.values(catalog.motionGroups).flat().map((item) => item?.name).filter((name) => typeof name === 'string')
}

/** 动作组名清单。 */
export function motionGroupNames(catalog) {
  return Object.keys(catalog.motionGroups)
}

/**
 * 按名找动作。返回 { group, index, name, file }；多个组同名时返回第一个。
 * 找不到返回 null。
 */
export function resolveMotion(catalog, name) {
  if (name === null || name === undefined) return null
  const key = String(name)
  for (const [group, list] of Object.entries(catalog.motionGroups)) {
    const hit = (Array.isArray(list) ? list : []).find((item) => item?.name === key)
    if (hit) return { group, index: hit.index, name: hit.name, file: hit.file }
  }
  return null
}

/** 姿势预设：只保留这具模型认识的参数，一个都不认识返回 null。 */
export function posePresetFor(catalog, presetName) {
  const raw = POSE_PRESETS[presetName]
  if (!raw) return null
  const known = paramIds(catalog)
  const values = {}
  for (const [id, value] of Object.entries(raw)) {
    if (known.has(id)) values[id] = value
  }
  return Object.keys(values).length > 0 ? values : null
}

/** 预设名清单（照驱动原表）。 */
export function posePresetNames() {
  return Object.keys(POSE_PRESETS)
}

/** 这具模型身上的部位参数：每部位只保留 catalog 里真实存在的 id。 */
export function presentParams(catalog) {
  const known = paramIds(catalog)
  const present = {}
  for (const [part, ids] of Object.entries(CAPABILITY_PARAMS)) {
    present[part] = ids.filter((id) => known.has(id))
  }
  return present
}

/**
 * 能力识别：与驱动 analyzeCapability 同口径，catalog 缺 capability 时重算。
 * 分值只用来定一个大概的档：脸、身体、四肢、表情、动作、头发、呼吸各占一点。
 */
export function analyzeCapability(catalog) {
  const present = presentParams(catalog)
  const expressions = expressionNames(catalog)
  const groups = catalog.motionGroups
  const motions = motionNames(catalog)
  const hasExpressions = expressions.length > 0
  const hasMotions = motions.length > 0
  const has = (key) => Array.isArray(present[key]) && present[key].length > 0

  let score = 0
  if (hasExpressions) score += 1
  if (expressions.length >= 4) score += 1
  if (expressions.length >= 10) score += 1
  if (hasMotions) score += 1
  if (motions.length >= 6) score += 1
  if (has('eyes')) score += 1
  if (has('brows') && has('mouth')) score += 1
  if (has('cheeks')) score += 1
  if (present.head.length >= 2) score += 1
  if (has('body')) score += 1
  if (has('arms')) score += 1
  if (has('legs')) score += 1
  if (has('hair')) score += 1
  if (has('breath')) score += 1

  const level = score >= 12 ? 5 : score >= 9 ? 4 : score >= 6 ? 3 : score >= 3 ? 2 : 1

  const can = []
  if (hasExpressions) can.push(`换 ${expressions.length} 种自带表情`)
  if (hasMotions) {
    const groupsText = Object.entries(groups)
      .map(([group, list]) => `${group}（${list.map((item) => item.name).join('、')}）`)
      .join('；')
    can.push(`做 ${motions.length} 个动作：${groupsText}`)
  }
  if (present.eyeBall.length >= 2) can.push('视线看向指定方向')
  if ((catalog.groups || []).some((group) => String(group.name || '').toLowerCase().includes('eyeblink'))) can.push('自动眨眼')
  if (has('mouth')) can.push('张嘴 / 抿嘴')

  const derived = []
  if (has('brows') && has('mouth')) derived.push('皱眉抿嘴（生气、难过）')
  if (has('cheeks')) derived.push('脸红鼓脸（害羞）')
  if (has('eyes') && has('mouth')) derived.push('睁大眼张嘴（惊讶）')
  if (present.head.length >= 2) derived.push('点头 / 摇头 / 歪头（用头部三轴压出来）')
  if (has('eyeBall')) derived.push('眼球转到指定位置（看过来）')
  if (has('arms')) derived.push('抬手、抱臂')
  if (has('legs')) derived.push('迈步、蹲下')

  const cannot = []
  if (!has('arms')) cannot.push('挥手、抱臂')
  if (!has('legs')) cannot.push('走路、蹲下')
  if (!hasExpressions) cannot.push('切换现成表情')
  if (!hasMotions) cannot.push('播放现成动作')

  return {
    score,
    level,
    levelLabel: LEVEL_LABEL[level],
    can,
    derived,
    cannot,
    present,
    expressions,
    motionGroups: Object.fromEntries(
      Object.entries(groups).map(([group, list]) => [group, list.map((item) => item.name)])
    ),
    motions,
  }
}

/** 完整能力视图：catalog 里已有 capability 就用它，否则重算。 */
export function capabilityOf(catalog) {
  if (catalog.capability && typeof catalog.capability === 'object' && Number.isFinite(catalog.capability.score)) {
    return catalog.capability
  }
  return analyzeCapability(catalog)
}
