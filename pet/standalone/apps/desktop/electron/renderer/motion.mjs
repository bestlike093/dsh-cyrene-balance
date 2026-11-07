/**
 * 动作系统：让心情和 AI 都能驱动立绘动起来。
 *
 * 为什么要有三层通道 —— 实测发现导入的 Live2D 模型 `motionManager.definitions` 是空的：
 * 素材本身没有自带任何 motion，只调 `model.motion()` 会永远静默失败。
 * 所以按「能力从强到弱」排三层，每层都真实可判别，走哪层如实回报：
 *
 *   native  模型自带 motion / expression（素材提供才有）
 *   param   Cubism 标准参数曲线（ParamAngleX 等，绝大多数 Cubism 模型都有）
 *   pixi    DisplayObject 变换（位移/缩放/旋转，任何媒体都吃这套，兜底不空转）
 *
 * 纯逻辑（打分、解析、曲线采样）都导出成函数，方便单测；
 * 只有 controller 碰 DOM 与 Pixi 对象。
 */

/** 三层通道名，状态栏与上报共用同一套字面量。 */
export const MOTION_CHANNELS = ['native', 'param', 'pixi']

/**
 * 内置动作表。每个动作是「几条轨道 + 时长」，轨道决定写哪个参数、幅度多大、摆几个来回。
 *
 * 命名同时是 AI 可用词汇：模型只要报出这里的 key 或中文别名，就能被解析到。
 * `params` 为空表示这个动作只能走 pixi 通道（例如整体弹跳，Cubism 没有对应参数）。
 */
export const ACTION_TABLE = {
  nod: {
    label: '点头',
    duration: 820,
    aliases: ['点头', '同意', '嗯', 'nod'],
    params: [{ id: 'ParamAngleX', amp: 0, cycles: 0 }, { id: 'ParamAngleY', amp: 16, cycles: 2 }],
    pixi: { bounce: 0.16, cycles: 2 }
  },
  shake: {
    label: '摇头',
    duration: 760,
    aliases: ['摇头', '拒绝', '不行', 'shake', 'no'],
    params: [{ id: 'ParamAngleX', amp: 20, cycles: 2 }],
    pixi: { swing: 0.05, cycles: 2 }
  },
  tilt: {
    label: '歪头',
    duration: 1100,
    aliases: ['歪头', '疑惑', '好奇', 'tilt', 'wonder'],
    params: [{ id: 'ParamAngleZ', amp: 18, cycles: 1 }, { id: 'ParamAngleX', amp: 8, cycles: 1 }],
    pixi: { swing: 0.07, cycles: 1 }
  },
  bounce: {
    label: '弹一下',
    duration: 620,
    aliases: ['弹', '跳', '开心', '蹦', 'bounce', 'jump', 'happy'],
    params: [{ id: 'ParamBodyAngleY', amp: 8, cycles: 2 }, { id: 'ParamAngleY', amp: -10, cycles: 2 }],
    pixi: { bounce: 0.22, cycles: 2 }
  },
  sway: {
    label: '轻晃',
    duration: 1600,
    aliases: ['轻晃', '摇', '悠闲', '晃', 'sway', 'relax'],
    params: [{ id: 'ParamBodyAngleX', amp: 10, cycles: 2 }, { id: 'ParamAngleZ', amp: 6, cycles: 2 }],
    pixi: { swing: 0.035, cycles: 2 }
  },
  look: {
    label: '看过来',
    duration: 900,
    aliases: ['看过来', '转头', '注意', 'look', 'attention'],
    params: [{ id: 'ParamAngleX', amp: 24, cycles: 1 }, { id: 'ParamAngleY', amp: -8, cycles: 1 }],
    pixi: { swing: 0.04, cycles: 1 }
  },
  shy: {
    label: '害羞',
    duration: 1300,
    aliases: ['害羞', '脸红', '撒娇', '黏人', 'shy', 'clingy'],
    params: [{ id: 'ParamAngleZ', amp: -14, cycles: 1 }, { id: 'ParamAngleY', amp: 10, cycles: 1 }],
    pixi: { swing: -0.05, cycles: 1 }
  },
  sleepyNod: {
    label: '打瞌睡',
    duration: 1800,
    aliases: ['困', '瞌睡', '打盹', '睡', 'sleepy', 'doze', 'yawn'],
    params: [{ id: 'ParamAngleY', amp: 22, cycles: 1 }, { id: 'ParamEyeLOpen', amp: -0.5, cycles: 1, base: 0.5 }, { id: 'ParamEyeROpen', amp: -0.5, cycles: 1, base: 0.5 }],
    pixi: { bounce: 0.08, cycles: 1 }
  }
}

/**
 * 心情 → 默认动作。
 * level 来自 presence.mjs 的 moodSnapshot，只有 calm / bright / clingy / sleepy 四种。
 * 每种给一串候选，播的时候按顺序找第一个当前模型支持的，避免「映射了但播不出来」。
 */
export const MOOD_ACTIONS = {
  calm: ['sway', 'tilt', 'nod'],
  bright: ['bounce', 'nod', 'look'],
  clingy: ['shy', 'tilt', 'sway'],
  sleepy: ['sleepyNod', 'sway']
}

/** 归一化：小写、去空格与连字符，让 `Tap Body` / `tap_body` / `tapbody` 算同一个。 */
export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '')
}

/**
 * 名字打分：完全相等最高，包含次之，别名再次。
 * 返回 0 表示不匹配。用打分而不是布尔，是为了在多个候选里挑最像的那个。
 */
export function scoreName(query, candidate) {
  const q = normalizeName(query)
  if (q === '') return 0
  const c = normalizeName(candidate)
  if (c === '') return 0
  if (q === c) return 100
  if (c.includes(q) || q.includes(c)) return 60
  return 0
}

/**
 * 在动作表里解析一个请求名（AI 给的词、心情候选都走这里）。
 * 先比 key，再比中文 label 与别名；都不中返回 null，不猜。
 */
export function resolveActionKey(request) {
  if (typeof request !== 'string' || request.trim() === '') return null
  let best = null
  let bestScore = 0
  for (const [key, action] of Object.entries(ACTION_TABLE)) {
    let score = scoreName(request, key)
    score = Math.max(score, scoreName(request, action.label))
    for (const alias of action.aliases) {
      score = Math.max(score, scoreName(request, alias))
    }
    if (score > bestScore) {
      bestScore = score
      best = key
    }
  }
  return bestScore >= 60 ? best : null
}

/** 缓入缓出包络：两端为 0，中间为 1，动作不会硬起硬停。 */
export function envelope(t) {
  if (!(t >= 0) || t >= 1) return 0
  return Math.sin(Math.PI * t) ** 1.4
}

/**
 * 采样一条轨道在时刻 t（0..1）的值。
 * base 用于眼睛这类「默认 1、往下压」的参数；amp 为负表示反向。
 */
export function sampleTrack(track, t) {
  const base = typeof track.base === 'number' ? track.base : 0
  if (track.amp === 0) return base
  const cycles = track.cycles === 0 ? 1 : track.cycles
  return base + track.amp * Math.sin(2 * Math.PI * cycles * t) * envelope(t)
}

/**
 * 探测一个 Live2D / Pixi 模型真实具备哪些动作能力。
 *
 * 只读不写；任何一层拿不到就记 null 或空数组，绝不编造「支持」。
 * 返回结构直接用于状态栏文案与上报给主进程（主进程再喂给模型当可选动作清单）。
 */
export function probeMotionCapability(model) {
  const capability = {
    kind: 'none',
    native: [],
    nativeExpressions: [],
    param: [],
    pixi: false
  }
  if (model === null || typeof model !== 'object') return capability

  const internal = model.internalModel
  if (internal !== null && typeof internal === 'object') {
    capability.kind = 'live2d'
    // 自带 motion：definitions 是 { group: [def...] }，也可能只在 settings.motions 里。
    const manager = internal.motionManager
    const definitions = manager?.definitions ?? internal.settings?.motions ?? null
    if (definitions !== null && typeof definitions === 'object') {
      for (const [group, list] of Object.entries(definitions)) {
        if (!Array.isArray(list)) continue
        list.forEach((def, index) => {
          capability.native.push({
            group,
            index,
            name: typeof def?.File === 'string' ? def.File : `#${index}`,
            channel: 'native'
          })
        })
      }
    }
    const expressions = manager?.expressions ?? internal.settings?.expressions ?? null
    if (Array.isArray(expressions)) {
      capability.nativeExpressions = expressions
        .map((item) => (typeof item === 'string' ? item : item?.Name ?? item?.name ?? ''))
        .filter((name) => name !== '')
    } else if (expressions !== null && typeof expressions === 'object') {
      capability.nativeExpressions = Object.keys(expressions)
    }
    // Cubism 参数：逐个试 getParameterIndex，只有真存在的才算支持。
    const core = internal.coreModel
    if (core !== null && typeof core === 'object') {
      const ids = new Set()
      for (const action of Object.values(ACTION_TABLE)) {
        for (const track of action.params) ids.add(track.id)
      }
      for (const id of ids) {
        if (hasParameter(core, id)) capability.param.push(id)
      }
    }
  } else if (typeof model.texture === 'object' || Array.isArray(model.textures)) {
    capability.kind = 'sprite'
  }

  // Pixi 变换：只要是 DisplayObject（有 position/scale/rotation）就能兜底。
  capability.pixi =
    typeof model.position === 'object' &&
    typeof model.scale === 'object' &&
    (typeof model.rotation === 'number' || typeof model.rotation === 'object')
  return capability
}

/** 参数存在性判定：不同 Cubism 运行时 API 名字不一致，逐个试，失败即视为没有。 */
export function hasParameter(core, id) {
  try {
    if (typeof core.getParameterIndex === 'function') {
      const index = core.getParameterIndex(id)
      // Cubism4 拿到无效 id 时返回 -1 或 undefined；Cubism2 直接抛。
      return typeof index === 'number' && index >= 0
    }
    if (typeof core.getParamIndex === 'function') {
      return core.getParamIndex(id) >= 0
    }
  } catch {
    return false
  }
  return false
}

/** 写一个 Cubism 参数。三种运行时 API 依次试；全失败返回 false，由调用方降级到 pixi。 */
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
 * 动作控制器。
 *
 * 一次只播一个动作：新的请求会顶掉旧的（同 key 且在冷却期内则忽略，避免抽风）。
 * 驱动用调用方给的 ticker（Pixi 的 ticker.add 最合适，和渲染同帧）；
 * 没有 ticker 时退回 requestAnimationFrame。
 */
export function createMotionController(options = {}) {
  const {
    getModel = () => null,
    ticker = null,
    cooldownMs = 900,
    now = () => Date.now(),
    onEvent = null
  } = options

  let capability = null
  let active = null
  let lastPlayedAt = 0
  let lastKey = ''
  let tickerHandler = null
  /** 参数写入失败只记一次，状态栏好如实说明降级原因。 */
  let paramWriteFailed = false

  function emit(payload) {
    if (typeof onEvent === 'function') {
      try {
        onEvent(payload)
      } catch {
        // 观测回调炸了不能影响动作本身
      }
    }
  }

  function refresh() {
    const model = getModel()
    capability = probeMotionCapability(model)
    return capability
  }

  function stop() {
    active = null
    if (tickerHandler !== null) {
      if (ticker !== null && typeof ticker.remove === 'function') ticker.remove(tickerHandler)
      else if (typeof window !== 'undefined') window.cancelAnimationFrame(tickerHandler)
      tickerHandler = null
    }
  }

  /**
   * 播放一个动作。
   * @returns {{ok:boolean, channel?:string, key?:string, reason?:string}}
   *   reason 只在失败时出现，取值 no-model / unknown-action / unsupported / busy。
   */
  function play(request, meta = {}) {
    const model = getModel()
    if (model === null || typeof model !== 'object') {
      return { ok: false, reason: 'no-model' }
    }
    const cap = capability ?? refresh()
    const key = resolveActionKey(request)
    if (key === null) {
      return { ok: false, reason: 'unknown-action' }
    }
    const at = now()
    if (active !== null) return { ok: false, reason: 'busy' }
    // 同一动作冷却期内不重复播；换动作则允许打断后的空档立即播。
    if (key === lastKey && at - lastPlayedAt < cooldownMs) {
      return { ok: false, reason: 'busy' }
    }

    const action = ACTION_TABLE[key]
    const channel = pickChannel(cap, action)
    if (channel === null) {
      return { ok: false, reason: 'unsupported' }
    }

    if (channel === 'native') {
      const hit = pickNativeMotion(cap, action, key)
      if (hit === null) return { ok: false, reason: 'unsupported' }
      try {
        if (hit.expression === true) model.expression(hit.name)
        else model.motion(hit.group, hit.index)
      } catch (error) {
        return { ok: false, reason: `native-failed:${error instanceof Error ? error.message : String(error)}` }
      }
      lastKey = key
      lastPlayedAt = at
      emit({ key, channel: 'native', motion: hit.name, source: meta.source ?? 'auto' })
      return { ok: true, channel: 'native', key }
    }

    // param / pixi 都靠时间曲线驱动，共用一个 ticker。
    const baseline = captureBaseline(model, channel, action)
    active = {
      key,
      channel,
      action,
      startedAt: at,
      duration: action.duration,
      baseline,
      source: meta.source ?? 'auto'
    }
    lastKey = key
    lastPlayedAt = at
    startTicker()
    emit({ key, channel, source: active.source })
    return { ok: true, channel, key }
  }

  function startTicker() {
    if (tickerHandler !== null) return
    const step = () => {
      if (active === null) {
        stop()
        return
      }
      const elapsed = now() - active.startedAt
      const t = Math.min(1, elapsed / active.duration)
      applyFrame(active, t)
      if (t >= 1) {
        restoreBaseline(active)
        const finished = { key: active.key, channel: active.channel, source: active.source }
        active = null
        stop()
        emit({ ...finished, done: true })
      }
    }
    tickerHandler = step
    if (ticker !== null && typeof ticker.add === 'function') ticker.add(step)
    else if (typeof window !== 'undefined') {
      const loop = () => {
        if (active === null) {
          tickerHandler = null
          return
        }
        step()
        if (active !== null) window.requestAnimationFrame(loop)
      }
      tickerHandler = loop
      window.requestAnimationFrame(loop)
    }
  }

  function applyFrame(state, t) {
    const model = getModel()
    if (model === null) return
    if (state.channel === 'param') {
      const core = model.internalModel?.coreModel ?? null
      let wrote = false
      for (const track of state.action.params) {
        if (track.amp === 0) continue
        if (writeParameter(core, track.id, sampleTrack(track, t))) wrote = true
      }
      if (!wrote) paramWriteFailed = true
      return
    }
    applyPixi(model, state, t)
  }

  function applyPixi(model, state, t) {
    const spec = state.action.pixi
    const base = state.baseline
    if (spec === undefined || base === null) return
    const env = envelope(t)
    const cycles = spec.cycles ?? 1
    const wave = Math.sin(2 * Math.PI * cycles * t)
    if (typeof spec.bounce === 'number') {
      const lift = spec.bounce * base.height * wave * env
      model.position.y = base.y - lift
      model.scale.set(base.scaleX, base.scaleY * (1 + wave * env * spec.bounce * 0.4))
    }
    if (typeof spec.swing === 'number') {
      const angle = spec.swing * wave * env
      if (typeof model.rotation === 'number') model.rotation = base.rotation + angle
      else if (typeof model.rotation?.set === 'function') model.rotation.set(base.rx, base.ry, base.rz + angle)
      model.position.x = base.x + angle * base.height * 0.6
    }
  }

  function captureBaseline(model, channel, action) {
    if (channel !== 'pixi') return null
    const box = typeof model.getBounds === 'function' ? model.getBounds() : null
    return {
      x: model.position.x,
      y: model.position.y,
      scaleX: model.scale.x,
      scaleY: model.scale.y,
      rotation: typeof model.rotation === 'number' ? model.rotation : 0,
      rx: model.rotation?.x ?? 0,
      ry: model.rotation?.y ?? 0,
      rz: model.rotation?.z ?? 0,
      height: box !== null ? Math.max(1, box.height) : 200,
      action
    }
  }

  function restoreBaseline(state) {
    const model = getModel()
    if (model === null || state.channel !== 'pixi' || state.baseline === null) return
    const base = state.baseline
    model.position.set(base.x, base.y)
    model.scale.set(base.scaleX, base.scaleY)
    if (typeof model.rotation === 'number') model.rotation = base.rotation
    else if (typeof model.rotation?.set === 'function') model.rotation.set(base.rx, base.ry, base.rz)
  }

  /**
   * 选通道：优先用素材自带 motion（表现最丰富），
   * 没有就用 Cubism 参数（形变自然），再没有就用 Pixi 变换（保证有可见反馈）。
   */
  function pickChannel(cap, action) {
    if (cap === null) return null
    if (cap.native.length > 0 && pickNativeMotion(cap, action) !== null) return 'native'
    if (cap.param.length > 0 && action.params.some((track) => cap.param.includes(track.id))) return 'param'
    if (cap.pixi === true && action.pixi !== undefined) return 'pixi'
    return null
  }

  /**
   * 从素材自带 motion 里挑一个最贴题的。
   * 素材的命名千奇百怪（Tap / tap_body / 01 / motion_03），所以按动作别名打分，
   * 一个都不像就退回 idle 组的第一条 —— 至少是真的播了素材自己的动作。
   */
  function pickNativeMotion(cap, action, key = '') {
    const wanted = key === '' ? [] : [key, ...(ACTION_TABLE[key]?.aliases ?? [])]
    let best = null
    let bestScore = 0
    for (const item of cap.native) {
      const text = `${item.group} ${item.name}`
      for (const word of wanted) {
        const score = scoreName(word, text)
        if (score > bestScore) {
          bestScore = score
          best = item
        }
      }
      if (action !== undefined) {
        for (const alias of action.aliases) {
          const score = scoreName(alias, text)
          if (score > bestScore) {
            bestScore = score
            best = item
          }
        }
      }
    }
    if (best !== null && bestScore >= 60) return best
    const idle = cap.native.find((item) => normalizeName(item.group).includes('idle')) ?? cap.native[0]
    return idle ?? null
  }

  /** 按心情播一个动作；心情没映射或模型不支持都返回失败原因，不静默。 */
  function playForMood(level, meta = {}) {
    const candidates = MOOD_ACTIONS[level] ?? []
    let lastReason = 'unknown-action'
    for (const key of candidates) {
      const result = play(key, { ...meta, source: meta.source ?? 'mood' })
      if (result.ok === true) return result
      lastReason = result.reason ?? lastReason
      // busy 说明已经在动了，没必要再试下一个候选。
      if (lastReason === 'busy') break
    }
    return { ok: false, reason: lastReason }
  }

  /** 状态栏文案：如实说明这台模型能走哪几层、自带几条动作。 */
  function statusText() {
    const cap = capability ?? refresh()
    if (cap.kind === 'none') return '动作：无模型'
    const parts = [`动作 ${cap.kind}`]
    parts.push(`自带 ${cap.native.length}`)
    parts.push(`参数 ${cap.param.length}`)
    parts.push(cap.pixi === true ? 'pixi ✓' : 'pixi ✗')
    if (paramWriteFailed) parts.push('参数写入失败→pixi')
    return parts.join(' · ')
  }

  /** 上报给主进程的可选动作清单：AI 只能从这里挑，挑不出就不动。 */
  function catalog() {
    const cap = capability ?? refresh()
    const playable = []
    for (const [key, action] of Object.entries(ACTION_TABLE)) {
      if (pickChannel(cap, action) !== null) playable.push(key)
    }
    return {
      kind: cap.kind,
      actions: playable,
      labels: Object.fromEntries(playable.map((key) => [key, ACTION_TABLE[key].label])),
      nativeCount: cap.native.length,
      paramCount: cap.param.length,
      pixi: cap.pixi
    }
  }

  return {
    play,
    playForMood,
    refresh,
    stop,
    statusText,
    catalog,
    get capability() {
      return capability ?? refresh()
    },
    get activeKey() {
      return active?.key ?? null
    }
  }
}
