// 遐蝶 Live2D 驱动 · 渲染层
//
// 思路参考鲸语 jingyu-live2d 的 web/pet.mjs 与 engine.mjs，代码自写。
// 只做一件事：让一个 Cubism 4 模型在一扇透明窗里站住、呼吸、看人、听命令。
// 模型自带什么就用什么——没写的能力不硬造，参数表从模型自己身上读。
//
// 对外接口由 main.cjs 转进来：POST /api/command   {cmd, ...}
// 状态每两秒上报一次，GET /api/state 可读。

const native = window.l2dPet
const stageEl = document.getElementById('stage')
const canvas = document.getElementById('canvas')
const errorEl = document.getElementById('error')
const dialogEl = document.getElementById('dialog')

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits

const state = {
  ready: false,
  fps: 0,
  expression: null,
  motion: null,
  gaze: null,
  dialog: null,
  params: 0,
  expressions: 0,
}

function showError(error) {
  const message = error?.message || String(error)
  errorEl.style.display = 'block'
  errorEl.textContent = message
  native?.fatal?.(message)
}

/**
 * 能力识别：这具模型能做什么、能拼出什么、做不到什么。
 *
 * 输入是模型自己身上读到的参数（按部位归类）、表情表、动作组。
 * 输出给两处用：控制台显示；以及「把能力告诉她」那条消息，让 agent 知道怎么驱动这具身体。
 */
function analyzeCapability({ present, expressions, motionGroups, motionNames, groups }) {
  const hasExpressions = expressions.length > 0
  const hasMotions = motionNames.length > 0
  const has = (key) => Array.isArray(present[key]) && present[key].length > 0

  // 分值只用来定一个大概的档：脸、身体、四肢、表情、动作、头发、呼吸各占一点。
  let score = 0
  if (hasExpressions) score += 1
  if (expressions.length >= 4) score += 1
  if (expressions.length >= 10) score += 1
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
  const LEVEL_LABEL = { 5: '很丰富', 4: '丰富', 3: '一般', 2: '单薄', 1: '很少' }

  const can = []
  if (hasExpressions) can.push(`换 ${expressions.length} 种自带表情`)
  if (hasMotions) {
    const groupsText = Object.entries(motionGroups)
      .map(([group, list]) => `${group}（${list.map((item) => item.name).join('、')}）`)
      .join('；')
    can.push(`做 ${motionNames.length} 个动作：${groupsText}`)
  }
  if (present.eyeBall.length >= 2) can.push('视线看向指定方向')
  if (groups.some((group) => String(group.name || '').toLowerCase().includes('eyeblink'))) can.push('自动眨眼')
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
    expressions: expressions.map((item) => item.name),
    motionGroups: Object.fromEntries(
      Object.entries(motionGroups).map(([group, list]) => [group, list.map((item) => item.name)])
    ),
    motions: motionNames,
  }
}

async function main() {
  const { url } = await (await fetch('/api/model')).json()

  const app = new PIXI.Application({
    view: canvas,
    resizeTo: stageEl,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
    backgroundAlpha: 0,
    antialias: true,
    powerPreference: 'high-performance',
  })
  app.ticker.maxFPS = 60

  const model = await PIXI.live2d.Live2DModel.from(url, { autoInteract: false, autoUpdate: true })
  app.stage.addChild(model)
  model.anchor.set(0.5, 0)

  const im = model.internalModel
  const core = im.coreModel
  const settings = im.settings || {}

  // —— 模型目录：表情、动作组、参数表，全部从模型自己身上读 ——
  const expressions = (settings.expressions || []).map((item, index) => ({
    index,
    name: String(item.Name || item.File || index),
    file: item.File,
  }))
  const motionGroups = {}
  const fileStem = (file) => String(file || '').split(/[\\/]/).pop().replace(/\.motion3\.json$/i, '')
  for (const [group, list] of Object.entries(settings.motions || {})) {
    motionGroups[group] = (list || []).map((item, index) => ({
      index,
      name: String(item.Name || fileStem(item.File) || `${group}#${index + 1}`),
      file: item.File,
    }))
  }
  const parameters = []
  // Cubism 框架没有公开的「按序号取参数名」接口，这里从模型自己的参数表读。
  // 两个来源都试一下：框架缓存的 _parameterIds，或 core 底层的 parameters.ids。
  const parameterIds = core._parameterIds || core._model?.parameters?.ids || null
  if (parameterIds && typeof core.getParameterCount === 'function') {
    const count = core.getParameterCount()
    for (let i = 0; i < count; i += 1) {
      parameters.push({
        index: i,
        id: String(parameterIds[i] || `#${i}`),
        min: round(core.getParameterMinimumValue(i)),
        max: round(core.getParameterMaximumValue(i)),
        def: round(core.getParameterDefaultValue(i)),
      })
    }
  }
  state.params = parameters.length
  state.expressions = expressions.length

  // —— 情绪：表情文件多半只开特效（ParamKeyN），脸要另用参数压出来 ——
  // 眉（上下 / 变形）、嘴（变形）这几组参数在嘴边和眉梢上见效，先按常见取值试。
  const moods = {
    angry: {
      expression: '009生气',
      face: { ParamBrowLY: -1, ParamBrowRY: -1, ParamBrowLForm: 1, ParamBrowRForm: 1, ParamMouthForm: -1, ParamMouthShrug: 1 },
    },
    sad: {
      expression: '006黑脸',
      face: { ParamBrowLY: 0.2, ParamBrowRY: 0.2, ParamBrowLForm: -1, ParamBrowRForm: -1, ParamMouthForm: -0.9, ParamMouthOpenY: 0, ParamMouthShrug: -1 },
    },
    shy: {
      expression: '016脸红',
      face: { ParamBrowLY: 0.35, ParamBrowRY: 0.35, ParamMouthForm: 0.4, ParamCheekPuff: 0.7 },
    },
  }
  const expressionMoods = {
    '009生气': 'angry',
    '006黑脸': 'sad',
    '014流泪': 'sad',
    '015泪光': 'sad',
    '016脸红': 'shy',
  }
  const EXPRESSION_TIMEOUT = 30000
  let mood = null
  let expressionDeadline = 0

  // 表情/情绪到点回默认。这里不用 setTimeout 当唯一依据——
  // 窗口长时间没人理、或系统休眠时，定时器会停，醒过来再看时钟就行。
  function resetExpressionToDefault() {
    expressionDeadline = 0
    mood = null
    state.expression = null
    try {
      im.motionManager?.expressionManager?.resetExpression?.()
    } catch {}
  }

  function scheduleExpressionReset(duration = EXPRESSION_TIMEOUT) {
    expressionDeadline = Date.now() + Math.max(1000, Number(duration) || EXPRESSION_TIMEOUT)
  }

  app.ticker.add(() => {
    if (expressionDeadline && Date.now() >= expressionDeadline) resetExpressionToDefault()
    if (poseDeadline && Date.now() >= poseDeadline) clearPose()
  })
  im.on('beforeModelUpdate', () => {
    if (mood) {
      for (const [id, value] of Object.entries(moods[mood].face)) {
        try {
          core.setParameterValueById(id, value)
        } catch {}
      }
    }
    // 拼出来的姿势压在情绪上面：模型没有内置的表情，可以这样临时捏一张脸
    if (poseValues !== null) {
      for (const [id, value] of Object.entries(poseValues)) {
        try {
          core.setParameterValueById(id, Number(value))
        } catch {}
      }
    }
  })

  // —— 摆姿势：直接压参数，用来拼模型没自带的情绪 ——
  // 预设照常见取值调过；也可以直接给参数名，让别的智能体自己捏。
  const POSE_PRESETS = {
    angry: { ParamBrowLY: -1, ParamBrowRY: -1, ParamBrowLForm: 1, ParamBrowRForm: 1, ParamMouthForm: -1 },
    sad: { ParamBrowLY: 0.2, ParamBrowRY: 0.2, ParamBrowLForm: -1, ParamBrowRForm: -1, ParamMouthForm: -0.9 },
    shy: { ParamBrowLY: 0.35, ParamBrowRY: 0.35, ParamMouthForm: 0.4, ParamCheekPuff: 0.7 },
    surprise: { ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamMouthOpenY: 0.7 },
    sleepy: { ParamEyeLOpen: 0.15, ParamEyeROpen: 0.15, ParamBrowLY: -0.2, ParamBrowRY: -0.2 },
    lookLeft: { ParamEyeBallX: -0.9, ParamAngleX: -18 },
    lookRight: { ParamEyeBallX: 0.9, ParamAngleX: 18 },
  }
  let poseValues = null
  let poseDeadline = 0

  function setPose(presetOrParams, duration = 8000) {
    let values = null
    if (typeof presetOrParams === 'string') {
      values = POSE_PRESETS[presetOrParams] ?? null
      if (values === null) return { ok: false, error: `没有这个姿势：${presetOrParams}` }
    } else if (presetOrParams && typeof presetOrParams === 'object') {
      values = presetOrParams
    } else {
      return { ok: false, error: '缺少预设名或参数表' }
    }
    const known = {}
    for (const [id, value] of Object.entries(values)) {
      if (!Number.isFinite(Number(value))) continue
      if (!paramIds.has(id)) continue
      known[id] = Number(value)
    }
    if (Object.keys(known).length === 0) return { ok: false, error: '没有一个是这具模型认识的参数' }
    poseValues = known
    poseDeadline = Date.now() + Math.max(500, Math.min(120000, Number(duration) || 8000))
    state.pose = { ...known }
    return { ok: true, pose: { ...known }, duration }
  }

  function clearPose() {
    poseValues = null
    poseDeadline = 0
    state.pose = null
    return { ok: true, pose: null }
  }

  // —— 能力识别：这具模型能做什么、能拼出什么、做不到什么 ——
  // 每次载入（含换模型）都会重算一次，结果随目录一起交给控制台。
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
  const paramIds = new Set(parameters.map((item) => item.id))
  const presentParams = {}
  for (const [key, ids] of Object.entries(CAPABILITY_PARAMS)) {
    presentParams[key] = ids.filter((id) => paramIds.has(id))
  }
  const motionNames = Object.values(motionGroups).flat().map((item) => item.name)
  const capability = analyzeCapability({
    present: presentParams,
    expressions,
    motionGroups,
    motionNames,
    groups: (settings.groups || []).map((group) => ({ target: group.Target, name: group.Name, ids: group.Ids })),
  })

  native?.catalog(JSON.stringify({
    driver: 'castorice-l2d-driver/0.1.0',
    model: url,
    generatedAt: new Date().toISOString(),
    parameters,
    expressions,
    motionGroups,
    groups: (settings.groups || []).map((g) => ({ target: g.Target, name: g.Name, ids: g.Ids })),
    hitAreas: (settings.hitAreas || []).map((h) => ({ name: h.Name, id: h.Id })),
    capability,
  }))

  // —— 自适应窗口 ——
  // 拖动中冻结重排：Windows 搬透明窗时每挪一下就会把外框补大 1~2px，
  // 如果每一下都跟着 resize + 重算模型缩放，画面就是高频地闪。
  // 拖动时让画布自己拉伸，松手再精确重排一次。
  let dragActive = false
  function fit() {
    if (dragActive) return
    const width = stageEl.clientWidth
    const height = stageEl.clientHeight
    if (!width || !height) return
    app.renderer.resize(width, height)
    const originalWidth = im.originalWidth || 1
    const originalHeight = im.originalHeight || 1
    // 头顶留出气泡的位置，模型整体往下挪一点
    const scale = Math.min((width * 0.98) / originalWidth, (height * 0.9) / originalHeight)
    model.scale.set(scale)
    model.position.set(width / 2, height * 0.13)
  }
  fit()
  new ResizeObserver(fit).observe(stageEl)

  // —— 视线 ——
  let gazeOverride = null
  let followPointer = true
  function setGaze(x, y) {
    im.focusController?.focus(clamp(x, -1, 1), clamp(y, -1, 1))
    state.gaze = { x: round(clamp(x, -1, 1)), y: round(clamp(y, -1, 1)) }
  }
  function clearGaze() {
    im.focusController?.focus(0, 0)
    state.gaze = null
  }
  stageEl.addEventListener('pointermove', (event) => {
    if (!followPointer || gazeOverride) return
    const rect = canvas.getBoundingClientRect()
    setGaze(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1))
  })
  stageEl.addEventListener('pointerleave', () => {
    if (!gazeOverride) clearGaze()
  })

  // —— 摸到哪里算哪个部位 ——
  // 比例照这具 chibi 模型量过：包围盒 y≈83..499（CSS px），
  // 头顶 0.05、眼睛 0.58、下巴 0.67、腰 0.79、裙摆 0.92、脚 0.98。
  const ZONE_BANDS = [
    { until: 0.5, id: 'head' },
    { until: 0.67, id: 'face' },
    { until: 0.73, id: 'shoulder' },
    { until: 0.79, id: 'chest' },
    { until: 0.88, id: 'waist' },
    { until: 0.945, id: 'skirt' },
    { until: 1.01, id: 'foot' },
  ]

  /** 返回 { zone, relY, relX }：部位名给主进程写进那句话，比例留给排查用。 */
  function zoneAt(bounds, x, y) {
    const height = Math.max(1, bounds.height)
    const width = Math.max(1, bounds.width)
    const relY = Math.min(1, Math.max(0, (y - bounds.y) / height))
    const relX = Math.min(1, Math.max(0, (x - bounds.x) / width))
    const band = ZONE_BANDS.find((item) => relY < item.until) ?? ZONE_BANDS[ZONE_BANDS.length - 1]
    return { zone: band.id, relY: round(relY, 3), relX: round(relX, 3) }
  }

  // —— 拖动模型移动窗口 / 点一下算互动 ——
  let press = null
  stageEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const bounds = model.getBounds()
    const x = event.clientX
    const y = event.clientY
    const inside = x >= bounds.x - 14 && x <= bounds.x + bounds.width + 14 && y >= bounds.y - 14 && y <= bounds.y + bounds.height + 14
    console.log(
      `[pointer] down x=${Math.round(x)} y=${Math.round(y)} inside=${inside} zone=${
        inside ? zoneAt(bounds, x, y).zone : '-'
      } el=${document.elementFromPoint(x, y)?.id || document.elementFromPoint(x, y)?.tagName || '?'}`
    )
    if (!inside) return
    const touch = zoneAt(bounds, x, y)
    press = {
      id: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      time: performance.now(),
      moved: false,
      zone: touch.zone,
      relY: touch.relY,
      relX: touch.relX,
    }
    stageEl.setPointerCapture?.(event.pointerId)
    native?.dragStart?.({ x: event.screenX, y: event.screenY })
  })

  // —— 拖动时把画面钉住 ——
  // 窗口被系统撑大时，活动的东西只有「钉在窗口边上」的那几块：底下输入框会往下坠，
  // 画布也会跟着窗口变高变宽。所以拖动期间把 body 和画布都钉在开始时的像素尺寸，
  // 等主进程收完尺寸再解除，松手时就不会看到「先变大再缩回」。
  let dragPin = null
  function pinToDragSize() {
    if (dragPin !== null) return
    const width = Math.max(1, stageEl.clientWidth)
    const height = Math.max(1, stageEl.clientHeight)
    dragPin = { width, height }
    document.body.style.width = `${width}px`
    document.body.style.height = `${height}px`
    stageEl.style.width = `${width}px`
    stageEl.style.height = `${height}px`
  }
  function releasePin() {
    if (dragPin === null) return
    dragPin = null
    document.body.style.width = ''
    document.body.style.height = ''
    stageEl.style.width = ''
    stageEl.style.height = ''
  }

  // 拖动时按帧发位置：pointermove 比屏幕刷新还密，逐条发 IPC 只会让窗口抖。
  let dragFrame = 0
  let dragPoint = null
  stageEl.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id) return
    const dx = event.screenX - press.startX
    const dy = event.screenY - press.startY
    if (!press.moved && Math.hypot(dx, dy) > 6) {
      press.moved = true
      dragActive = true
      document.body.classList.add('dragging')
      pinToDragSize()
    }
    if (!press.moved) return
    dragPoint = { x: event.screenX, y: event.screenY }
    if (dragFrame !== 0) return
    dragFrame = requestAnimationFrame(() => {
      dragFrame = 0
      if (dragPoint !== null) native?.dragMove?.(dragPoint)
    })
  })

  // 主进程收完窗口尺寸后通知：这时才解除钉住并重排一次。
  let settleTimer = 0
  function settleDrag() {
    if (settleTimer !== 0) {
      clearTimeout(settleTimer)
      settleTimer = 0
    }
    dragActive = false
    releasePin()
    fit()
  }
  native?.onDragSettled?.(() => settleDrag())

  stageEl.addEventListener('pointerup', (event) => {
    if (!press || event.pointerId !== press.id) return
    const { zone, relY, relX, moved } = press
    console.log(`[pointer] up zone=${zone} moved=${moved} relY=${relY}`)
    press = null
    document.body.classList.remove('dragging')
    native?.dragEnd?.()
    if (moved) {
      // 正常情况下等主进程的 drag-settled；万一没等到，600ms 后自己收。
      if (settleTimer !== 0) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => settleDrag(), 600)
    } else {
      react(zone, { bridge: true, relY, relX })
    }
  })

  stageEl.addEventListener('pointercancel', () => {
    if (!press) return
    press = null
    dragActive = false
    document.body.classList.remove('dragging')
    releasePin()
    native?.dragEnd?.()
  })

  // —— 右上角的拖动柄 ——
  // 透明窗只有立绘那一块收得到鼠标，手一离开它就收不到 hover 了；
  // 所以柄不能跟着 hover 走：亮一次留五秒，够手挪过去按。
  const gripEl = document.getElementById('grip')
  let gripTimer = 0
  function flashGrip() {
    if (gripEl === null) return
    gripEl.classList.add('show')
    clearTimeout(gripTimer)
    gripTimer = setTimeout(() => gripEl.classList.remove('show'), 5000)
  }
  flashGrip()
  for (const target of [stageEl, document.getElementById('saybar'), document.getElementById('dialog')]) {
    if (target === null) continue
    target.addEventListener('pointermove', flashGrip, { passive: true })
    target.addEventListener('pointerdown', flashGrip, { passive: true })
  }

  // 柄也走自己这条拖动：原来的 app-region drag 交给系统，会把透明窗撑大、画面抖。
  let gripDrag = null
  if (gripEl !== null) {
    gripEl.addEventListener('pointerenter', () => {
      gripEl.classList.add('show')
      clearTimeout(gripTimer)
    })
    gripEl.addEventListener('pointerleave', flashGrip)
    gripEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      gripDrag = { startX: event.screenX, startY: event.screenY, moved: false }
      gripEl.setPointerCapture?.(event.pointerId)
    })
    gripEl.addEventListener('pointermove', (event) => {
      if (gripDrag === null) return
      const dx = event.screenX - gripDrag.startX
      const dy = event.screenY - gripDrag.startY
      if (!gripDrag.moved && Math.hypot(dx, dy) > 3) {
        gripDrag.moved = true
        dragActive = true
        pinToDragSize()
        native?.dragStart?.({ x: event.screenX, y: event.screenY })
      }
      if (!gripDrag.moved) return
      dragPoint = { x: event.screenX, y: event.screenY }
      if (dragFrame !== 0) return
      dragFrame = requestAnimationFrame(() => {
        dragFrame = 0
        if (dragPoint !== null) native?.dragMove?.(dragPoint)
      })
    })
    gripEl.addEventListener('pointerup', () => {
      if (gripDrag === null) return
      const moved = gripDrag.moved
      gripDrag = null
      flashGrip()
      if (!moved) return
      native?.dragEnd?.()
      if (settleTimer !== 0) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => settleDrag(), 600)
    })
  }

  // —— 表情与动作 ——
  function playExpression(query, { keepMood = false, duration = EXPRESSION_TIMEOUT } = {}) {
    if (query == null) return { ok: false, error: '缺少 name 或 index' }
    let index = expressions.findIndex((item) => item.name === String(query))
    if (index < 0) index = expressions.findIndex((item) => item.index === Number(query))
    if (index < 0) return { ok: false, error: `没有这个表情：${query}` }
    const name = expressions[index].name
    model.expression(index)
    state.expression = name
    // 表情文件只开特效的，顺手把脸也换成对得上的情绪
    if (!keepMood) {
      mood = expressionMoods[name] || null
      scheduleExpressionReset(duration)
    }
    return { ok: true, index, name, mood }
  }

  function setMood(name, duration = EXPRESSION_TIMEOUT) {
    const key = name == null ? null : String(name)
    if (key === null || key === 'none' || key === 'calm') {
      resetExpressionToDefault()
      return { ok: true, mood: null }
    }
    const preset = moods[key]
    if (!preset) return { ok: false, error: `没有这个情绪：${key}` }
    mood = key
    if (preset.expression) {
      const result = playExpression(preset.expression, { keepMood: true })
      if (!result.ok) return result
    }
    scheduleExpressionReset(duration)
    return { ok: true, mood: key, expression: preset.expression || null }
  }

  function playMotion(group, index, name) {
    let targetGroup = group
    let targetIndex = index
    if (name != null) {
      for (const [candidate, list] of Object.entries(motionGroups)) {
        const hit = list.find((item) => item.name === String(name))
        if (hit) {
          targetGroup = candidate
          targetIndex = hit.index
          break
        }
      }
      if (targetGroup == null) return { ok: false, error: `没有这个动作：${name}` }
    }
    if (targetGroup == null) return { ok: false, error: '缺少 group' }
    const list = motionGroups[targetGroup]
    if (!list) return { ok: false, error: `没有这个动作组：${targetGroup}` }
    const resolved = Number.isInteger(Number(targetIndex)) && Number(targetIndex) >= 0 && Number(targetIndex) < list.length
      ? Number(targetIndex)
      : Math.floor(Math.random() * list.length)
    model.motion(targetGroup, resolved)
    state.motion = `${targetGroup}#${resolved} · ${list[resolved].name}`
    return { ok: true, group: targetGroup, index: resolved, name: list[resolved].name }
  }

  function stopMotions() {
    im.motionManager?.stopAllMotions?.()
    im.motionManager?.stopCurrentMotion?.()
    state.motion = null
    resetExpressionToDefault()
    clearPose()
    return { ok: true }
  }

  // —— 对话框 ——
  // 左边可以挂一张表情（[图:id] 经插件转成 emojiUrl），右边是字。
  const dialogText = document.getElementById('dialog-text')
  const dialogEmoji = document.getElementById('dialog-emoji')
  let dialogTimer = 0
  let typeTimer = 0
  let dialogEmojiUrl = ''
  function setBubbleEmoji(url) {
    dialogEmojiUrl = typeof url === 'string' ? url : ''
    if (dialogEmojiUrl === '') {
      dialogEmoji.classList.remove('show')
      dialogEmoji.removeAttribute('src')
      return
    }
    dialogEmoji.src = dialogEmojiUrl
    dialogEmoji.classList.add('show')
  }

  /** 等回复时的三个点：气泡里只转小点，不显示字。 */
  function setThinking(on) {
    clearTimeout(dialogTimer)
    clearInterval(typeTimer)
    dialogEl.classList.remove('typing')
    if (!on) {
      state.thinking = false
      return { ok: true, thinking: false }
    }
    dialogText.textContent = ''
    setBubbleEmoji('')
    dialogEl.classList.add('show', 'typing')
    state.thinking = true
    state.dialog = null
    state.dialogEmoji = null
    return { ok: true, thinking: true }
  }

  /** 气泡的最小宽度：大约两个立绘宽，但在窗口里放不下就收到 96%。 */
  function bubbleMinWidth() {
    const stageWidth = Math.max(1, stageEl.clientWidth)
    let charWidth = stageWidth * 0.6
    try {
      charWidth = Math.max(1, model.getBounds().width * 0.6)
    } catch {
      /* 拿不到包围盒就用窗口宽估 */
    }
    return Math.min(Math.round(stageWidth * 0.96), Math.round(charWidth * 2))
  }

  /** 一句一句吐出来，比整段砸下来自然。 */
  function say(text, duration = 4500, options = {}) {
    const value = String(text ?? '').trim()
    const emojiUrl = typeof options?.emojiUrl === 'string' ? options.emojiUrl : ''
    clearTimeout(dialogTimer)
    clearInterval(typeTimer)
    dialogEl.classList.remove('typing')
    state.thinking = false
    if (!value && emojiUrl === '') {
      dialogEl.classList.remove('show')
      dialogEl.style.minWidth = ''
      setBubbleEmoji('')
      state.dialog = null
      state.dialogEmoji = null
      return { ok: true, dialog: null }
    }
    const hold = Math.max(800, Math.min(30000, Number(duration) || 4500))
    setBubbleEmoji(emojiUrl)
    dialogEl.style.minWidth = `${bubbleMinWidth()}px`
    dialogEl.classList.add('show')
    state.dialog = value
    state.dialogEmoji = emojiUrl === '' ? null : emojiUrl
    if (value === '') {
      dialogText.textContent = ''
      dialogTimer = setTimeout(() => {
        dialogEl.classList.remove('show')
        dialogEl.style.minWidth = ''
        state.dialog = null
        state.dialogEmoji = null
      }, hold)
      return { ok: true, dialog: '', emoji: emojiUrl === '' ? null : emojiUrl }
    }
    // 打字速度：整句控制在 0.6~2.4 秒之间，句子越长每个字越快
    const chars = Array.from(value)
    const perChar = Math.max(16, Math.min(60, Math.round(1800 / chars.length)))
    let shown = 0
    dialogText.textContent = ''
    typeTimer = setInterval(() => {
      shown += 1
      dialogText.textContent = chars.slice(0, shown).join('')
      if (shown >= chars.length) {
        clearInterval(typeTimer)
        typeTimer = 0
      }
    }, perChar)
    dialogTimer = setTimeout(() => {
      clearInterval(typeTimer)
      typeTimer = 0
      dialogEl.classList.remove('show')
      dialogEl.style.minWidth = ''
      state.dialog = null
      state.dialogEmoji = null
    }, hold + chars.length * perChar)
    return { ok: true, dialog: value, emoji: emojiUrl === '' ? null : emojiUrl }
  }

  // —— 回复里带的动作 / 表情 ——
  // [动作:名称] 里的名字按这张表落到模型自带的动作组上；模型没有的动作找相近的。
  const ACTION_MAP = {
    点头: ['小动作', '点头'],
    摇头: ['小动作', '摇头'],
    歪头: ['小动作', '歪头'],
    张望: ['小动作', '张望'],
    看过来: ['小动作', '张望'],
    害羞: ['小动作', '歪头'],
    轻晃: ['小动作', '歪头'],
    弹一下: ['小动作', '点头'],
    打瞌睡: ['Sleep', null],
  }
  // 表情图 id 顺手带一下脸上的表情，让脸和贴纸对得上。
  const EMOJI_EXPRESSION = {
    'xd-happy': '013星星眼',
    'xd-proud': '008爱心眼',
    'xd-shy': '016脸红',
    'xd-gentle': '016脸红',
    'xd-sad': '015泪光',
    'xd-cry': '014流泪',
    'xd-angry': '009生气',
    'xd-thinking': '012O.O',
    'xd-surprised': '012O.O',
    'xd-sleepy': '019ZZZ',
    'xd-goodnight': '019ZZZ',
    'xd-sorry': '015泪光',
    hmph: '009生气',
    Madnow: '009生气',
    shyshort: '016脸红',
    sleepynow: '019ZZZ',
    goodnight: '019ZZZ',
    Thumbsup: '013星星眼',
    sogood: '013星星眼',
    sonice: '013星星眼',
    thinking: '012O.O',
  }

  /** 按名字做动作：先查别名表，再查模型自己的动作组。别名第二项是动作名，不是下标。 */
  function playActionByName(name) {
    const key = String(name ?? '').trim()
    if (key === '') return false
    const mapped = ACTION_MAP[key] ?? null
    let group = mapped === null ? null : mapped[0]
    let wanted = mapped === null ? null : mapped[1]
    if (mapped === null) {
      for (const [candidate, list] of Object.entries(motionGroups)) {
        const hit = list.find((item) => item.name === key)
        if (hit) {
          group = candidate
          wanted = hit.name
          break
        }
      }
      if (group === null) return false
    }
    try {
      const list = motionGroups[group] ?? []
      const hit = wanted === null ? null : list.find((item) => item.name === wanted)
      const resolved = hit !== null && hit !== undefined
        ? hit.index
        : Math.floor(Math.random() * Math.max(1, list.length))
      model.motion(group, resolved)
      state.motion = `${group}#${resolved}${list[resolved]?.name ? ' · ' + list[resolved].name : ''}`
      if (key === '害羞') playExpression('016脸红')
      return true
    } catch {
      return false
    }
  }

  /** 依表情图配一张脸；没有对应关系的贴纸就不动表情。 */
  function applyEmojiExpression(emojiId) {
    const name = EMOJI_EXPRESSION[String(emojiId ?? '')]
    if (name === undefined) return false
    try {
      if (!expressions.some((item) => item.name === name)) return false
      playExpression(name)
      return true
    } catch {
      return false
    }
  }

  /** 一句回复落地：气泡字 + 表情图 + 模型动作/表情。 */
  function presentReply(reply, options = {}) {
    const text = String(reply ?? '').trim()
    if (text === '' && !options.emojiUrl) return null
    const bubble = text.length > 60 ? text.slice(0, 60) + '…' : text
    say(bubble, 12000, { emojiUrl: options.emojiUrl })
    playActionByName(options.motion)
    if (options.emoji) applyEmojiExpression(options.emoji)
    return bubble
  }

  // 底部输入框：回车或点「说」都行。
  // 打完的话不再只挂在本地气泡上——走和触摸同一条桥递进 DSH，
  // 她回什么，气泡就出什么；桥断了至少让本地应一声，别像没听见。
  const sayInput = document.getElementById('say-input')
  const saySend = document.getElementById('say-send')
  let saying = false
  async function sendFromInput() {
    if (saying) return
    const text = sayInput.value.trim()
    if (!text) return
    sayInput.value = ''
    saying = true
    // 先转三个点：她在想，不是在装死
    setThinking(true)
    try {
      const result = await native?.say?.(text)
      const reply = typeof result?.reply === 'string' ? result.reply.trim() : ''
      if (reply !== '' || result?.emojiUrl) {
        presentReply(reply, { emojiUrl: result?.emojiUrl, emoji: result?.emoji, motion: result?.motion })
      } else if (result?.ok === true) {
        // 话递到了，只是那边还没回（会话忙，或者这一轮还没收尾）
        setThinking(false)
        say('……话递过去了。她还没回。', 4200)
      } else {
        setThinking(false)
        say('……我听见了。那边的会话没接上。', 4200)
      }
    } catch {
      say('……我听见了。那边的会话没接上。', 4200)
    } finally {
      saying = false
    }
  }
  saySend.addEventListener('click', sendFromInput)
  // 中文输入法里：第一次回车是「上屏」，keydown 属于 composing；上屏完成后补发的 keyup 才是真正的回车
  sayInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      sendFromInput()
    }
  })
  sayInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' && !event.isComposing) sendFromInput()
  })

  // —— 点一下算互动：摸头会躲，碰身体会应声 ——
  // zone 现在分六段（head / face / shoulder / chest / waist / skirt），
  // 本地先演一套反应，具体部位靠主进程写进递给 DSH 的那句话。
  const reactions = {
    head: [
      { expression: '016脸红', motion: ['小动作', 2], line: '……别摸头。' },
      { expression: '016脸红', motion: ['小动作', 2], line: '抱歉，头发会乱的。' },
      { expression: '017呆呆眼', motion: ['小动作', 2], line: '……有点痒。' },
    ],
    face: [
      { expression: '016脸红', motion: ['小动作', 2], line: '……脸，有点烫。' },
      { expression: '016脸红', motion: ['小动作', 2], line: '嗯……我在这里。' },
      { expression: '017呆呆眼', motion: ['小动作', 2], line: '……看太近了。' },
    ],
    shoulder: [
      { expression: '013星星眼', motion: ['小动作', 0], line: '我在。' },
      { expression: '013星星眼', motion: ['小动作', 0], line: '肩……有点沉。' },
      { expression: '015泪光', motion: ['小动作', 3], line: '……你累了吗？' },
    ],
    chest: [
      { expression: '016脸红', motion: ['小动作', 2], line: '……这里，太近了。' },
      { expression: '013星星眼', motion: ['小动作', 0], line: '嗯，我在听。' },
      { expression: '017呆呆眼', motion: ['小动作', 2], line: '……心跳会听见的。' },
    ],
    waist: [
      { expression: '016脸红', motion: ['小动作', 2], line: '……抱歉，有点痒。' },
      { expression: '013星星眼', motion: ['小动作', 0], line: '怎么了？' },
      { expression: '015泪光', motion: ['小动作', 3], line: '……你冷吗？' },
    ],
    skirt: [
      { expression: '017呆呆眼', motion: ['小动作', 2], line: '……裙摆，会乱的。' },
      { expression: '013星星眼', motion: ['小动作', 0], line: '我在这儿。' },
      { expression: '016脸红', motion: ['小动作', 2], line: '……小心脚下。' },
    ],
    foot: [
      { expression: '017呆呆眼', motion: ['小动作', 2], line: '……脚踝会怕痒的。' },
      { expression: '013星星眼', motion: ['小动作', 0], line: '站得稳，别担心。' },
      { expression: '016脸红', motion: ['小动作', 2], line: '……那里也要摸吗。' },
    ],
  }

  let lastTouchBridge = 0
  async function react(zone, { bridge = false, relY = null, relX = null } = {}) {
    const list = reactions[zone] || reactions.chest
    const pick = list[Math.floor(Math.random() * list.length)]
    try {
      if (pick.expression) playExpression(pick.expression)
      if (pick.motion) playMotion(pick.motion[0], pick.motion[1])
    } catch {}
    // 点一下先做动作；把「被摸 / 被戳」和部位一起递进 DSH 那间屋子，她回话就念出来。
    if (bridge && native?.touch && Date.now() - lastTouchBridge > 1200) {
      lastTouchBridge = Date.now()
      // 先转三个点等她；十五秒还没回音，再出本地那句顶上。
      setThinking(true)
      const fallback = setTimeout(() => {
        setThinking(false)
        say(pick.line, 4200)
      }, 15000)
      try {
        const result = await native.touch({ zone, relY, relX })
        clearTimeout(fallback)
        if (result?.reply) {
          const bubble = presentReply(result.reply, {
            emojiUrl: result.emojiUrl,
            emoji: result.emoji,
            motion: result.motion,
          })
          return { ok: true, zone, line: bubble, bridged: true }
        }
      } catch {}
      clearTimeout(fallback)
      setThinking(false)
      say(pick.line, 4200)
      return { ok: true, zone, line: pick.line }
    }
    say(pick.line, 4200)
    return { ok: true, zone, line: pick.line }
  }

  function snapshot() {
    return {
      ready: state.ready,
      fps: state.fps,
      expression: state.expression,
      motion: state.motion,
      mood,
      pose: state.pose ?? null,
      gaze: state.gaze,
      dialog: state.dialog,
      thinking: state.thinking ?? false,
      dialogEmoji: state.dialogEmoji ?? null,
      params: state.params,
      expressions: state.expressions,
      motionGroups: Object.fromEntries(Object.entries(motionGroups).map(([group, list]) => [group, list.length])),
    }
  }

  async function handleCommand(payload) {
    const cmd = String(payload?.cmd || '')
    switch (cmd) {
      case 'state':
        return { ok: true, state: snapshot() }
      case 'expression':
        return playExpression(payload.name ?? payload.index, { duration: payload.duration })
      case 'motion':
        return playMotion(payload.group, payload.index, payload.name)
      case 'stop':
        return stopMotions()
      case 'typing':
        return setThinking(payload.on !== false)
      case 'say': {
        // emojiUrl / motion 是给测试和排查用的：真跑起来时这两样由 /say 的回复带回来
        const result = say(payload.text, payload.duration, { emojiUrl: payload.emojiUrl })
        if (typeof payload.motion === 'string' && payload.motion !== '') playActionByName(payload.motion)
        if (typeof payload.emoji === 'string' && payload.emoji !== '') applyEmojiExpression(payload.emoji)
        return result
      }
      case 'reaction':
        return react(payload.zone || 'chest')
      /* 按窗口坐标算一下会落在哪个部位：校准分区、排查「点她没反应」用，不触发递话 */
      case 'zone': {
        const bounds = model.getBounds()
        const point = zoneAt(bounds, Number(payload.x), Number(payload.y))
        return {
          ok: true,
          ...point,
          bounds: { x: round(bounds.x), y: round(bounds.y), width: round(bounds.width), height: round(bounds.height) },
        }
      }
      case 'bounds': {
        const bounds = model.getBounds()
        return {
          ok: true,
          bounds: { x: round(bounds.x), y: round(bounds.y), width: round(bounds.width), height: round(bounds.height) },
          stage: { width: stageEl.clientWidth, height: stageEl.clientHeight },
        }
      }
      case 'mood':
        return setMood(payload.name ?? payload.mood, payload.duration)
      /* 摆姿势：{"cmd":"pose","preset":"shy"} 或 {"cmd":"pose","params":{"ParamMouthForm":-1}} */
      case 'pose':
        if (payload.off === true) return clearPose()
        return setPose(payload.preset ?? payload.params ?? payload.name, payload.duration)
      case 'gaze':
        if (payload.off) {
          gazeOverride = null
          clearGaze()
          return { ok: true, gaze: null }
        }
        gazeOverride = { x: clamp(Number(payload.x) || 0, -1, 1), y: clamp(Number(payload.y) || 0, -1, 1) }
        setGaze(gazeOverride.x, gazeOverride.y)
        return { ok: true, gaze: gazeOverride }
      case 'follow-pointer':
        followPointer = payload.off ? false : true
        if (!followPointer) clearGaze()
        return { ok: true, followPointer }
      case 'params': {
        const values = {}
        for (const parameter of parameters) values[parameter.id] = round(core.getParameterValueById(parameter.id))
        return { ok: true, values }
      }
      default:
        return { ok: false, error: `不认识的命令：${cmd || '(空)'}` }
    }
  }

  native?.onCommand(async (id, payload) => {
    let result
    try {
      result = await handleCommand(payload)
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) }
    }
    native?.result(id, result)
  })

  // —— 心跳 ——
  setInterval(() => {
    if (expressionDeadline && Date.now() >= expressionDeadline) resetExpressionToDefault()
    state.fps = Math.round(app.ticker.FPS || 0)
    native?.state(JSON.stringify(snapshot()))
  }, 2000)

  // 先画一帧，再告诉主进程「准备好了」，截图才有内容
  app.renderer.render(app.stage)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  state.ready = true
  native?.ready()
}

main().catch((error) => {
  console.error(error)
  showError(error)
})
