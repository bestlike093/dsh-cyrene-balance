/**
 * 表情系统：把「此刻是什么情绪」变成一张能保持的脸。
 *
 * 和 motion.mjs 的分工：
 *   motion      —— 瞬时动作，播完就还原基线（点头、摇头、弹一下）
 *   expression  —— 持续状态，设定后一直维持，直到下一个情绪或回落 neutral
 *
 * 为什么不能只靠 model.expression()：
 *   实测导入的模型往往没有自带 `.exp3.json`，`Expressions` 数组是空的，
 *   只调模型接口会静默失败。所以这里同样按能力从强到弱分两层：
 *
 *   native  模型自带表情文件（素材提供才有）
 *   param   Cubism 标准面部参数（MouthForm / BrowLY / Cheek / EyeSmile 等）
 *
 * 设计上有两条硬约束：
 *   1. 每帧持续写目标值 —— Cubism 每帧会重置参数，idle 动作也会覆盖，
 *      只写一次的话表情撑不过一帧。
 *   2. 不写 ParamEyeLOpen / ParamEyeROpen —— 那会掐掉眨眼。
 *      需要「眯眼」时用 EyeLSmile / EyeRSmile，让眨眼仍然活着。
 */

/** 表情层能表达的情绪。与 emotion-runtime 的 IMPULSE_BY_EMOTION 对齐。 */
export const EXPRESSION_TAGS = [
  'neutral',
  'happy',
  'excited',
  'shy',
  'gentle',
  'sad',
  'angry',
  'surprised',
  'tired',
  'thinking'
]

/**
 * 情绪 → 面部参数目标值。
 *
 * 数值是「绝对姿态」，不是增量：0 表示回正。
 * Cubism 常用范围 -1 ~ 1；MouthOpen 是 0 ~ 1。
 * 幅度刻意留得保守 —— 桌宠常驻屏幕角落，夸张表情会变成噪音。
 */
export const PARAM_EXPRESSIONS = {
  neutral: {},
  happy: {
    ParamMouthForm: 0.55,
    ParamMouthOpenY: 0.12,
    ParamEyeLSmile: 0.7,
    ParamEyeRSmile: 0.7,
    ParamBrowLY: 0.12,
    ParamBrowRY: 0.12
  },
  excited: {
    ParamMouthForm: 0.7,
    ParamMouthOpenY: 0.35,
    ParamEyeLSmile: 0.85,
    ParamEyeRSmile: 0.85,
    ParamBrowLY: 0.25,
    ParamBrowRY: 0.25,
    ParamCheek: 0.2
  },
  shy: {
    ParamMouthForm: 0.3,
    ParamEyeLSmile: 0.35,
    ParamEyeRSmile: 0.35,
    ParamBrowLY: 0.28,
    ParamBrowRY: 0.28,
    ParamCheek: 0.7
  },
  gentle: {
    ParamMouthForm: 0.32,
    ParamEyeLSmile: 0.38,
    ParamEyeRSmile: 0.38,
    ParamBrowLY: 0.1,
    ParamBrowRY: 0.1
  },
  sad: {
    ParamMouthForm: -0.5,
    ParamBrowLY: -0.55,
    ParamBrowRY: -0.55,
    ParamBrowAngleL: -0.3,
    ParamBrowAngleR: -0.3
  },
  angry: {
    ParamMouthForm: -0.4,
    ParamBrowLY: -0.6,
    ParamBrowRY: -0.6,
    ParamBrowAngleL: -0.5,
    ParamBrowAngleR: -0.5
  },
  surprised: {
    ParamMouthOpenY: 0.5,
    ParamMouthForm: 0.1,
    ParamBrowLY: 0.6,
    ParamBrowRY: 0.6,
    ParamBrowAngleL: 0.2,
    ParamBrowAngleR: 0.2
  },
  tired: {
    ParamMouthForm: -0.15,
    ParamEyeLSmile: -0.2,
    ParamEyeRSmile: -0.2,
    ParamBrowLY: -0.2,
    ParamBrowRY: -0.2
  },
  thinking: {
    ParamMouthForm: -0.1,
    ParamBrowLY: -0.15,
    ParamBrowRY: 0.1,
    ParamBrowAngleL: 0.15,
    ParamBrowAngleR: -0.05
  }
}

/**
 * 心情档位 → 情绪标签。
 *
 * 主进程现在只回 calm / bright / clingy / sleepy 四档。
 * 渲染层优先用 mood.emotion（如果主进程以后补上），没有才退回这张表，
 * 这样上层不必为了表情同步再改一次协议。
 */
export const MOOD_LEVEL_EMOTION = {
  calm: 'gentle',
  bright: 'happy',
  clingy: 'shy',
  sleepy: 'tired'
}

/** 把任意输入收拢到已知情绪；不认识就 neutral，不猜。 */
export function normalizeEmotionTag(value) {
  if (typeof value !== 'string') return 'neutral'
  const tag = value.trim().toLowerCase()
  return EXPRESSION_TAGS.includes(tag) ? tag : 'neutral'
}

/** 名字归一化：`f01` / `F-01` / `f_01` 算同一个。 */
function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '')
}

/**
 * 表情名打分。
 *
 * 素材命名千奇百怪（f01 / happy_01 / 笑顔），所以除了精确匹配，
 * 也接受「包含」和情绪词本身作为弱匹配。低于 60 不认。
 */
export function scoreExpressionName(query, candidate) {
  const q = normalizeName(query)
  const c = normalizeName(candidate)
  if (q === '' || c === '') return 0
  if (q === c) return 100
  if (c.includes(q) || q.includes(c)) return 60
  return 0
}

/**
 * 情绪名在素材里常见的叫法。
 *
 * 中文别名是照着实际素材加的：默认模型的 12 个 Expressions 是道具特效
 * （墨镜 / 问号 / 星星眼 / 圈圈眼 / 开心眼 / 闪耀），没有标准的 happy / sad。
 * 所以这里做的是「能对上就用，对不上就老实走参数通道」，
 * 不为凑映射把「墨镜」硬塞给 angry 这种语义不合的表情。
 */
const EXPRESSION_ALIASES = {
  happy: ['happy', 'joy', 'smile', 'fun', 'laugh', '开心眼', '微笑'],
  excited: ['excited', 'excite', 'joy', '星星眼', '闪耀'],
  shy: ['shy', 'blush', 'embarrass', 'timid', '害羞'],
  gentle: ['gentle', 'calm', 'soft', 'normal', '温柔'],
  sad: ['sad', 'sorrow', 'cry', 'down', '难过'],
  angry: ['angry', 'anger', 'mad', 'annoy', '生气'],
  surprised: ['surprised', 'surprise', 'shock', 'wow', '问号', '惊讶'],
  tired: ['tired', 'sleepy', 'sleep', 'doze', '困'],
  thinking: ['thinking', 'think', 'pensive', '问号'],
  // 「表情回正」是默认模型的重置表情，切回 neutral 时先用它清掉道具特效。
  neutral: ['neutral', 'normal', 'default', 'idle', 'reset', '回正', '表情回正', '平常']
}

/**
 * 在模型自带表情里挑一个最贴情绪的。
 * 找不到返回 null，交给 param 通道，绝不硬塞一个不相关的表情。
 */
export function pickNativeExpression(capability, tag) {
  if (capability === null || typeof capability !== 'object') return null
  const list = Array.isArray(capability.nativeExpressions) ? capability.nativeExpressions : []
  if (list.length === 0) return null

  const wanted = [normalizeEmotionTag(tag), ...(EXPRESSION_ALIASES[tag] ?? [])]
  let best = null
  let bestScore = 0
  for (const name of list) {
    for (let index = 0; index < wanted.length; index += 1) {
      const score = scoreExpressionName(wanted[index], name)
      if (score === 0) continue
      // 别名靠前代表更贴切：都是完全相等时，先写的那个赢。
      // 否则「星星眼」和「闪耀」同分，胜负会由素材顺序随机决定。
      const weighted = score + (wanted.length - index) * 0.01
      if (weighted > bestScore) {
        bestScore = weighted
        best = name
      }
    }
  }
  return bestScore >= 60 ? best : null
}

/** 参数存在性判定：不同 Cubism 运行时 API 名字不一致，逐个试。 */
export function hasParameter(core, id) {
  try {
    if (core !== null && typeof core.getParameterIndex === 'function') {
      const index = core.getParameterIndex(id)
      return typeof index === 'number' && index >= 0
    }
    if (core !== null && typeof core.getParamIndex === 'function') {
      return core.getParamIndex(id) >= 0
    }
  } catch {
    return false
  }
  return false
}

/** 写一个 Cubism 参数；三种 API 依次试，全失败返回 false。 */
export function writeParameter(core, id, value) {
  if (core === null || typeof core !== 'object') return false
  try {
    if (typeof core.setParameterValueById === 'function') {
      core.setParameterValueById(id, value)
      return true
    }
    if (typeof core.setParameterValue === 'function' && typeof core.getParameterIndex === 'function') {
      const index = core.getParameterIndex(id)
      if (typeof index === 'number' && index >= 0) {
        core.setParameterValue(index, value)
        return true
      }
    }
    if (typeof core.setParamFloat === 'function') {
      core.setParamFloat(id, value)
      return true
    }
  } catch {
    return false
  }
  return false
}

/**
 * 探测模型的表情能力。只读不写，拿不到就如实记空。
 *
 * @returns {{kind:string, nativeExpressions:string[], param:string[]}}
 */
export function probeExpressionCapability(model) {
  const capability = { kind: 'none', nativeExpressions: [], param: [] }
  if (model === null || typeof model !== 'object') return capability

  const internal = model.internalModel
  if (internal === null || typeof internal !== 'object') return capability
  capability.kind = 'live2d'

  // 自带表情：不同运行时把清单放在不同层级，逐层认。
  // model3.json 原始结构是 FileReferences.Expressions；有的库会先摊平再挂到 settings。
  const raw =
    internal.settings?.expressions ??
    internal.settings?.Expressions ??
    internal.settings?.FileReferences?.Expressions ??
    internal.motionManager?.expressions ??
    null
  if (Array.isArray(raw)) {
    capability.nativeExpressions = raw
      .map((item) => (typeof item === 'string' ? item : item?.Name ?? item?.name ?? ''))
      .filter((name) => name !== '')
  } else if (raw !== null && typeof raw === 'object') {
    capability.nativeExpressions = Object.keys(raw)
  }

  // 面部参数：表里出现过的都试一遍，只把真存在的记下来。
  const core = internal.coreModel
  if (core !== null && typeof core === 'object') {
    const ids = new Set()
    for (const pose of Object.values(PARAM_EXPRESSIONS)) {
      for (const id of Object.keys(pose)) ids.add(id)
    }
    for (const id of ids) {
      if (hasParameter(core, id)) capability.param.push(id)
    }
  }
  return capability
}

/** 缓入缓出：0→1 用 smoothstep，避免表情硬切。 */
function ease(t) {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * 表情控制器。
 *
 * 常驻一个 ticker：过渡期做插值，稳定后继续每帧写目标值。
 * 后者看起来浪费，但 Cubism 每帧会重置参数，不写就等于没有表情。
 */
export function createExpressionController(options = {}) {
  const {
    getModel = () => null,
    ticker = null,
    transitionMs = 220,
    now = () => Date.now(),
    onEvent = null
  } = options

  let capability = null
  let currentTag = 'neutral'
  /** 当前实际值，用于过渡起点；按参数 id 记。 */
  let currentValues = {}
  /** 目标姿态；稳定后一直写它。 */
  let targetValues = {}
  let startedAt = 0
  let transitioning = false
  let handler = null
  let rafId = null
  /** 参数写入失败只记一次，状态栏好如实说明降级原因。 */
  let paramFailed = false

  function emit(payload) {
    if (typeof onEvent !== 'function') return
    try {
      onEvent(payload)
    } catch {
      // 观测回调炸了不能影响表情本身
    }
  }

  function refresh() {
    capability = probeExpressionCapability(getModel())
    return capability
  }

  /**
   * 参数目标里只保留当前模型真的有的那些，避免每帧白写。
   *
   * neutral 要特别处理：它不是「什么都不写」，而是「把所有表情参数写回 0」。
   * 否则从 sad / shy 切回 neutral 时，上一个姿态会一直僵在脸上 ——
   * Cubism 每帧会保留上一帧的参数值，没人覆盖就不会自己散掉。
   */
  function supportedPose(tag) {
    const normalized = normalizeEmotionTag(tag)
    const cap = capability ?? refresh()
    const allowed = new Set(cap.param)
    const result = {}

    if (normalized === 'neutral') {
      for (const pose of Object.values(PARAM_EXPRESSIONS)) {
        for (const id of Object.keys(pose)) {
          if (allowed.has(id)) result[id] = 0
        }
      }
      return result
    }

    const pose = PARAM_EXPRESSIONS[normalized] ?? {}
    for (const [id, value] of Object.entries(pose)) {
      if (allowed.has(id)) result[id] = value
    }
    return result
  }

  /**
   * 把参数姿态归零一次。
   *
   * 只在切到「自带表情」时用：表情文件会自己接管面部参数，
   * 但我们上一张脸写进去的值还在，不归零就会两层叠在一起。
   * 归零后不再持续写，把控制权完整交给表情文件。
   */
  function flushParamPoseZero(model) {
    const core = model?.internalModel?.coreModel ?? null
    if (core === null) return
    const cap = capability ?? refresh()
    const allowed = new Set(cap.param)
    for (const pose of Object.values(PARAM_EXPRESSIONS)) {
      for (const id of Object.keys(pose)) {
        if (allowed.has(id)) writeParameter(core, id, 0)
      }
    }
  }

  /** 一帧：过渡期插值，稳定后维持目标值。 */
  function tick() {
    const model = getModel()
    if (model === null) return
    const core = model.internalModel?.coreModel ?? null
    if (core === null) return

    const ids = Object.keys(targetValues)
    if (ids.length === 0) return

    const elapsed = now() - startedAt
    const t = transitionMs <= 0 ? 1 : ease(elapsed / transitionMs)
    let wrote = false

    for (const id of ids) {
      const to = targetValues[id] ?? 0
      const from = currentValues[id] ?? 0
      const value = transitioning ? from + (to - from) * t : to
      if (writeParameter(core, id, value)) wrote = true
    }
    if (!wrote) paramFailed = true
    if (transitioning && t >= 1) transitioning = false
  }

  function startTicker() {
    if (handler !== null) return
    handler = () => tick()
    if (ticker !== null && typeof ticker.add === 'function') {
      ticker.add(handler)
      return
    }
    // 没有 Pixi ticker 时退回 rAF；stop() 会把 rafId 清掉。
    if (typeof window !== 'undefined') {
      const loop = () => {
        tick()
        rafId = window.requestAnimationFrame(loop)
      }
      rafId = window.requestAnimationFrame(loop)
    }
  }

  /**
   * 设定当前情绪。
   *
   * 同一个 tag 重复调用不会重播过渡（refreshMood 每 60 秒一拍，
   * 每次都插值会让脸一直在动）；但会重新开始写参数，防止被别的动作覆盖后僵住。
   */
  function apply(tag, meta = {}) {
    const next = normalizeEmotionTag(tag)
    const cap = capability ?? refresh()
    const model = getModel()
    if (model === null || typeof model !== 'object') {
      return { ok: false, reason: 'no-model', tag: next, channel: 'none' }
    }

    // 素材自带表情优先：表现最贴合画师原意。
    const native = pickNativeExpression(cap, next)
    if (native !== null) {
      try {
        model.expression(native)
        // 表情文件接管面部参数之前，先清掉上一张脸留下的姿态。
        flushParamPoseZero(model)
        currentTag = next
        targetValues = {}
        transitioning = false
        emit({ tag: next, channel: 'native', expression: native, source: meta.source ?? 'auto' })
        return { ok: true, tag: next, channel: 'native', expression: native }
      } catch (error) {
        emit({
          tag: next,
          channel: 'native-failed',
          error: error instanceof Error ? error.message : String(error),
          source: meta.source ?? 'auto'
        })
        // 掉到 param 通道继续，不因为自带表情坏了就不做表情。
      }
    }

    const pose = supportedPose(next)
    const ids = Object.keys(pose)
    if (ids.length === 0) {
      // 两层都没有：保持现状，如实回报，不假装换了脸。
      return { ok: false, reason: 'unsupported', tag: next, channel: 'none' }
    }

    const sameTag = next === currentTag && transitioning === false
    if (sameTag && meta.force !== true) {
      // 只是刷新维持，不重新插值。
      targetValues = pose
      startTicker()
      return { ok: true, tag: next, channel: 'param', unchanged: true }
    }

    // 过渡起点取「此刻实际值」；第一次找不到就从中性 0 起。
    currentValues = {}
    for (const id of ids) {
      const from = paramFailed ? 0 : readParameter(model.internalModel?.coreModel, id)
      currentValues[id] = typeof from === 'number' ? from : 0
    }
    targetValues = pose
    startedAt = now()
    // 过渡时长为 0（或动效被关掉）时不该停在「过渡中」，那种状态永远等不到 t>=1。
    transitioning = transitionMs > 0
    currentTag = next
    startTicker()
    if (!transitioning) tick()

    emit({ tag: next, channel: 'param', source: meta.source ?? 'auto' })
    return { ok: true, tag: next, channel: 'param' }
  }

  /** 读当前参数值作过渡起点；读不到就 0（中性），不影响后续写入。 */
  function readParameter(core, id) {
    try {
      if (core !== null && typeof core.getParameterValueById === 'function') {
        const value = core.getParameterValueById(id)
        return typeof value === 'number' ? value : 0
      }
      if (core !== null && typeof core.getParameterIndex === 'function') {
        const index = core.getParameterIndex(id)
        if (typeof index === 'number' && index >= 0 && typeof core.getParameterValue === 'function') {
          return core.getParameterValue(index)
        }
      }
    } catch {
      return 0
    }
    return 0
  }

  /** 回中性：不改变当前情绪记录，只把脸放平。 */
  function reset(meta = {}) {
    return apply('neutral', { ...meta, force: true })
  }

  function stop() {
    transitioning = false
    targetValues = {}
    if (handler !== null && ticker !== null && typeof ticker.remove === 'function') {
      ticker.remove(handler)
    }
    if (rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
    handler = null
  }

  /** 状态栏文案：走哪层、表情叫什么，都写清楚。 */
  function statusText() {
    const cap = capability ?? refresh()
    if (cap.nativeExpressions.length > 0) {
      return `表情：${currentTag} · 自带 ${cap.nativeExpressions.length} 个`
    }
    if (cap.param.length > 0) {
      return `表情：${currentTag} · 参数 ${cap.param.length} 项${paramFailed ? ' · 写入失败' : ''}`
    }
    return '表情：模型不支持'
  }

  function snapshot() {
    return {
      tag: currentTag,
      transitioning,
      paramFailed,
      capability: capability ?? refresh()
    }
  }

  return { apply, reset, refresh, stop, statusText, snapshot }
}
