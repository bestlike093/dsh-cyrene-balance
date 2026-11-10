/**
 * 运行时能力成文：Lv.1-5 + 能做什么 / 能拼出什么 / 做不到什么。
 *
 * 算法出处：遐蝶桌宠驱动 live2d-driver（2026-11-10 定版）web/driver.mjs 的
 * analyzeCapability。驱动自述「代码本仓自写，形态参考鲸语 jingyu-live2d（MIT）」。
 * 本仓 lib/companion/assets/live2d-catalog.mjs 已有 catalog 版同名实现
 * （输入是驱动子进程读到的 catalog.json）；这里是渲染层直连模型时
 * 按 probeMotionCapability / probeExpressionCapability 的运行时结果成文。
 */

/**
 * 参数 id → 部位分组。按 Cubism 命名规则分：
 * 眉、嘴、脸颊、眼睛、眼球、头部三轴、身体、手臂、腿、头发、呼吸。
 * 分不上的归 unknown，不计入分值。
 */
const PARAM_ZONE_RULES = [
  { zone: 'eyes', test: /^ParamEye[LR](Open|Smile)$/ },
  { zone: 'eyeBall', test: /EyeBall/ },
  { zone: 'brows', test: /Brow/ },
  { zone: 'mouth', test: /Mouth/ },
  { zone: 'cheeks', test: /Cheek/ },
  { zone: 'head', test: /^ParamAngle[XYZ]$/ },
  { zone: 'body', test: /BodyAngle/ },
  { zone: 'arms', test: /Arm/ },
  { zone: 'legs', test: /Leg/ },
  { zone: 'hair', test: /Hair/ },
  { zone: 'breath', test: /Breath/ },
]

/** 把一串参数 id 按部位分组。 */
export function groupParamsByZone(paramIds) {
  const present = {
    eyes: [],
    eyeBall: [],
    brows: [],
    mouth: [],
    cheeks: [],
    head: [],
    body: [],
    arms: [],
    legs: [],
    hair: [],
    breath: [],
    unknown: [],
  }
  for (const id of Array.isArray(paramIds) ? paramIds : []) {
    const rule = PARAM_ZONE_RULES.find((item) => item.test.test(String(id)))
    present[rule === undefined ? 'unknown' : rule.zone].push(String(id))
  }
  return present
}

const LEVEL_LABEL = { 5: '很丰富', 4: '丰富', 3: '一般', 2: '单薄', 1: '很少' }

/**
 * 输入渲染层两份探测结果，输出和驱动 analyzeCapability 同结构的中文能力描述。
 *
 * @param {object} options
 * @param {object|null} options.motionCapability probeMotionCapability 的结果
 * @param {object|null} options.expressionCapability probeExpressionCapability 的结果
 */
export function describeCapability({ motionCapability = null, expressionCapability = null } = {}) {
  const present = groupParamsByZone(motionCapability?.param ?? [])
  const expressionNames = Array.isArray(expressionCapability?.nativeExpressions)
    ? expressionCapability.nativeExpressions
    : []
  const nativeMotions = Array.isArray(motionCapability?.native) ? motionCapability.native : []
  const motionNames = nativeMotions
    .map((item) => item?.name)
    .filter((name) => typeof name === 'string' && name !== '')

  const hasExpressions = expressionNames.length > 0
  const hasMotions = motionNames.length > 0
  const has = (key) => present[key].length > 0

  let score = 0
  if (hasExpressions) score += 1
  if (expressionNames.length >= 4) score += 1
  if (expressionNames.length >= 10) score += 1
  if (hasMotions) score += 1
  if (motionNames.length >= 6) score += 1
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
  if (hasExpressions) can.push(`换 ${expressionNames.length} 种自带表情`)
  if (hasMotions) {
    const groupsText = nativeMotions
      .map((item) => `${item.group}（${item.name}）`)
      .join('、')
    can.push(`做 ${motionNames.length} 个动作：${groupsText}`)
  }
  if (present.eyeBall.length >= 2) can.push('视线看向指定方向')
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
    expressions: expressionNames,
    motions: motionNames,
  }
}
