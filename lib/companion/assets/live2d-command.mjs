/**
 * Live2D 命令构造：把「说什么、做什么表情动作」拼成驱动认识的命令对象。
 *
 * 命令分发表与钳制口径来自 castorice-l2d-driver/0.1.0 的 web/driver.mjs
 * （handleCommand / setPose / clamp），思路参考鲸语 jingyu-live2d，代码自写。
 * 这里只负责构造与钳制，HTTP 递送在渲染端外挂，不在这里碰网络。
 *
 * 命令表（实证，比 AGENT-GUIDE 多 typing / reaction 两个）：
 *   state / expression / motion / stop / typing / say / reaction
 *   zone / bounds / mood / pose / gaze / follow-pointer / params
 */

import {
  paramBounds,
  paramIds,
  posePresetFor,
  resolveExpression,
  resolveMotion,
} from './live2d-catalog.mjs'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/** 表情时长钳制：驱动侧默认 30s 复位，这里只约束不小于 1s。 */
const EXPRESSION_MIN_DURATION = 1000
/** 姿势时长钳制：驱动侧 500ms–120s。 */
const POSE_MIN_DURATION = 500
const POSE_MAX_DURATION = 120000
/** 说话文字上限：气泡放不下的不往里塞。 */
const SAY_TEXT_MAX = 400

/** 按 catalog 的参数边界钳制一组参数值；未知参数直接丢掉。 */
export function clampParams(catalog, values) {
  const known = paramIds(catalog)
  const bounds = paramBounds(catalog)
  const out = {}
  for (const [id, value] of Object.entries(values ?? {})) {
    if (!known.has(id)) continue
    if (!Number.isFinite(Number(value))) continue
    const range = bounds.get(id)
    out[id] = clamp(Number(value), range.min, range.max)
  }
  return out
}

/** 说话命令。expression / motion / mood / pose 都是可选尾巴，编错了静默丢掉。 */
export function buildSayCommand(catalog, text, options = {}) {
  const payload = { cmd: 'say', text: String(text ?? '').slice(0, SAY_TEXT_MAX) }
  const { expression, motion, mood, pose } = options

  if (expression !== undefined && expression !== null) {
    const hit = resolveExpression(catalog, expression)
    if (hit) payload.expression = hit.name
  }
  if (motion !== undefined && motion !== null) {
    const hit = resolveMotion(catalog, motion)
    if (hit) payload.motion = hit
  }
  if (typeof mood === 'string' && mood !== '') payload.mood = mood
  if (pose !== undefined && pose !== null) {
    const preset = typeof pose === 'string' ? posePresetFor(catalog, pose) : clampParams(catalog, pose)
    if (preset && Object.keys(preset).length > 0) payload.pose = preset
  }
  return payload
}

/** 换表情：按名或下标，找不到返回 null。 */
export function buildExpressionCommand(catalog, nameOrIndex, duration = 30000) {
  const hit = resolveExpression(catalog, nameOrIndex)
  if (!hit) return null
  const payload = { cmd: 'expression', name: hit.name }
  if (Number.isFinite(Number(duration))) {
    payload.duration = Math.max(EXPRESSION_MIN_DURATION, Number(duration))
  }
  return payload
}

/** 播动作：按名（自动补组），找不到返回 null。 */
export function buildMotionCommand(catalog, name, group = null, index = null) {
  const hit = resolveMotion(catalog, name)
  if (!hit) return null
  const payload = { cmd: 'motion', name: hit.name, group: group ?? hit.group }
  if (Number.isFinite(Number(index))) payload.index = Number(index)
  return payload
}

/** 情绪面罩命令。mood 名由驱动侧校验，这里只保证不是空串。 */
export function buildMoodCommand(mood, duration = null) {
  if (typeof mood !== 'string' || mood === '') return null
  const payload = { cmd: 'mood', name: mood }
  if (Number.isFinite(Number(duration))) payload.duration = Number(duration)
  return payload
}

/** 摆姿势：预设名或参数表都收，按边界钳制；一个认识的参数都没有返回 null。 */
export function buildPoseCommand(catalog, presetOrParams, duration = 8000) {
  let values = null
  if (typeof presetOrParams === 'string') {
    values = posePresetFor(catalog, presetOrParams)
    if (!values) return null
  } else if (presetOrParams && typeof presetOrParams === 'object') {
    values = clampParams(catalog, presetOrParams)
  }
  if (!values || Object.keys(values).length === 0) return null
  const payload = { cmd: 'pose', params: values }
  if (Number.isFinite(Number(duration))) {
    payload.duration = clamp(Number(duration), POSE_MIN_DURATION, POSE_MAX_DURATION)
  }
  return payload
}

/** 视线指向：x/y 钳到 -1..1。 */
export function buildGazeCommand(x, y) {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null
  return { cmd: 'gaze', x: clamp(Number(x), -1, 1), y: clamp(Number(y), -1, 1) }
}

/** 打字中状态。 */
export function buildTypingCommand(on = true) {
  return { cmd: 'typing', on: on !== false }
}

/** 触摸反应：zone 默认 chest。 */
export function buildReactionCommand(zone = 'chest') {
  return { cmd: 'reaction', zone: typeof zone === 'string' && zone !== '' ? zone : 'chest' }
}

/** 停动作。 */
export function buildStopCommand() {
  return { cmd: 'stop' }
}

/** 读状态快照。 */
export function buildStateCommand() {
  return { cmd: 'state' }
}
