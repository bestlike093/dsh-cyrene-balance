import {
  AdapterRegistry,
  BlobUrlLedger,
  ModuleHost,
  PermissionBroker,
  PetalRegistry,
  RendererHost,
  balanceModule,
  bubbleModule,
  createGifAdapter,
  createImageAdapter,
  createLive2DAdapter,
  createVideoAdapter,
  createRenderNoticePump,
  createSpriteAdapter,
  findFirstTexture,
  fullFrameRect,
  hitTest,
  parseSpriteSheet,
  reminderModule,
  toCanvasPoint
} from '../../../../packages/core/dist/browser.js'
import { HOST_CAPABILITY, SIZE_PROFILES, isPresenceQuietNow, mediaKindForName } from '../../../../packages/shared/dist/index.js'
import { createMotionController } from './motion.mjs'
import { attachAutoOutline, DEFAULT_OUTLINE_PREFERENCE } from './outline.mjs'
import { pickBubbleEmojiUrl } from './bubble-emoji.mjs'

// 模块图成功建立并执行到这里，index.html 的 3 秒兜底就不会报「未启动」。
// 若某个 import 让整张模块图失败，这一行不会执行 —— 这正是要把失败显示出来的信号。
window.__dshRenderBooted = true


const profile = SIZE_PROFILES.vertical
const dpr = window.devicePixelRatio || 1

const appRoot = document.getElementById('app')
const canvas = document.getElementById('stage')

let pulseTimer = null
/**
 * 点击反馈：轻压一下再回弹。
 * 图片模式点一下会换姿势，原始构图不同，直接重绘看起来像「突然变大变小」；
 * 用一段短过渡把这次重绘包住，观感就顺了。
 */
function pulsePetScale() {
  if (canvas === null) return
  canvas.style.transformOrigin = '50% 88%'
  canvas.style.transition = 'transform .16s cubic-bezier(.22,.61,.36,1)'
  canvas.style.transform = 'scale(.985)'
  if (pulseTimer !== null) clearTimeout(pulseTimer)
  pulseTimer = setTimeout(() => {
    canvas.style.transform = 'scale(1)'
    pulseTimer = setTimeout(() => {
      canvas.style.transition = ''
      canvas.style.transform = ''
      pulseTimer = null
    }, 180)
  }, 90)
}
canvas.width = profile.w
canvas.height = profile.h

const banner = document.getElementById('banner')

// 主界面不再留状态栏：文案只做内部记录，同时上报给设置窗的诊断区。
// 保留单一状态源，避免断言逻辑散落到各处。
let lastStatus = '等待素材'
function setMediaStatus(text) {
  lastStatus = text
}

// 空态引导卡：没有素材时显示，首次渲染成功后淡出。
const emptyState = document.getElementById('empty-state')
let mediaLabel = '未加载'

function setEmptyState(visible) {
  if (emptyState === null) return
  emptyState.classList.toggle('hidden', !visible)
}
setEmptyState(true)

/**
 * 有没有可用的立绘，决定气泡和状态栏该不该出现。
 * 空态只留引导卡：她还没出场的时候，说台词和报数字都是噪音。
 * 每次全量重算，不做增量判断 —— 这里开销可以忽略，少一处状态不同步的坑。
 */
let hasModel = false

function applyPresence(next) {
  hasModel = next === true
  setEmptyState(!hasModel)
  applyHud()
  if (!hasModel) {
    hideBubbleNow()
  }
}

// 台词之间留一段安静，别让她一直在说话。
const SPEAK_GAP_MS = 9000
let lastSpeakAt = 0

// 右键她 → 主进程弹原生菜单，只有「设置」和「退出」。
// 换模型、开模型目录都在设置窗里，菜单不再重复一份入口。
// contextmenu 与 pointerdown 是两条独立事件，不参与命中判定，点击链路原样不动。
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  void window.pet?.openContextMenu?.({ hasModel })
})

// 诊断（丙 C-84 ③）：只读，不改 pause 逻辑。
// 必须带焦点状态，否则只能证明「没在跑」，证明不了「因为失焦」。
setInterval(() => {
  const frames = renderer.frameCount
  const info = {
    media: mediaLabel,
    frames,
    hit: canvas.dataset.hitCount ?? '0',
    status: lastStatus
  }

  // HUD 与气泡读同一份快照，避免两处各算一遍、数字对不上。
  renderHud(info)
  // 台词隔一阵说一句就收，常驻反而吵。
  // 三条前提：她在场、气泡模块开着、当前没在说话。
  const bubbleOn = appSettings?.modules?.['builtin.bubble']?.enabled !== false
  const aiSpeak = appSettings?.presence?.aiEnabled === true
  const speaking = bubbleHideTimer !== null
  // 开了 AI 台词就交给主进程定时开口，这边不再本地轮播，否则两条通路会抢气泡。
  if (!aiSpeak && hasModel && bubbleOn && !speaking && Date.now() - lastSpeakAt >= SPEAK_GAP_MS) {
    lastSpeakAt = Date.now()
    showBubble(bubbleTextFor(appSettings?.bubble?.mode ?? 'rotate', info))
  }

  // 动作能力一并上报：主进程拿它当「AI 可点动作清单」，没探测到能力就不让模型瞎点。
  info.motion = motionController === null ? null : motionController.catalog()
  info.outline = outlineState

  // 设置窗要读实时状态；只报内存，不落盘。
  void window.pet?.reportRenderInfo?.(info)
}, 2000)

function showBanner(text) {
  banner.hidden = false
  banner.textContent = text
}

function clearBanner() {
  banner.hidden = true
  banner.textContent = ''
}

// 任何未捕获异常都只显示提示条，DOM 与当前模型保持可见。
window.addEventListener('error', (event) => {
  showBanner(`运行错误：${event.message}`)
})
window.addEventListener('unhandledrejection', (event) => {
  showBanner(`未处理异常：${String(event.reason)}`)
})

// ---------- 四媒体渲染 ----------

const adapters = new AdapterRegistry()

// 视频解码在部分机器上要求元素在文档中；放进隐藏容器，避免只创建不挂载。
const videoHolder = document.createElement('div')
videoHolder.style.position = 'fixed'
videoHolder.style.left = '-9999px'
videoHolder.style.top = '0'
document.body.appendChild(videoHolder)

adapters.register(createImageAdapter())
adapters.register(createGifAdapter())
adapters.register(
  createVideoAdapter({
    createVideo: () => {
      const video = document.createElement('video')
      videoHolder.appendChild(video)
      return video
    }
  })
)
adapters.register(createLive2DAdapter({ fallback: createImageAdapter() }))
// 帧序列：描述由 loadFromFiles 解析后随 create 传入，适配器本身无状态。
adapters.register(createSpriteAdapter())

const renderer = new RendererHost()
// 失焦 / 页面隐藏 ⇒ 暂停；回来 ⇒ 续播。
// 不接这根线，最小化后 rAF 照样跑，表现为「切走了还在烧帧」。
// DOM 事件在当前窗口不派发（实测 hidden 恒 false、hasFocus 恒 true）。
// 主进程广播是主路径，bindLifecycle 只作渲染侧兜底。
renderer.bindLifecycle(window, document)
let detachLifecycle = null
if (window.pet?.onLifecycle) {
  detachLifecycle = window.pet.onLifecycle((state) => {
    if (state === 'paused') {
      renderer.pause()
      pauseBundledPoseLoop()
    } else {
      renderer.resume()
      resumeBundledPoseLoop()
    }
  })
} else {
  console.warn('[lifecycle] preload 未暴露 onLifecycle，窗口切走不会暂停')
}

// B2-3 接线：矩形命中。B2 阶段角色与画布等大，画布内任意一点都算「体内」，
// 透明区域也会命中 —— 这是已知限制，不是 bug。
//
// 反馈动作：当前真素材（sheet-whale-2f）只有 idle 一个 clip，没有独立的 tap。
// 所以播 idle 本身 —— 这只是「调用链走进了动作通道」，⛔ 不能当 B2 的验收证据：
//   · 它走的是正常路径而非 catch 回落，A3 因此干净
//   · 但 idle 本来就在 0↔1 循环，「点下去帧变了」与「它本来就在跳」无法区分
// ⇒ B2 的可判别证据落在下面那个只由点击产生的计数器上。
const FEEDBACK_ACTION = 'idle'

// 只由点击命中的分支递增。未命中、加载、播放都不会改它 ——
// 断言：点击前 0，点击后 1。与动画无关、与素材无关，不可撞脸。
let hitCount = 0
canvas.dataset.hitCount = '0'

// 按下那一刻有没有点在她身上。
// 松手时用它区分「单击」和「拖了一下又松在别处」，避免误弹气泡。
let pressedOnPet = false

/**
 * 算画布上非透明像素的外接矩形。
 *
 * 只在点到透明像素时才调用。返回 null 表示整幅画布都是空的 ——
 * 说明画面不在这一层（比如 WebGL / 还没画出第一帧），调用方要按整帧兜底。
 */
function canvasInkBounds(target) {
  try {
    const ctx = target.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return null
    const { data } = ctx.getImageData(0, 0, target.width, target.height)
    let left = target.width
    let top = target.height
    let right = -1
    let bottom = -1
    const stepX = Math.max(1, Math.floor(target.width / 120))
    const stepY = Math.max(1, Math.floor(target.height / 160))
    for (let y = 0; y < target.height; y += stepY) {
      for (let x = 0; x < target.width; x += stepX) {
        if (data[(y * target.width + x) * 4 + 3] > 8) {
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
    }
    if (right < left || bottom < top) return null
    return { left, top, right, bottom }
  } catch {
    return null
  }
}

/**
 * 点击命中：先过整帧矩形，再按像素 alpha 判断。
 * 2D canvas 的透明区域不抢点击；Live2D / WebGL 或读取失败时回退整帧，
 * 保证现有渲染器不会因为拿不到像素而整体失去点击。
 */
function isOpaqueHit(target, point) {
  if (point === null) return false
  const frame = fullFrameRect({ w: target.width, h: target.height })
  if (!hitTest(point, frame)) return false
  try {
    const ctx = target.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return true
    const x = Math.floor(point.x)
    const y = Math.floor(point.y)
    if (x < 0 || y < 0 || x >= target.width || y >= target.height) return false
    const alpha = ctx.getImageData(x, y, 1, 1).data[3]
    // 抗锯齿边缘的 alpha 很低，只要不是全透明就算摸到了她。
    if (alpha > 0) return true
    const bounds = canvasInkBounds(target)
    // 整幅都是空的：画面不在这层（WebGL / 还没画首帧），整帧兜底。
    if (bounds === null) return true
    // 点到她的外接矩形也算命中。像素级判定太严，裙摆内侧、发丝缝隙
    // 都会被判成「没点到」，用户看到的就是「点了没反应」。
    const pad = 6
    return (
      point.x >= bounds.left - pad &&
      point.x <= bounds.right + pad &&
      point.y >= bounds.top - pad &&
      point.y <= bounds.bottom + pad
    )
  } catch {
    return true
  }
}

canvas.addEventListener('pointerdown', (event) => {
  const box = canvas.getBoundingClientRect()
  // toCanvasPoint 内部是 point / scale，所以这里要传「页面尺寸 ÷ 画布尺寸」。
  // 传成 canvas.width / box.width 会把点击坐标反向缩小到左上角，
  // 表现就是「点她完全没反应」，而日志里的坐标永远是几十像素。
  const point = toCanvasPoint(
    { x: event.clientX - box.left, y: event.clientY - box.top },
    { x: box.width / canvas.width, y: box.height / canvas.height }
  )
  const hit = isOpaqueHit(canvas, point)
  pressedOnPet = hit

  if (!hit) {
    // 记坐标：下次排查「点了没反应」时能区分是点偏了还是命中判定坏了。
    console.info('[click] 未命中透明区', Math.round(point.x), Math.round(point.y))
    setMediaStatus(`点击未命中：透明区域 · hits=${hitCount}`)
    return
  }

  hitCount += 1
  canvas.dataset.hitCount = String(hitCount)

  // 只有帧序列模型有 playAction/currentFrame；图片/GIF/视频适配器没有。
  const canPlay = typeof currentModel?.playAction === 'function'

  // A2 断言点：帧下标。动作名只证明调用进去了，帧推进才证明播起来了。
  const frames = { before: null, after: null }
  if (canPlay) {
    try {
      frames.before =
        typeof currentModel.currentFrame === 'number' ? currentModel.currentFrame : 'n/a'
      currentModel.playAction(FEEDBACK_ACTION)
    } catch (error) {
      // 失败必须同时进状态栏，否则证据行会显示成功。
      setMediaStatus(`点击命中 · hits=${hitCount} · 动作失败：${
        error instanceof Error ? error.message : String(error)
      }`)
      showBanner(`反馈动作失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    frames.after =
      typeof currentModel.currentFrame === 'number' ? currentModel.currentFrame : 'n/a'
  }

  const action =
    typeof currentModel?.currentAction === 'string' ? currentModel.currentAction : '—'
  setMediaStatus(canPlay
    ? `点击命中 · hits=${hitCount} · action=${action} frame ${frames.before}→${frames.after}`
    : `点击命中 · hits=${hitCount}（当前模型无动画帧）`)
})

// 拖拽：pointerdown 只记起点，指针移动超过阈值才进入拖动状态。
// 阈值用来区分「点击」与「拖动」—— 没有阈值的话手抖 1px 就会让窗口乱跑。
// 进入拖动后只通知主进程开始，位置跟随由主进程读光标完成：
// 增量方案在这里不成立，因为窗口跟着鼠标走时 screenX 不变，算出来永远是 0。
const DRAG_THRESHOLD_PX = 3
const VELOCITY_WINDOW_MS = 120
let dragStart = null
let dragging = false
let samples = []

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  dragStart = { x: event.screenX, y: event.screenY }
  dragging = false
  samples = []
})

window.addEventListener('pointermove', (event) => {
  if (dragStart === null) return

  // 拖动后仍要持续采样，否则松手时算不出速度，抛掷永远是 0。
  samples.push({ t: performance.now(), x: event.screenX, y: event.screenY })
  if (samples.length > 10) samples.shift()

  if (dragging) return
  const total = Math.hypot(event.screenX - dragStart.x, event.screenY - dragStart.y)
  if (total < DRAG_THRESHOLD_PX) return
  dragging = true
  canvas.dataset.dragging = '1'
  setMediaStatus(`拖动中 · hits=${hitCount}`)
  void window.pet?.dragStart?.()
})

window.addEventListener('pointerup', () => {
  const wasDragging = dragging
  const wasOnPet = pressedOnPet

  if (dragging) {
    // 只取最近 120ms 的样本：更早的轨迹属于「先慢慢挪再甩」里的慢速部分，
    // 一起平均会把甩出去的速度稀释掉。
    const now = performance.now()
    const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS)
    let vx = 0
    let vy = 0
    if (recent.length >= 2) {
      const first = recent[0]
      const last = recent[recent.length - 1]
      const dt = last.t - first.t
      if (dt > 0) {
        vx = (last.x - first.x) / dt
        vy = (last.y - first.y) / dt
      }
    }
    setMediaStatus(`拖动结束 · hits=${hitCount}`)
    void window.pet?.dragEnd?.({ vx, vy })
  }

  // 没拖动、按在角色身上、她也在场 —— 这才是单击，跟她说一句。
  if (!wasDragging && wasOnPet && !hasModel) {
    console.warn('[click] 已命中但模型不在场，台词没有触发')
  }
  if (!wasDragging && wasOnPet && hasModel) {
    lastSpeakAt = Date.now()
    pulsePetScale()
    // 默认图片模式才有姿势池：先换一张，再让她说话。Live2D / GIF 不受影响。
    void cycleBundledLook()
    // 点一下属于「小喇叭」：即使设置成只在小喇叭被点时念，这一句也要出声。
    void speakFromPresence()
  }

  dragStart = null
  dragging = false
  samples = []
  pressedOnPet = false
  canvas.dataset.dragging = '0'
  canvas.dataset.hitCount = String(hitCount)
})

const blobUrls = new BlobUrlLedger()
let currentModel = null

/**
 * 动作控制器。声明在前、赋值在模型加载之后，
 * 因为 refreshMood 会先跑一次，那时还没有模型可驱动。
 */
let motionController = null
/** 上一次驱动过动作的心情档位，用来只在「变了」的时候动一下，不做每 60 秒抽风。 */
let lastMotionMood = ''
let currentUrl = null
let loadFailed = false

// ---------- 默认图片模式：姿势池与轮换 ----------
//
// 只服务随包 Cyrene 立绘。导入的 Live2D / GIF / 视频不进这套状态，
// 避免「换姿势」误伤用户自己的素材。
const BUNDLED_POSE_ORDER = ['default', 'calm', 'playful', 'happy', 'confident', 'serious']
const BUNDLED_POSE_EMOTION = {
  default: 'neutral',
  calm: 'neutral',
  playful: 'happy',
  happy: 'love',
  confident: 'excited',
  serious: 'thinking'
}
let bundledScene = false
let bundledPoses = []
let bundledPoseIndex = 0
let bundledPoseEmotion = null
let bundledPoseTimer = null
let bundledPosePaused = false
let bundledPoseToken = 0
let bundledPoseLoading = false
const bundledPoseCache = new Map()

/** 从 listAssets 的 cyrene.poses 收集姿势；键名固定顺序，URL 去重。 */
function collectBundledPoses(result) {
  const poses = result?.cyrene?.poses
  if (poses === null || typeof poses !== 'object') return []

  const keys = [...BUNDLED_POSE_ORDER]
  for (const key of Object.keys(poses)) {
    if (!keys.includes(key)) keys.push(key)
  }

  const seen = new Set()
  const list = []
  for (const key of keys) {
    const url = poses[key]
    if (typeof url !== 'string' || url === '' || seen.has(url)) continue
    seen.add(url)
    list.push({
      key,
      url,
      file: url.split('/').pop() || `${key}.png`,
      emotion: BUNDLED_POSE_EMOTION[key] ?? 'neutral'
    })
  }
  return list
}

function clearBundledPoseTimer() {
  if (bundledPoseTimer !== null) {
    clearTimeout(bundledPoseTimer)
    bundledPoseTimer = null
  }
}

/** 退出默认场景：停轮换、撤标记、清姿势池；不在这里释放 blob，等旧模型 dispose 后再放。 */
function deactivateBundledScene() {
  clearBundledPoseTimer()
  bundledScene = false
  bundledPoseLoading = false
  bundledPoseToken += 1
  bundledPoses = []
  bundledPoseIndex = 0
  bundledPoseEmotion = null
  appRoot?.removeAttribute('data-scene')
}

/** 释放姿势缓存。调用时机必须在旧模型 dispose 之后，否则正在显示的图会被提前撤销。 */
function releaseBundledPoseCache() {
  for (const url of bundledPoseCache.values()) blobUrls.release(url)
  bundledPoseCache.clear()
}

/** 第一次用某个姿势时 fetch 成 blob URL，之后复用；姿势只有 6 张，缓存开销可控。 */
async function ensureBundledPoseUrl(pose) {
  const cached = bundledPoseCache.get(pose.url)
  if (typeof cached === 'string') return cached

  const response = await fetch(pose.url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  const file = new File([blob], pose.file, { type: blob.type || 'image/png' })
  const objectUrl = blobUrls.create(file)
  bundledPoseCache.set(pose.url, objectUrl)
  return objectUrl
}

/**
 * 换到姿势池中的某一张。
 *
 * 只调用现有 image adapter 的 load()，不重建模型、不碰 models.mjs。
 * 失败时保持上一张，状态里记原因；不弹破屏错误，也不清空画面。
 */
async function applyBundledPose(index) {
  if (!bundledScene || bundledPoses.length < 1) return false
  if (currentModel === null || typeof currentModel.load !== 'function') return false
  if (bundledPoseLoading) return false

  const pose = bundledPoses[index % bundledPoses.length]
  const token = ++bundledPoseToken
  bundledPoseLoading = true
  try {
    const source = await ensureBundledPoseUrl(pose)
    if (!bundledScene || token !== bundledPoseToken) return false
    await currentModel.load({ source, profile, dpr })
    if (!bundledScene || token !== bundledPoseToken) return false

    bundledPoseIndex = index % bundledPoses.length
    bundledPoseEmotion = pose.emotion
    renderBubbleMood()
    setMediaStatus(`随包立绘 · ${pose.key} · ${bundledPoseIndex + 1}/${bundledPoses.length}`)
    return true
  } catch (error) {
    setMediaStatus(`换姿势失败 · 保留上一张 · ${
      error instanceof Error ? error.message : String(error)
    }`)
    return false
  } finally {
    bundledPoseLoading = false
  }
}

/** 单击时换下一张；没有姿势池就安静地什么都不做。 */
async function cycleBundledLook() {
  if (!bundledScene || bundledPoses.length < 2) return false
  const next = (bundledPoseIndex + 1) % bundledPoses.length
  const ok = await applyBundledPose(next)
  if (ok) {
    // 刚点完就重置计时，避免下一拍立刻又被自动换掉。
    scheduleBundledPose()
  }
  return ok
}

/** 读设置；非有限值回落到 60 秒，0 表示关闭。 */
function bundledPoseIntervalMs() {
  const raw = Number(appSettings?.poseEverySeconds)
  const seconds = Number.isFinite(raw) ? Math.max(0, Math.min(3600, raw)) : 60
  return seconds > 0 ? seconds * 1000 : 0
}

/** 重新排下一次轮换；页面/进程暂停时不排。 */
function scheduleBundledPose() {
  clearBundledPoseTimer()
  if (!bundledScene || bundledPosePaused) return
  if (bundledPoses.length < 2) return
  const interval = bundledPoseIntervalMs()
  if (interval <= 0) return

  bundledPoseTimer = setTimeout(() => {
    bundledPoseTimer = null
    const next = (bundledPoseIndex + 1) % bundledPoses.length
    void applyBundledPose(next).then((ok) => {
      if (ok) scheduleBundledPose()
    })
  }, interval)
}

function pauseBundledPoseLoop() {
  bundledPosePaused = true
  clearBundledPoseTimer()
}

function resumeBundledPoseLoop() {
  bundledPosePaused = false
  scheduleBundledPose()
}

/**
 * 进入默认图片场景。
 *
 * stand 是当前实际加载的那张；它在姿势池里的下标优先作为起点。
 * 姿势池不足 2 张时仍保留场景样式，但不轮换。
 */
function activateBundledScene(result, stand) {
  clearBundledPoseTimer()
  bundledScene = true
  bundledPosePaused = false
  appRoot?.setAttribute('data-scene', 'cyrene')

  bundledPoses = collectBundledPoses(result)
  const start = bundledPoses.findIndex((pose) => pose.url === stand.url)
  bundledPoseIndex = start >= 0 ? start : 0
  bundledPoseEmotion =
    bundledPoses[bundledPoseIndex]?.emotion ?? BUNDLED_POSE_EMOTION.default

  renderBubbleMood()
  scheduleBundledPose()
}

/** 清画面：dispose 与加载失败两条路径都要走，否则旧帧会留在 canvas 上。 */
function clearStage() {
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
}

/**
 * 静态画布与 Live2D 画布共用同一个立绘区，同一时刻只允许一层可见。
 *
 * 之前切到 Live2D 时只往立绘区里又叠了一层画布，静态首帧（随包立绘、
 * 上一张图片）没有被收掉，于是两个角色同时出现在窗口里。像素先清空，
 * 再整层藏起来；切回静态素材时重新显示，不需要重画。
 */
function showStaticStage() {
  canvas.style.display = ''
}

function hideStaticStage() {
  clearStage()
  canvas.style.display = 'none'
}

// B2-4 接线：状态必须落到可见元素上，否则「算对了」也只是一块空白。
// 只有确定看不到时才打扰：加载中属于正常过程，不该在画面左上角留字。
const renderNotice = document.getElementById('render-notice')
const noticePump = createRenderNoticePump({
  show(kind) {
    if (kind !== 'failed') return
    renderNotice.hidden = false
    renderNotice.textContent = '素材加载失败：画面无法显示，请换一个文件重试'
  },
  hide() {
    renderNotice.hidden = true
    renderNotice.textContent = ''
  }
})

// 模型可能是 image/gif/video 适配器（没有 renderState），此时用 isRenderable 兜底，
// 让上层不必区分模型种类。300ms 足够，不值得每帧读一次。
setInterval(() => {
  if (loadFailed) {
    noticePump.push('failed')
    return
  }
  if (currentModel === null) {
    noticePump.push('idle')
    return
  }
  noticePump.push(
    typeof currentModel.renderState === 'string'
      ? currentModel.renderState
      : currentModel.isRenderable()
        ? 'ready'
        : 'loading'
  )
}, 300)

// 整窗销毁时兜底释放，避免残留 blob URL。图片与 GIF 共用这条路径。
window.addEventListener('beforeunload', () => {
  detachLifecycle?.()
  blobUrls.releaseAll()
})

async function loadModel(kind, file, label, spriteSheet) {
  // 换素材先退出默认图片场景：停掉轮换、撤掉场景样式。
  // 姿势 blob 先不释放，等旧模型 dispose 完再放，避免正在显示的图被提前撤销。
  deactivateBundledScene()
  // 统一登记：创建与释放都走同一张表，避免逐处补 revoke 时漏掉某条分支。
  const url = blobUrls.create(file)

  let model
  try {
    model = adapters.create(kind, {
      id: `${kind}-${Date.now()}`,
      source: url,
      profile,
      dpr,
      ...(spriteSheet === undefined ? {} : { spriteSheet })
    })
    model.attach(canvas)
    await model.load({ source: url, profile, dpr })
  } catch (error) {
    // 加载失败也要配对释放，否则一次失败就永久漏一个 URL。
    blobUrls.release(url)
    loadFailed = true
    clearStage()
    // 画面没了，把空态引导卡叫回来，好让用户能重新选素材。
    setEmptyState(true)
    setMediaStatus(`加载失败：${error instanceof Error ? error.message : String(error)}`)
    throw error
  }

  if (currentModel !== null) {
    renderer.detach()
    currentModel.dispose()
    clearStage()
  }
  // 旧模型已 dispose、不再引用旧 URL，此时释放不会撞上解码中的资源。
  if (currentUrl !== null) blobUrls.release(currentUrl)
  releaseBundledPoseCache()

  // 切到静态素材：撤掉 Live2D 画布，让立绘区只剩这一层。
  disposeLive2D()
  showStaticStage()

  renderer.attach(model)
  console.log(
    `[model] attach 后 running=${renderer.isRunning} attached=${renderer.attached !== null}`
  )
  // ⚠️ 上面 clearStage() 把画面擦空了。新模型在 load() 里画的首帧已经被擦掉，
  // 之后只能靠 tick 换帧才重绘（fps 1 要等一秒，暂停时永远不重绘）。
  // 换素材表现成「没反应」就是这条路径，所以这里必须立刻补画首帧。
  model.attach(canvas)
  renderer.start()
  console.log(
    `[model] start 后 running=${renderer.isRunning} frames=${renderer.frameCount}`
  )
  currentModel = model
  currentUrl = url
  loadFailed = false
  mediaLabel = `${label} · ${kind}`
  setMediaStatus(`${label} · ${kind} · ${model.isRenderable() ? '首帧已渲染' : '等待首帧'}`)
  // 画面有了，引导卡淡出。
  setEmptyState(false)
  clearBanner()
  autoOutlineStage()
}

/**
 * 静态立绘 / GIF / 帧序列也自动描边。
 * 这类走 RendererHost，拿不到 Pixi 的 postrender，交给 attachAutoOutline 自己等帧采样。
 */
function autoOutlineStage() {
  detachOutline?.()
  detachOutline = attachAutoOutline({
    canvas,
    renderer: null,
    thickness: Math.max(1.5, 2 * currentUiScale()),
    // 默认白边；设置里可以改成深边或按亮度自动挑。
    prefer: appSettings?.presence?.outline ?? DEFAULT_OUTLINE_PREFERENCE,
    onResult: (result) => {
      outlineState = result
      setMediaStatus(
        result.ok === true
          ? `描边 ${result.color} · 亮度 ${result.luma} · 取样 ${result.region}`
          : `描边未启用：${result.reason}`
      )
    }
  })
}

/** 读取并校验 .sprite.json；不合格字段在这里拦住，不留给播放期变成空帧。 */
async function readSpriteSheet(file) {
  let raw
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error(`帧序列描述不是合法 JSON：${file.name}`)
  }
  const parsed = parseSpriteSheet(raw)
  if (!parsed.ok) {
    const fields = parsed.errors.map((error) => error.field).join('、')
    throw new Error(`帧序列描述不合格（${fields}）：${file.name}`)
  }
  return parsed.value
}

async function loadFromFiles(fileList) {
  const files = [...fileList]
  if (files.length === 0) return

  const modelFile = files.find((file) => file.name.toLowerCase().endsWith('.model3.json'))
  if (modelFile !== undefined) {
    const texture = await findFirstTexture(modelFile, files)
    if (texture === null) {
      throw new Error('Live2D 目录里没有可用纹理，无法显示首帧（未接 Live2D 运行时）')
    }
    await loadModel('image', texture, `${modelFile.name} 的静态首帧`)
    setMediaStatus(`${lastStatus}（Live2D 运行时未接入，当前为静态降级）`)
    return
  }

  // .sprite.json 走帧序列；排在 model3.json 之后，避免吞掉 Live2D 描述。
  const sheetFile = files.find((file) => file.name.toLowerCase().endsWith('.sprite.json'))
  if (sheetFile !== undefined) {
    const sheet = await readSpriteSheet(sheetFile)
    const wanted = sheet.image.toLowerCase()
    const imageFile = files.find((file) => file.name.toLowerCase() === wanted)
    if (imageFile === undefined) {
      throw new Error(`帧序列引用的底图不在本次选择里：${sheet.image}`)
    }
    await loadModel('sprite', imageFile, `${sheetFile.name} 的帧序列`, sheet)
    setMediaStatus(
      `${lastStatus}（${sheet.clips.length} 个动作，共 ${sheet.grid.columns * sheet.grid.rows} 帧）`
    )
    return
  }

  const mediaFile = files.find((file) => mediaKindForName(file.name) !== null)
  if (mediaFile === undefined) {
    throw new Error('没有可识别的媒体：png / jpg / webp / gif / mp4 / model3.json')
  }
  const kind = mediaKindForName(mediaFile.name)
  if (kind === null) throw new Error('无法判断媒体类型')
  await loadModel(kind, mediaFile, mediaFile.name)
}

document.getElementById('file').addEventListener('change', async (event) => {
  try {
    await loadFromFiles(event.target.files)
  } catch (error) {
    showBanner(`加载失败：${error instanceof Error ? error.message : String(error)}`)
  }
})

// ---------- Live2D 模型导入 ----------
//
// 模型文件不随应用分发（作者授权禁止再分发），使用者从作者处下载后经这里导入，
// 由主进程落进 userData/models。选文件和导入都在主进程完成，渲染侧只等到结果。

const importZipBtn = document.getElementById('import-zip')
const importFolderBtn = document.getElementById('import-folder')

async function importModel(kind) {
  const button = kind === 'zip' ? importZipBtn : importFolderBtn
  const label = kind === 'zip' ? '压缩包' : '文件夹'
  if (button !== null) {
    button.disabled = true
    button.textContent = '导入中……'
  }
  // 导入 100MB 级模型要几秒，给一句能看懂的状态，避免看起来像卡死。
  setMediaStatus(`正在读取${label}……`)

  try {
    const result = await window.pet.importModel(kind)
    if (result?.canceled === true) {
      setMediaStatus(lastStatus === `正在读取${label}……` ? '等待素材' : lastStatus)
      return
    }
    if (result?.ok !== true) {
      const reason = result?.message ?? '未知原因'
      showBanner(`导入失败：${reason}`)
      setMediaStatus('导入失败')
      // 给内测人员一句人话，而不是只留一行状态码。
      notifyBeta(`这个${label}没认出来：${reason}`)
      return
    }

    console.log('[models] 已导入', result.model?.id, '纹理', result.model?.textureCount)
    const loaded = await loadLive2DUrl(result.model?.url)
    if (loaded?.ok === true) {
      notifyBeta('模型装好啦♪ 以后就由我来陪你')
    } else {
      notifyBeta('模型放进来了，但没能站起来……看看右上角的提示')
    }
  } catch (error) {
    showBanner(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    setMediaStatus('导入失败')
    notifyBeta('导入的时候卡住了，再看看右上角写了什么')
  } finally {
    if (button !== null) {
      button.disabled = false
      button.textContent = kind === 'zip' ? '导入模型压缩包' : '导入已解压的文件夹'
    }
  }
}

// 空态卡上的齿轮：还没导入模型时也能进设置配 Key、调窗口。
// 模型载入后整张卡淡出，入口交回右键菜单。
document.getElementById('empty-settings')?.addEventListener('click', () => {
  void window.pet?.openSettings?.()
})

importZipBtn?.addEventListener('click', () => {
  void importModel('zip')
})

importFolderBtn?.addEventListener('click', () => {
  void importModel('folder')
})

document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', async (event) => {
  event.preventDefault()
  try {
    await loadFromFiles(event.dataTransfer.files)
  } catch (error) {
    showBanner(`加载失败：${error instanceof Error ? error.message : String(error)}`)
  }
})

// ---------- 模块系统 ----------
//
// 内核里三个 builtin 模块（气泡 / 提醒 / 余额）一直没被注册、也没注入沙箱端口，
// 所以从来没跑起来过。这里补三件事：
//   1. 按 settings.modules 的 enabled 注册，开关就在配置文件里
//   2. 注入 SandboxPorts（render / readMemory / writeMemory）
//   3. 给出宿主能力快照 —— 不传的话，任何声明了 hostCapabilities 的模块
//      都会被判成「宿主未探测」并直接落成占位卡

const modulesHost = document.getElementById('modules')
const shadow = modulesHost.attachShadow({ mode: 'open' })
shadow.innerHTML = `<style>
  :host { all: initial; }
  .module-layer { position: absolute; inset: 0; pointer-events: none; }
  /* 素材包贴纸：固定在窗口右上角，小尺寸、不吃鼠标事件，尽量不压住立绘。 */
  .pet-sticker {
    position: fixed; right: 10px; top: 10px;
    width: 56px; height: 56px; object-fit: contain;
    pointer-events: none; opacity: .95;
    filter: drop-shadow(0 3px 6px rgba(0, 0, 0, .18));
  }
  /* 气泡分两层：外层 .pet-bubble-wrap 负责定位、淡入淡出和小角角，
     内层 .pet-bubble 只管文字、留白和滚动。
     这么拆是因为角角必须探出气泡底边，而内层是 overflow:auto 的滚动容器 ——
     角角放在里面就会被算进 scrollHeight，短句也会凭空多出一条看不见的滚动区。 */
  .pet-bubble-wrap {
    /* 角角尺寸照 cyrene-balance 的 .bubble::after：18×11、往下探 9px、左偏 42%。
       三个数都乘 --ui-scale，窗口缩放时角角跟着气泡一起长大缩小，不写死 px。 */
    --tail-w: calc(18px * var(--ui-scale, 1));
    --tail-h: calc(11px * var(--ui-scale, 1));
    --tail-drop: calc(9px * var(--ui-scale, 1));
    --bubble-edge: var(--bubble-edge-color, var(--bubble-border, rgba(255, 255, 255, .95)));
    /* 角角底色必须和气泡渐变的末端同色，否则接缝处会露出一条色差。 */
    --bubble-tail: var(--bubble-tail-bg, var(--bubble-tail-fill, #e3f0fd));
    position: absolute; left: 50%;
    top: var(--bubble-top, 8px);
    bottom: auto;
    width: max-content;
    max-width: min(calc(100% - 20px), var(--bubble-width, 100%));
    opacity: 0;
    transform: translate(-50%, calc(-8px * var(--ui-scale, 1))) scale(.85);
    transform-origin: 50% 100%;
    transition: opacity .25s ease, transform .35s cubic-bezier(.34, 1.56, .64, 1);
    pointer-events: none;
  }
  /* 角角：单层椭圆水滴 —— 圆心压在气泡底边、往下探出 9px，上半实色下半渐隐。
     气泡挂在立绘头顶，所以这颗水滴的尖端朝下指向立绘。
     旧版是两层 clip-path 三角（描边色 + 填充色）叠出来的尖角：缩放时两层边宽对不齐，
     方向也容易被读反，整颗换成参考库的水滴。 */
  .pet-bubble-wrap::after {
    content: '';
    position: absolute;
    left: 42%;
    bottom: calc(-1 * var(--tail-drop));
    width: var(--tail-w);
    height: var(--tail-h);
    margin-left: calc(var(--tail-w) * -0.5);
    border-radius: 50%;
    background: radial-gradient(circle at 50% 0%, var(--bubble-tail) 0%, var(--bubble-tail) 62%, transparent 68%);
  }
  /* 档位预留：气泡一旦被摆到立绘下方，角角就没有指向对象，必须整颗收掉
     （对齐参考库的 .bubble.place-bottom::after{display:none}）。
     目前渲染层只有「贴头顶」一种摆法，没有任何代码会给 wrap 加这个类。 */
  .pet-bubble-wrap.place-bottom::after { display: none; }
  .pet-bubble-wrap.show {
    opacity: var(--bubble-alpha, 1);
    transform: translate(-50%, 0) scale(1);
    pointer-events: auto;
  }
  /* 余额提醒专用「知道了」。只在带 ackSegment 的气泡上挂，点它才升 confirmed。 */
  .pet-bubble-ack {
    position: absolute;
    right: calc(4px * var(--ui-scale, 1));
    top: calc(100% + calc(6px * var(--ui-scale, 1)));
    z-index: 2;
    padding: calc(2px * var(--ui-scale, 1)) calc(9px * var(--ui-scale, 1));
    border: 0;
    border-radius: 999px;
    background: var(--bubble-bg, #f6faff);
    color: var(--bubble-ink, #4a2b3a);
    font: inherit;
    font-size: calc(11px * var(--ui-scale, 1));
    line-height: 1.5;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 1px 4px rgba(0, 0, 0, .14);
  }
  /* 宽度按内容自然展开（max-content），再由 max-width 收住；
     用 fit-content 时浏览器给绝对定位元素的可用宽度会略小于整行，短句也会被折成两行。
     高度只受「立绘区上方那块」约束，超出才在内部滚动。 */
  .pet-bubble {
    position: absolute; left: 50%;
    top: var(--bubble-top, 8px);
    bottom: auto;
    width: max-content;
    min-width: calc(56px * var(--ui-scale, 1));
    max-width: min(calc(100% - 20px), var(--bubble-width, 100%));
    max-height: var(--bubble-max-height, 42vh);
    overflow-y: auto;
    scrollbar-width: none;
    /* 用户留白档位 × 句子长度档位。两个系数相乘，短句更紧、长句更松，设置本身不被覆盖。 */
    padding:
      calc(var(--bubble-pad-y, calc(9px * var(--ui-scale, 1))) * var(--bubble-tier-pad-y, 1))
      calc(var(--bubble-pad-x, calc(13px * var(--ui-scale, 1))) * var(--bubble-tier-pad-x, 1));
    /* 四个角各不相同的「手绘感」圆角，默认值照参考库 22 / 18 / 20 / 16；
       --bubble-radius 由 bubbleRadiusCss() 按设置里的 radius 写成同一组四角值。 */
    border-radius: var(--bubble-radius, calc(22px * var(--ui-scale, 1)) calc(18px * var(--ui-scale, 1)) calc(20px * var(--ui-scale, 1)) calc(16px * var(--ui-scale, 1)));
    /* 边框全部写 longhand：简写 border 会把素材包的 border-image 一起重置掉。
       没选底图时宽度就是 0（白边交给下面的 inset box-shadow），选了底图才由九宫格撑起边宽。 */
    border-style: solid;
    border-width: var(--bubble-border-width, 0px);
    border-color: var(--bubble-edge, rgba(255, 255, 255, .95));
    border-image-source: var(--bubble-image, none);
    border-image-slice: var(--bubble-slice, 0) fill;
    border-image-repeat: stretch;
    background: var(--bubble-bg, var(--surface-solid, #f6faff));
    color: var(--bubble-ink, var(--ink, #4a2b3a));
    font-family: var(--bubble-font-family, "Microsoft YaHei", system-ui, sans-serif);
    font-size: var(--bubble-font-size, calc(14.5px * var(--ui-scale, 1)));
    line-height: var(--bubble-line-height, 1.5);
    /* 一条 box-shadow 同时给投影和内圈白边，照参考库；不再叠外圈粉环。 */
    box-shadow:
      0 calc(5px * var(--ui-scale, 1)) calc(16px * var(--ui-scale, 1)) var(--bubble-shadow-color, rgba(111, 168, 220, .28)),
      inset 0 0 0 calc(1px * var(--ui-scale, 1)) rgba(255, 255, 255, .95);
    opacity: 0;
    transform: translate(-50%, calc(-8px * var(--ui-scale, 1))) scale(.85);
    transition: opacity .25s ease, transform .35s cubic-bezier(.34, 1.56, .64, 1);
    pointer-events: none; word-break: break-word; text-align: center;
    /* 表情和文字并排放在气泡内容区里，表情不被文字换行挤走。 */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: calc(6px * var(--ui-scale, 1));
  }
  .pet-bubble::-webkit-scrollbar { width: 0; height: 0; }
  /* 还没被 wrap 包起来时的兜底显隐；wrap 一挂上，显隐与动画全归 wrap 管。 */
  .pet-bubble.show {
    opacity: var(--bubble-alpha, 1);
    transform: translate(-50%, 0) scale(1);
    pointer-events: auto;
  }
  /* 被外层包住后，内层就回归普通块级：定位与显隐都交给 wrap，避免两层各算一次。
     这里必须比 .pet-bubble.show 更具体 —— 旧版就是被 .show 的 translate(-50%) 盖掉，
     内层从 wrap 里被推出半个身位，气泡看着是歪的。
     pointer-events 用 inherit：显隐期间的可点性只由 wrap 一个人说了算。 */
  .pet-bubble-wrap .pet-bubble,
  .pet-bubble-wrap .pet-bubble.show {
    position: relative; left: auto; top: auto;
    width: auto; max-width: 100%;
    transform: none; opacity: 1;
    transition: none; pointer-events: inherit;
  }
  /* 句子长度档位：只改留白，不改字号。短句更贴，长句更松弛。 */
  .pet-bubble.tier-compact,
  .pet-bubble-wrap .pet-bubble.tier-compact { --bubble-tier-pad-y: .82; --bubble-tier-pad-x: .88; }
  .pet-bubble.tier-normal,
  .pet-bubble-wrap .pet-bubble.tier-normal { --bubble-tier-pad-y: 1; --bubble-tier-pad-x: 1; }
  .pet-bubble.tier-roomy,
  .pet-bubble-wrap .pet-bubble.tier-roomy { --bubble-tier-pad-y: 1.08; --bubble-tier-pad-x: 1.05; }
  .pet-bubble.tier-xlarge,
  .pet-bubble-wrap .pet-bubble.tier-xlarge { --bubble-tier-pad-y: 1.16; --bubble-tier-pad-x: 1.1; }
  /* 小表情：和文字同处 .pet-bubble 内部，排在文字左边。
     尺寸用 em 跟着气泡字号走；flex 不换行，长句只让文字自己折行。 */
  .pet-bubble-inline {
    flex: 0 0 auto;
    /* 边长由设置里的「气泡内表情大小」决定；没设过才退回 1.4em。 */
    width: var(--bubble-inline-size, 1.4em);
    height: var(--bubble-inline-size, 1.4em);
    object-fit: contain;
    pointer-events: none;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, .18));
  }
  .pet-bubble-text {
    min-width: 0;
    text-align: center;
  }
  .placeholder-card {
    /* 和气泡共用同一条让位线，避免占位卡压在立绘上。 */
    position: absolute; left: 12px; right: 12px;
    bottom: var(--bubble-bottom, 11px);
    padding: 8px 11px; border-radius: 9px;
    background: var(--accent-soft-glass, rgba(255, 241, 246, .96)); color: var(--ink, #2f3b47);
    font: 12px/1.5 "Microsoft YaHei", system-ui, sans-serif;
    border: 1px dashed var(--accent-line-strong, rgba(0, 0, 0, .3));
    pointer-events: none;
  }
</style>
<div class="module-layer"></div>`

const moduleLayer = shadow.querySelector('.module-layer')
const petalRegistry = new PetalRegistry()
// net.egress 是余额模块唯一的对外能力，端口实现只放行一个地址，见下面的 fetch。
const permissions = new PermissionBroker([
  'ui.render',
  'memory.read',
  'memory.write',
  'net.egress'
])

const MEMORY_PREFIX = 'dsh.module.'

// 与主进程 BALANCE_ENDPOINT 保持一致。模块传别的地址一律拒绝。
const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance'

/**
 * 模块 UI 的 HTML 净化。
 *
 * 模块是外部可替换的包，render(html) 之前是直接 innerHTML 塞进影子树；
 * 主窗口 CSP 又因为 inline importmap 必须保留 'unsafe-inline'，
 * 于是一个恶意模块只要丢一段 <script> 就能在渲染进程里执行。
 * 这里在进 DOM 之前先过一遍：危险标签整段丢掉，事件属性和 javascript: 一律去掉。
 * 用 <template> 解析不会执行脚本，也不会触发图片加载。
 */
const MODULE_BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form'
])
const MODULE_URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])

function sanitizeModuleHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = String(html ?? '')
  for (const node of [...template.content.querySelectorAll('*')]) {
    if (MODULE_BLOCKED_TAGS.has(node.tagName.toLowerCase())) {
      node.remove()
      continue
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc') {
        node.removeAttribute(attr.name)
        continue
      }
      if (MODULE_URL_ATTRS.has(name) && /^\s*(?:javascript|vbscript|data:text\/html)/i.test(attr.value)) {
        node.removeAttribute(attr.name)
      }
    }
  }
  return template.content
}

const sandboxPorts = {
  render(html) {
    moduleLayer.appendChild(sanitizeModuleHtml(html))
  },
  async readMemory(key) {
    const raw = localStorage.getItem(MEMORY_PREFIX + key)
    if (raw === null) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  },
  async writeMemory(key, value) {
    localStorage.setItem(MEMORY_PREFIX + key, JSON.stringify(value))
  },
  /**
   * 沙箱里的 net.fetch。
   *
   * 名义上接受任意 URL，实际只认余额这一个端点、只允许 GET：真正的请求由主进程
   * 带着 Vault 里的 Key 发出，渲染层既看不到 Key，也拿不到通用出网通道。
   * 返回形状贴近 Response，模块那边可以照常 await 和 json()。
   */
  async fetch(input) {
    const url = String(input)
    if (url !== BALANCE_ENDPOINT) {
      throw new Error(`PERMISSION_DENIED：未授权的地址 ${url}`)
    }
    const result = await window.pet.queryBalance()
    return {
      ok: result?.ok === true,
      status: result?.ok === true ? 200 : 0,
      async json() {
        return result
      }
    }
  }
}

const moduleHost = new ModuleHost(petalRegistry, permissions, {
  root: shadow,
  timeoutMs: 1200,
  sandboxPorts,
  hostCapabilities: {
    version: '0.1.0',
    // 一律引用常量表：扫描脚本靠它做对照，裸字面量会被判成拼写漂移。
    available: [
      HOST_CAPABILITY.window,
      HOST_CAPABILITY.tray,
      HOST_CAPABILITY.settings,
      HOST_CAPABILITY.storage
    ],
    notApplicable: [HOST_CAPABILITY.sessionRead, HOST_CAPABILITY.skillCatalog]
  }
})

let appSettings = null

// 气泡容器由模块挂出，文案由宿主写。
// 模块接口只有 bootstrap/teardown，运行期没法再接收新文本，内容归宿主。
let bubbleHideTimer = null
let activeAckSegment = null
const HOLD_SPEAK_MS = 4000
const HOLD_NOTICE_MS = 6000
const HOLD_ACK_MS = 10000

// ---- 语音 ----
//
// 出字和出声分开：合成慢、会失败，气泡不该等它。
// 上一句还没念完就来了新台词，直接掐掉旧的——两句叠在一起比没声音更难听。
const VOICE_MIME = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus'
}

let voiceAudio = null
let voiceUrl = null

function stopVoice() {
  if (voiceAudio !== null) {
    voiceAudio.pause()
    voiceAudio = null
  }
  if (voiceUrl !== null) {
    URL.revokeObjectURL(voiceUrl)
    voiceUrl = null
  }
}

/**
 * 把这句话念出来。
 *
 * 合成本身在主进程做（渲染侧 CSP 只允许 self / pet-media，直连 9880 会被拦）。
 * 这里拿回音频自己播；任何一步失败都安静收场，气泡照常出字。
 */
async function speakVoice(text, reason = 'auto') {
  const speak = window.pet?.speakVoice
  if (typeof speak !== 'function') return

  stopVoice()

  let result
  try {
    result = await speak(text, reason)
  } catch {
    return
  }
  if (result?.ok !== true) return

  try {
    const mime = VOICE_MIME[result.format] ?? 'audio/wav'
    const blob = new Blob([result.audio], { type: mime })
    voiceUrl = URL.createObjectURL(blob)
    voiceAudio = new Audio(voiceUrl)
    // 语音面板的音量优先；旧配置没这一项时回落到总音量。
    const voiceLevel = Number(appSettings?.voice?.volume)
    const level = Number.isFinite(voiceLevel) ? voiceLevel : Number(appSettings?.soundLevel)
    voiceAudio.volume = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1
    // 自动播放被系统拦、音频解不开，都只让这一次不出声。
    await voiceAudio.play().catch(() => {})
  } catch {
    stopVoice()
  }
}

function bubbleNode() {
  return shadow.querySelector('.pet-bubble')
}

/**
 * 气泡里的文字节点。
 *
 * 小表情要跟文字并排显示，所以 .pet-bubble 里不能再是一个裸文本节点：
 * 固定成「表情图 + span」两格。这里幂等，模块重渲染后也能就地补回来。
 */
function bubbleTextNode(bubble) {
  const existing = bubble.querySelector('.pet-bubble-text')
  if (existing !== null) return existing
  bubble.textContent = ''
  const span = document.createElement('span')
  span.className = 'pet-bubble-text'
  bubble.append(span)
  return span
}

/**
 * 把气泡包进外层容器。
 *
 * 气泡 DOM 由 core 的 builtin.bubble 渲染，只给一个 .pet-bubble；
 * 小角角必须挂在滚动容器外面，否则会被算进 scrollHeight，短句也凭空多出滚动区。
 * 所以在渲染层就地包一层，幂等：已经包过就原样返回，模块重启重渲染也能再包。
 */
function ensureBubbleWrap(bubble) {
  if (bubble === null) return null
  const parent = bubble.parentElement
  if (parent !== null && parent.classList.contains('pet-bubble-wrap')) return parent
  const wrap = document.createElement('div')
  wrap.className = 'pet-bubble-wrap'
  bubble.replaceWith(wrap)
  wrap.append(bubble)
  return wrap
}

function bubbleWrapNode() {
  const bubble = bubbleNode()
  const parent = bubble?.parentElement
  return parent?.classList.contains('pet-bubble-wrap') ? parent : null
}

/** 气泡角标用哪张表情：默认图片模式优先跟当前姿势，其余回落到状态栏心情。 */
function bubbleMoodEmotion() {
  if (bundledScene && typeof bundledPoseEmotion === 'string' && bundledPoseEmotion !== '') {
    return bundledPoseEmotion
  }
  const level = hud?.dataset.moodLevel
  return typeof level === 'string' && level !== '' ? level : 'neutral'
}

/** 用户选的贴纸：不再固定右上角，而是作为气泡里的表情图。 */
let activeStickerUrl = ''

/** 默认表情：当前姿势/心情对应的那张情绪图，旧表情失效时兜底用。 */
function defaultBubbleEmoji() {
  const emotions = assetsSnapshot?.cyrene?.emotions
  const byMood = emotions?.[bubbleMoodEmotion()]
  if (typeof byMood === 'string' && byMood !== '') return byMood
  // 情绪图缺失时再退到表情包里的第一张，尽量别让气泡空着。
  const files = assetsSnapshot?.cyrene?.emojiFiles
  const first = Object.values(files ?? {}).find((url) => typeof url === 'string' && url !== '')
  return first ?? ''
}

/**
 * 在气泡内部画一张小表情，跟文字并排。
 *
 * 图放进 .pet-bubble 而不是挂在外层 wrap 上：wrap 只管定位和角角，
 * 文字与表情同处一个内容区，长句换行时表情也不会被挤出气泡。
 * 找不到对应表情就回落到默认表情，连默认表情都没有才安静地收掉。
 */
function renderBubbleMood(emojiId) {
  const bubble = bubbleNode()
  if (bubble === null) return

  // 三级取图：陪伴层给的 id 最优先；旧 id 找不到素材就换成默认表情。
  const fallback = defaultBubbleEmoji()
  const url = pickBubbleEmojiUrl({
    emojiId,
    files: assetsSnapshot?.cyrene?.emojiFiles,
    stickerUrl: activeStickerUrl,
    fallback
  })

  const existing = bubble.querySelector('.pet-bubble-inline')
  if (url === '') {
    existing?.remove()
    bubble.classList.remove('has-inline-mood')
    return
  }

  const image = existing ?? document.createElement('img')
  image.className = 'pet-bubble-inline'
  image.alt = ''
  image.draggable = false
  image.onerror = () => {
    // 旧素材清掉后，旧聊天里存的 id 或旧贴纸地址会加载失败；
    // 换成默认表情再试一次，别在气泡里留空框。
    if (fallback !== '' && image.getAttribute('src') !== fallback) {
      image.src = fallback
      return
    }
    image.remove()
    bubble.classList.remove('has-inline-mood')
  }
  // 表情排在文字左边，所以插在 span 前面；重复调用时原地更新 src。
  if (existing === null) bubble.insertBefore(image, bubbleTextNode(bubble))
  if (image.getAttribute('src') !== url) {
    image.src = url
    image.animate?.(
      [
        { opacity: 0, transform: 'scale(.6) rotate(-8deg)' },
        { opacity: 1, transform: 'scale(1.08) rotate(2deg)', offset: 0.7 },
        { opacity: 1, transform: 'scale(1) rotate(-3deg)' }
      ],
      { duration: 320, easing: 'cubic-bezier(.34, 1.56, .64, 1)' }
    )
  }
  bubble.classList.add('has-inline-mood')
}

/** 按字符数给气泡留白分档；字号仍由设置控制。 */
function applyBubbleTier(bubble, text) {
  if (bubble === null) return
  const count = Array.from(text.replace(/\s+/g, '')).length
  const tier =
    count <= 12 ? 'tier-compact' : count <= 28 ? 'tier-normal' : count <= 48 ? 'tier-roomy' : 'tier-xlarge'
  bubble.classList.remove('tier-compact', 'tier-normal', 'tier-roomy', 'tier-xlarge')
  bubble.classList.add(tier)
}

/**
 * 给带 ack 键的气泡挂「知道了」。
 *
 * 只有点这颗按钮才走 confirmed；气泡自己淡出、被新台词顶掉、拖动窗口都不算。
 * 按钮挂在 wrap 上而不是 .pet-bubble 里，避免被模块重渲染文字时一起清掉。
 */
function renderBubbleAck(wrap, segment) {
  if (wrap === null) return
  const existing = wrap.querySelector('.pet-bubble-ack')
  if (typeof segment !== 'string' || segment === '') {
    existing?.remove()
    return
  }
  const button = existing ?? document.createElement('button')
  button.type = 'button'
  button.className = 'pet-bubble-ack'
  button.textContent = '知道了'
  if (existing === null) wrap.append(button)
  button.onclick = () => {
    void window.pet?.ackBalance?.(segment)
    hideBubbleNow()
  }
}

/** 收起或换句时把按钮一起带走，避免透明状态下还能点到上一段的 ack。 */
function clearBubbleAck() {
  const bubble = bubbleNode()
  const wrap = bubble?.parentElement
  if (wrap?.classList.contains('pet-bubble-wrap')) wrap.querySelector('.pet-bubble-ack')?.remove()
  activeAckSegment = null
}

/**
 * 显隐同时落在外层与内层。
 * 外层管定位、角角和淡入淡出；内层那套是「还没包起来」时的兜底，两边一起切不会错位。
 */
function setBubbleShown(shown) {
  const bubble = bubbleNode()
  if (bubble === null) return null
  const wrap = ensureBubbleWrap(bubble)
  bubble.classList.toggle('show', shown)
  wrap?.classList.toggle('show', shown)
  syncBubbleReserve(wrap, shown)
  return bubble
}

/** 淡出动画的时长，和 .pet-bubble-wrap 的 transition 对齐。 */
const BUBBLE_FADE_MS = 260
let bubbleReserveTimer = null

/**
 * 气泡是绝对定位，本身不占文档流；这里把它的实际高度写成 --bubble-reserve，
 * 由 #stage-area 的 padding-top 让出空间，立绘就不会被盖住。
 * 收起时等淡出结束再归还空间，避免立绘在半透明气泡底下跳一下。
 */
function syncBubbleReserve(wrap, shown) {
  if (bubbleReserveTimer !== null) {
    clearTimeout(bubbleReserveTimer)
    bubbleReserveTimer = null
  }
  const root = document.documentElement
  if (!shown) {
    bubbleReserveTimer = setTimeout(() => {
      root.style.setProperty('--bubble-reserve', '0px')
      bubbleReserveTimer = null
    }, BUBBLE_FADE_MS)
    return
  }
  requestAnimationFrame(() => {
    if (wrap === null) return
    const apply = () => {
      // 底边取气泡和 ack 按钮里更靠下的那个；再留 6px 呼吸位，水滴探出的 9px 也在高度里。
      const ack = wrap.querySelector('.pet-bubble-ack')
      const bottom = Math.max(
        wrap.getBoundingClientRect().bottom,
        ack === null ? 0 : ack.getBoundingClientRect().bottom
      )
      const reserve = Math.ceil(bottom + 6)
      root.style.setProperty('--bubble-reserve', `${reserve}px`)
    }
    // 淡入是缩放过渡，rAF 这一刻量到的是缩小态；过渡结束后再补一次，立绘才不会被压 2px。
    apply()
    setTimeout(apply, BUBBLE_FADE_MS)
  })
}

/** 立刻收起来，并清掉还没到点的淡出定时器，免得它把下一句也一起吃掉。 */
function hideBubbleNow() {
  if (bubbleHideTimer !== null) {
    clearTimeout(bubbleHideTimer)
    bubbleHideTimer = null
  }
  setBubbleShown(false)
  clearBubbleAck()
  stopVoice()
}

/**
 * 说一句话，停留 holdMs 后自动淡出。
 * 说话期间轮换台词不会插进来，所以淡出定时器只在这里管。
 *
 * options.speak 传 false 表示只出字不出声（导入成功/失败这类系统提示）。
 */
function showBubble(text, holdMs = HOLD_SPEAK_MS, options = {}) {
  if (typeof text !== 'string' || text === '') return
  const bubble = bubbleNode()
  if (bubble === null) {
    // 气泡模块没渲染出节点时不能静默吞掉这句话：状态栏留痕，主日志也带上。
    console.warn('[bubble] 没有 .pet-bubble 节点，台词未显示：', text)
    setMediaStatus(`气泡不可用 · 台词被丢弃：${text.slice(0, 24)}`)
    return
  }

  const ackSegment =
    typeof options.ackSegment === 'string' && options.ackSegment !== ''
      ? options.ackSegment
      : null

  // UI 闸：同一段正在显示时，重复 tick 不重置气泡，也不叠第二颗「知道了」。
  if (ackSegment !== null && ackSegment === activeAckSegment && bubbleHideTimer !== null) return

  bubbleTextNode(bubble).textContent = text
  applyBubbleTier(bubble, text)
  const wrap = ensureBubbleWrap(bubble)
  // 陪伴层可能给了具体表情 id；没有就按当前姿势/心情回落。
  renderBubbleMood(options.emojiId)
  setBubbleShown(true)
  renderBubbleAck(wrap, ackSegment)
  activeAckSegment = ackSegment

  if (bubbleHideTimer !== null) clearTimeout(bubbleHideTimer)
  bubbleHideTimer = setTimeout(() => {
    setBubbleShown(false)
    renderBubbleAck(wrap, null)
    activeAckSegment = null
    bubbleHideTimer = null
  }, holdMs)
  if (options.speak !== false) void speakVoice(text, options.reason ?? 'auto')
}

/**
 * 让主进程结合此刻说一句。
 *
 * 时间、天气、陪伴时长、记忆都只有主进程拿得到，渲染层不重复算。
 * 主进程自己会在失败时回落成本地短句；这里再兜一层，防止 IPC 本身不可用。
 */
async function speakFromPresence() {
  try {
    const result = await window.pet?.speak?.('manual')
    if (typeof result?.line === 'string' && result.line !== '') {
      showBubble(result.line, HOLD_SPEAK_MS, { reason: 'manual' })
      return
    }
  } catch {
    // 主进程不可用，退回本地台词池
  }
  showBubble(nextSpeakLine(), HOLD_SPEAK_MS, { reason: 'manual' })
}

/**
 * 对内测人员说话：导入成功、导入失败、模型不可用这几类。
 * 不走台词轮换，也不受「没模型就不出声」约束 —— 空态恰恰最需要她开口。
 * 这类是系统提示，不念出来。
 */
function notifyBeta(text) {
  showBubble(text, HOLD_NOTICE_MS, { speak: false })
}

// 单击时说的话。单独一个下标，避免和 2 秒一次的轮换计数互相踩。
let speakIndex = 0

function nextSpeakLine() {
  speakIndex = (speakIndex + 1) % ROTATE_LINES.length
  return ROTATE_LINES[speakIndex]
}

const ROTATE_LINES = [
  '人家在呢♪',
  '今天也要一起加油呀',
  '要不要歇一会儿？',
  '悄悄告诉你，粉色最好看了'
]
let rotateIndex = 0

function bubbleTextFor(mode, info) {
  switch (mode) {
    case 'info':
      return `帧 ${info.frames} · 点击 ${info.hit}`
    case 'talk':
      rotateIndex += 1
      return ROTATE_LINES[rotateIndex % ROTATE_LINES.length]
    case 'today':
      return balanceText === '未配置' ? '还没配置账户钥匙呢' : `今天用了 ${todayText}`
    case 'balance':
      return balanceText === '未配置' ? '还没配置账户钥匙呢' : `余额还有 ${balanceText}`
    default: {
      // rotate：台词与状态交替
      rotateIndex += 1
      return rotateIndex % 2 === 1
        ? ROTATE_LINES[rotateIndex % ROTATE_LINES.length]
        : `帧 ${info.frames} · 点击 ${info.hit}`
    }
  }
}

// HUD（状态栏）：showHud 控制显隐，hudDetail 控制详细程度，hudAlpha 控制透明度。
// 结构对齐 cyrene-balance：.hud-head（头像 + 心情/模型 + 收起态简读数 + 「···」）
// 加 .hud-detail（三枚 SVG 指标环 + 网速/电池 + 余额与动作等附加信息）。
// 详细区默认收着，点状态栏任意位置展开；full 档一进来就摊开。
// 所有数字都来自真实采样，读不到就写「—」，不拿占位数字顶。
const hud = document.getElementById('hud')
let balanceText = '—'
let todayText = '—'
let systemSnapshot = null
let assetsSnapshot = null
let hudExpanded = false
let lastHudInfo = null
/** 已经落到 DOM 上的详细度档位；只有它真的变了才把展开态复位。 */
let hudDetailApplied = null

/** 内边距档位：0 紧凑 → 3 宽松。写成 [上下, 左右]，便于跟 --ui-scale 相乘。 */
const BUBBLE_PADDING = [
  [6, 9],
  [9, 13],
  [12, 16],
  [16, 20]
]

/**
 * 气泡圆角：参考库那组「四角各不相同」的手绘感圆角（左上 22 / 右上 18 / 右下 20 / 左下 16）。
 * 设置里的 radius 仍然真实生效，只是改成驱动整组的比例：
 * radius 等于出厂默认 12 时正好还原参考库那一组，填 0 就是直角，填得越大越圆。
 * 这样调一个数不会把不对称调丢，也不会因为默认值而丢掉参考库的样子。
 */
const BUBBLE_RADIUS_SHAPE = [22, 18, 20, 16]
const BUBBLE_RADIUS_BASE = 12

function bubbleRadiusCss(radius) {
  const raw = Number(radius)
  const factor = Number.isFinite(raw) ? Math.max(0, raw) / BUBBLE_RADIUS_BASE : 1
  return BUBBLE_RADIUS_SHAPE
    .map((corner) => `calc(${(corner * factor).toFixed(1)}px * var(--ui-scale))`)
    .join(' ')
}

// 以默认窗口 scale(0.7) 为 1.0：窗口放大时 HUD、气泡、字号一起放大，三者保持同一比例。
const UI_SCALE_BASELINE = 0.7

function currentUiScale() {
  const raw = Number(appSettings?.window?.scale ?? UI_SCALE_BASELINE)
  const safe = Number.isFinite(raw) ? raw : UI_SCALE_BASELINE
  // 下限 0.5：窗口能缩到 0.2 倍，但状态栏和气泡不能跟着缩到看不见。
  return Math.min(1.6, Math.max(0.5, safe / UI_SCALE_BASELINE))
}

/**
 * 把窗口缩放折算成 UI 比例，一次写全：HUD 字号与内边距、气泡字号 / 留白 / 圆角。
 * 立绘由 Pixi 按画布尺寸等比缩放，这里不再乘第二次。
 */
function applyUiScale() {
  const scale = currentUiScale()
  document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3))

  const bubble = appSettings?.bubble ?? {}
  const paddingIndex = Math.min(3, Math.max(0, Math.round(Number(bubble.padding ?? 1))))
  const [padY, padX] = BUBBLE_PADDING[paddingIndex]
  // 拆成上下/左右两个变量：气泡档位可以在用户留白档位的基础上再乘一个系数，
  // 不覆盖设置本身。旧 --bubble-padding 仍然保留，避免外部样式引用时断掉。
  modulesHost.style.setProperty('--bubble-pad-y', `calc(${padY}px * var(--ui-scale))`)
  modulesHost.style.setProperty('--bubble-pad-x', `calc(${padX}px * var(--ui-scale))`)
  modulesHost.style.setProperty(
    '--bubble-padding',
    `calc(${padY}px * var(--ui-scale)) calc(${padX}px * var(--ui-scale))`
  )
  // 下限跟着设置值走，不能固定 11px：窗口缩到 0.5 倍时，
  // 固定下限会把 10~22px 全部压成 11px，滑杆就变成假的了。
  const fontSize = Number(bubble.fontSize ?? 14.5)
  const bubbleFont = Math.max(5, Math.min(11, fontSize * 0.6), fontSize * scale)
  modulesHost.style.setProperty('--bubble-font-size', `${bubbleFont.toFixed(2)}px`)
  modulesHost.style.setProperty('--bubble-radius', bubbleRadiusCss(bubble.radius))
  // 气泡内小表情的边长：设置值 × 窗口缩放；下限同样按设置值缩，保住滑杆的单调性。
  const stickerSize = Number(bubble.stickerSize ?? 64)
  const inlineSize = Math.max(8, Math.min(16, stickerSize * 0.4), stickerSize * scale)
  modulesHost.style.setProperty('--bubble-inline-size', `${inlineSize.toFixed(2)}px`)
  // 状态栏高度和字号变了，气泡可用高度跟着重算。
  updateStageMetrics()
}

/** 字体白名单，只用系统字体栈，不打包字体文件。键名与设置页保持一致。 */
const BUBBLE_FONTS = {
  system: 'system-ui, "Segoe UI", sans-serif',
  yahei: '"Microsoft YaHei", "Microsoft YaHei UI", sans-serif',
  song: '"SimSun", "Songti SC", serif',
  kai: '"KaiTi", "STKaiti", serif',
  mono: '"Cascadia Mono", "Consolas", monospace'
}

/**
 * 气泡贴头顶：顶部留白固定，水平居中；最大高度只吃立绘区上方那块。
 *
 * 气泡在 shadow DOM 里绝对定位，读不到 stage 的 flex 结果，
 * 所以把测量值写进 CSS 变量，气泡与占位卡共用同一组数字。
 */
function updateStageMetrics() {
  const root = document.documentElement.style
  const stage = document.getElementById('stage-area')
  const stageHeight = stage !== null && stage.clientHeight > 0 ? stage.clientHeight : window.innerHeight
  const hudHeight = hud !== null && hud.hidden === false ? hud.offsetHeight : 0
  const top = Math.max(6, Math.round(window.innerHeight * 0.018))
  // 默认只吃立绘区上方 42%；设置里填了高度就取两者较小值，让这个设置仍然真实生效。
  const naturalMax = Math.max(56, Math.round(stageHeight * 0.42))
  const limit = Number(appSettings?.bubble?.height ?? 0)
  const maxHeight =
    limit > 0 ? Math.min(naturalMax, Math.round(limit * currentUiScale())) : naturalMax
  root.setProperty('--bubble-top', `${top}px`)
  root.setProperty('--bubble-max-height', `${maxHeight}px`)
  // 占位卡还在底部，继续按状态条上沿让位。
  root.setProperty('--bubble-bottom', `${hudHeight === 0 ? 11 : hudHeight + 11}px`)
}

function applyHud() {
  const settings = appSettings ?? {}
  if (hud !== null) {
    // 老配置里的 off 归一成「关闭」：detail 视为 compact，显隐只由 showHud 决定。
    const legacyOff = settings.hudDetail === 'off'
    const detail = legacyOff ? 'compact' : (settings.hudDetail ?? 'compact')
    // 没立绘的时候状态栏没有意义；showHud 决定平时的显隐意图。
    // 夜间不扰勾了「隐藏状态栏」时，时段内临时收起，结束后按原意图恢复。
    const quietHideHud =
      settings.presence?.quiet?.hideHud === true &&
      isPresenceQuietNow(new Date(), settings.presence.quiet)
    hud.hidden = settings.showHud !== true || !hasModel || legacyOff || quietHideHud
    // 档位换了才把展开态复位：full 一进来就摊开，其余默认收着，点一下再展开。
    // 不在这里每次都复位，否则用户刚点开、下一拍数据推过来就被收回去。
    if (detail !== hudDetailApplied) {
      hudDetailApplied = detail
      hudExpanded = detail === 'full'
    }
    hud.dataset.detail = detail
    hud.style.opacity = String(settings.hudAlpha ?? 0.9)
    // 整体大小与内部字体/图标分开调：窗口尺寸不动，状态栏自己变。
    // 上限比设置页更宽，手改配置文件时也不会把 HUD 撑出窗口。
    const rawScale = Number(settings.hudScale ?? 1)
    const rawFontScale = Number(settings.hudFontScale ?? 1)
    const hudScale = Number.isFinite(rawScale) ? Math.min(2, Math.max(0.5, rawScale)) : 1
    const hudFontScale = Number.isFinite(rawFontScale)
      ? Math.min(2, Math.max(0.5, rawFontScale))
      : 1
    hud.style.setProperty('--hud-scale', String(hudScale))
    hud.style.setProperty('--hud-font-scale', String(hudFontScale))
    // simple = 一行简读数（藏头像与模型）；simple2 = 头像 + 心情/模型，数字点开才露。
    // compact 是老配置里 simple 的新名字，两个都认，老配置不用改。
    hud.classList.toggle('simple', detail === 'compact' || detail === 'simple')
    hud.classList.toggle('simple2', detail === 'simple2')
    hud.title = hudExpanded ? '点一下收起状态' : '点一下展开状态'
    syncHudExpanded()
  }
  // 显隐与档位一变，气泡要让出的高度也跟着变。
  updateStageMetrics()
}

// 夜间不扰可能跨过起止分钟：定时重算一次，不依赖设置变更事件。
setInterval(applyHud, 30_000)

/**
 * 把展开态落到 class 与「···」按钮上。
 * CSS 只认 .expanded：没展开就藏 .hud-detail，展开了就藏收起态那行简读数。
 */
function syncHudExpanded() {
  if (hud === null) return
  hud.classList.toggle('expanded', hudExpanded)
  const more = hud.querySelector('.hud-more')
  if (more !== null) {
    more.title = hudExpanded ? '收起详情' : '展开详情'
    more.setAttribute('aria-expanded', String(hudExpanded))
  }
}

/** 纯文本 span：内容一律走 textContent，任何字符串都不会被当 HTML 解析。 */
function hudText(text, className) {
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
  return span
}

function hudLine(text, extraClass) {
  return hudText(text, extraClass === undefined ? 'hud-line' : `hud-line ${extraClass}`)
}

/** 状态栏时间：本地 24 小时制、补零；等宽留给 CSS 的 tabular-nums。 */
function formatClock() {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 读不到就写「—」：Boolean 判断留着，避免把 0% 当成「没有」。 */
function formatPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '—'
}

/** 网速按量级换单位；没采样到就写「—」。 */
function formatSpeed(bps) {
  if (typeof bps !== 'number' || !Number.isFinite(bps)) return '—'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} K/s`
  return `${(bps / 1024 / 1024).toFixed(1)} M/s`
}

/**
 * 一格指标：SVG 双圆环画弧，环心写百分比，环下写项目名。
 *
 * 参考实现 cyrene-balance 用 <circle r="16"> 叠 track / fill 两层，
 * 靠 stroke-dasharray + stroke-dashoffset 控制进度，比 conic-gradient 多两个好处：
 * 1. 线帽能设成 round，弧的两端是圆的，不会切出一条硬边；
 * 2. 缩放窗口时矢量重绘，不会像 conic-gradient 那样出现锯齿。
 *
 * 周长 2πr 只在建节点时算一次；百分比换算成 dashoffset 后交给 CSS 过渡。
 * 缺数据时弧归零、数字写「—」、整格降饱和，title 说明是哪一项不可用。
 */
const RING_RADIUS = 16
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const SVG_NS = 'http://www.w3.org/2000/svg'

function hudRing(kind, label, percent) {
  const known = typeof percent === 'number' && Number.isFinite(percent)
  const value = known ? Math.min(100, Math.max(0, percent)) : 0
  const cell = document.createElement('span')
  cell.className = known ? 'hud-ring-cell' : 'hud-ring-cell unknown'
  cell.dataset.kind = kind

  const ring = document.createElement('span')
  ring.className = 'hud-ring'

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 40 40')
  svg.setAttribute('aria-hidden', 'true')

  const track = document.createElementNS(SVG_NS, 'circle')
  track.setAttribute('class', 'track')
  track.setAttribute('cx', '20')
  track.setAttribute('cy', '20')
  track.setAttribute('r', String(RING_RADIUS))

  const fill = document.createElementNS(SVG_NS, 'circle')
  fill.setAttribute('class', 'fill')
  fill.setAttribute('cx', '20')
  fill.setAttribute('cy', '20')
  fill.setAttribute('r', String(RING_RADIUS))
  fill.setAttribute('stroke-dasharray', RING_CIRCUMFERENCE.toFixed(2))
  // 0% 时整圈离屏，100% 时刚好补满一圈。
  fill.setAttribute('stroke-dashoffset', (RING_CIRCUMFERENCE * (1 - value / 100)).toFixed(2))

  svg.append(track, fill)
  ring.append(svg, hudLine(known ? `${Math.round(percent)}%` : '—', 'hud-ring-value'))

  cell.title = `${label} ${known ? formatPercent(percent) : '不可用'}`
  cell.setAttribute('aria-label', cell.title)
  cell.append(ring, hudLine(label, 'hud-ring-label'))
  return cell
}

/**
 * 电池：百分比 + 充电状态。
 * charging 只有真读到才是布尔值；读不到写「状态不明」，不猜成「未充电」。
 */
function formatBattery(battery) {
  const percent = battery?.percent
  const text = typeof percent === 'number' && Number.isFinite(percent) ? `${Math.round(percent)}%` : '—'
  if (battery?.charging === true) return `电池 ${text} · 充电中`
  if (battery?.charging === false) return `电池 ${text} · 使用中`
  return `电池 ${text}`
}

/**
 * 心情对应的表情小图。
 * 只认 manifest 里存在的 key；没有就返回 null，状态栏少一张图但不会破。
 */
function hudEmotion() {
  const level = hud?.dataset.moodLevel
  const emotions = assetsSnapshot?.cyrene?.emotions
  if (typeof level !== 'string' || level === '') return null
  if (emotions === null || typeof emotions !== 'object') return null
  const url = emotions[level]
  if (typeof url !== 'string' || url === '') return null
  const img = document.createElement('img')
  img.className = 'hud-face'
  img.src = url
  img.alt = ''
  img.decoding = 'async'
  return img
}

/** 头像优先用随包 cyrene 头像；没有就退回首字，不留破图。 */
function hudAvatar() {
  const box = document.createElement('span')
  box.className = 'hud-avatar'
  const url = assetsSnapshot?.cyrene?.avatar
  if (typeof url === 'string' && url !== '') {
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    img.decoding = 'async'
    img.addEventListener('error', () => {
      img.remove()
      box.textContent = '昔'
    })
    box.append(img)
  } else {
    box.textContent = '昔'
  }
  return box
}

/**
 * 常驻指标行：下行 / 上行 / 电池，有真实余额时再补一项。
 *
 * 照参考库的 .hud-net：每项是「图标 + 数值」，图标只做语义提示，
 * 数值读不到就写「—」，不编数字。余额在 balance 模块关闭时不出现，
 * 不拿「余额 —」占位骗人说这个功能在跑。
 */
function hudNet() {
  const stats = systemSnapshot ?? {}
  const net = document.createElement('div')
  net.className = 'hud-net'

  const item = (iconText, iconClass, valueText, itemClass) => {
    const box = document.createElement('span')
    box.className = itemClass === undefined ? 'net-item' : `net-item ${itemClass}`

    const icon = document.createElement('i')
    icon.className = iconClass
    icon.textContent = iconText

    const value = document.createElement('b')
    value.textContent = valueText

    box.append(icon, value)
    return box
  }

  net.append(
    item('↓', 'dl', formatSpeed(stats.net?.downBps)),
    item('↑', 'ul', formatSpeed(stats.net?.upBps)),
    item('●', 'bat', formatBattery(stats.battery ?? {}))
  )

  // balanceText 为「—」表示余额模块没开或没读到，此时整项不出现。
  if (balanceText !== '—') net.append(item('¥', 'money', balanceText, 'money'))
  return net
}

/** 上一次没能播出来的动作与原因，进展开行给人看，不吞掉失败。 */
let lastMotionFailure = ''

/**
 * 心情变了就让立绘跟着动一下。
 *
 * 只在档位切换时触发：60 秒一拍的心情同步如果每拍都播，立绘会一直抽。
 * 播不出来（模型不支持、正在播别的）就把原因记下来，展开行能看到。
 */
function driveMotionByMood(level) {
  if (hud !== null) hud.dataset.moodLevel = level
  // 默认图片模式的表情跟姿势走；其他媒体回落到状态栏心情。
  if (!bundledScene) renderBubbleMood(level)
  if (motionController === null || typeof level !== 'string' || level === '') return
  if (level === lastMotionMood) return
  lastMotionMood = level

  const result = motionController.playForMood(level, { source: 'mood' })
  lastMotionFailure = result.ok === true ? '' : `${level}→${result.reason ?? 'unknown'}`
  if (hud !== null && hud.hidden === false) renderHud(lastHudInfo)
}

/**
 * 动作状态文案。controller 在模型加载后才建好，之前如实写「未接线」，
 * 不拿一句好听的假话占位。
 */
function motionStatusText() {
  if (motionController === null) return '动作：未接线'
  const text = motionController.statusText()
  return lastMotionFailure === '' ? text : `${text} · 未播 ${lastMotionFailure}`
}

/**
 * 详细区最后一段：今日消费与动作通道状态。
 * 都是诊断信息，平时收在 .hud-detail 里，点开才占版面。
 */
function hudExtra() {
  const extra = document.createElement('div')
  extra.className = 'hud-extra'
  extra.append(
    hudLine(`今日 ${todayText}`, 'strong'),
    hudLine(motionStatusText(), 'hud-motion')
  )
  return extra
}

/**
 * 状态栏两段式：.hud-head 常驻一行，.hud-detail 点开才出现。
 *
 * 这是参考库 cyrene-balance 的结构，和旧版「一行塞满头像+三环+底栏」的区别：
 * - 收起时只有 头像 + 心情/模型 + 一行简读数，窗口再窄也不会挤成三行；
 * - 展开后三枚 SVG 环、网速/电池、余额与诊断信息一起铺开；
 * - 档位切换只改 CSS 显隐，不重建结构，避免每秒数据推送都把展开态抖回去。
 */
function renderHud(info) {
  // 隐藏时也照常刷新内容：设置里一打开就能看到最新数字，不用等下一拍。
  if (hud === null) return
  lastHudInfo = info
  const detail = hud.dataset.detail ?? 'compact'
  if (detail === 'off') return

  const stats = systemSnapshot ?? {}
  const memory = stats.memory ?? {}
  const gpu = stats.gpu ?? {}
  const modelName = typeof info?.media === 'string' && info.media !== '' ? info.media : '未加载'
  const stateText = typeof info?.status === 'string' ? info.status : '待机'
  const hudName =
    typeof appSettings?.hudName === 'string' && appSettings.hudName.trim() !== ''
      ? appSettings.hudName.trim()
      : '昔涟'

  // ---- 常驻头部 ----
  const head = document.createElement('div')
  head.className = 'hud-head'
  head.append(hudAvatar())

  const idBox = document.createElement('div')
  idBox.className = 'hud-id'

  const moodRow = document.createElement('span')
  moodRow.className = 'hud-mood-row'
  const face = hudEmotion()
  if (face !== null) moodRow.append(face)
  moodRow.append(
    hudLine(hudName, 'hud-name'),
    hudLine(hud.dataset.mood ?? stateText, 'hud-mood')
  )

  // 模型名和时间共用一行：窗口再窄也先保住心情，模型名自己截断。
  idBox.append(moodRow, hudLine(`${modelName} · ${formatClock()}`, 'hud-model'))

  // 收起态的一行简读数；展开后由 CSS 隐掉，和参考库的 .hud-peek-val 同义。
  // 简洁档只留一个指标，避免一行里挤三组数字。
  const peekText =
    detail === 'simple2'
      ? `CPU ${formatPercent(stats.cpuPercent)}`
      : `CPU ${formatPercent(stats.cpuPercent)} · 内存 ${formatPercent(memory.percent)}`
  const peek = hudLine(peekText, 'hud-peek-val')

  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'hud-more'
  more.textContent = '···'
  more.title = hudExpanded ? '收起详情' : '展开详情'
  more.setAttribute('aria-expanded', String(hudExpanded))

  head.append(idBox, peek, more)

  // ---- 详细区 ----
  const detailBox = document.createElement('div')
  detailBox.className = 'hud-detail'

  const rings = document.createElement('div')
  rings.className = 'hud-rings'
  // 顺序按「算得快的先读」：CPU → GPU → 内存，和参考图一致。
  rings.append(
    hudRing('cpu', 'CPU', stats.cpuPercent),
    hudRing('gpu', 'GPU', gpu.percent),
    hudRing('memory', '内存', memory.percent)
  )

  detailBox.append(rings, hudNet(), hudExtra())
  hud.replaceChildren(head, detailBox)
}

/**
 * 点状态栏任意位置切换详细区。
 * 只有明确关闭（off）时不响应；其余档位都允许临时展开看一眼。
 * 展开会改变状态条高度，所以要让气泡重新算一次可用空间。
 */
hud?.addEventListener('click', () => {
  if (hud === null) return
  if ((hud.dataset.detail ?? 'compact') === 'off') return
  hudExpanded = !hudExpanded
  syncHudExpanded()
  renderHud(lastHudInfo)
  updateStageMetrics()
})

// 状态栏时间每分钟走一格；隐藏时不重绘，省掉没必要的 DOM 重建。
setInterval(() => {
  if (hud !== null && hud.hidden === false) renderHud(lastHudInfo)
}, 60_000)

/** 系统指标：先取一次快照，之后订阅主进程推送（3 秒 / 6 秒两拍）。 */
async function initSystemStats() {
  try {
    const result = await window.pet?.systemStats?.()
    if (result?.ok === true && result.stats !== undefined) {
      systemSnapshot = result.stats
      renderHud(lastHudInfo)
    }
  } catch (error) {
    console.warn('[hud] 系统指标首读失败：', error)
  }
  window.pet?.onSystemStats?.((stats) => {
    systemSnapshot = stats ?? null
    renderHud(lastHudInfo)
  })
}

/** 头像走随包 manifest；拿不到就退回首字，不请求网络。 */
async function primeAssets() {
  try {
    const result = await window.pet?.listAssets?.()
    if (result?.ok === true) {
      assetsSnapshot = result
      renderHud(lastHudInfo)
    }
  } catch (error) {
    console.warn('[hud] 素材清单读取失败：', error)
  }
}

/** 心情由主进程算，60 秒同步一次；没有数据就不写，保持上一拍的标签。 */
async function refreshMood() {
  try {
    const result = await window.pet?.presenceMood?.()
    if (result?.ok === true && typeof result.mood?.label === 'string' && hud !== null) {
      hud.dataset.mood = result.mood.label
      if (typeof result.mood.level === 'string') driveMotionByMood(result.mood.level)
      renderHud(lastHudInfo)
    }
  } catch (error) {
    console.warn('[hud] 心情读取失败：', error)
  }
}

// ---------- 素材包消费端 ----------
// settings 里存的是 pack:<id>:<相对路径>；真实文件只能经 pet-media://pack 读。

/** 把 pack 引用换成 pet-media 地址；格式不对或空值时返回空串。 */
function packMediaUrl(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('pack:')) return ''
  const rest = ref.slice('pack:'.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return ''
  const packId = rest.slice(0, sep)
  const segments = rest
    .slice(sep + 1)
    .split('/')
    .filter((part) => part !== '')
  if (packId === '' || segments.length === 0) return ''
  return `pet-media://pack/${encodeURIComponent(packId)}/${segments.map(encodeURIComponent).join('/')}`
}

/** 包内字体只注册一次；注册成功后所有气泡共用同一个 FontFace 名。 */
const BUBBLE_PACK_FONT = 'CyrenePackFont'
let bubblePackFontUrl = ''

function fontStackFor(ref) {
  const url = packMediaUrl(ref)
  if (url === '') return BUBBLE_FONTS[ref] ?? BUBBLE_FONTS.system

  if (url !== bubblePackFontUrl) {
    bubblePackFontUrl = url
    const face = new FontFace(BUBBLE_PACK_FONT, `url("${url}")`)
    face
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch((error) => console.warn('[bubble] 素材包字体加载失败', url, error))
  }
  return `${BUBBLE_PACK_FONT}, "Microsoft YaHei", system-ui, sans-serif`
}

/** 气泡底图按九宫格拉伸；没选底图时把 border 收干净，保持原来的纯色气泡。 */
function applyBubbleArt(bubble) {
  const url = packMediaUrl(bubble.background)
  if (url === '') {
    modulesHost.style.setProperty('--bubble-image', 'none')
    modulesHost.style.setProperty('--bubble-slice', '0')
    modulesHost.style.setProperty('--bubble-border-width', '0px')
    return
  }

  const raw = Number(bubble.backgroundSlice ?? 12)
  const slice = Number.isFinite(raw) ? Math.min(64, Math.max(4, Math.round(raw))) : 12
  modulesHost.style.setProperty('--bubble-image', `url("${url}")`)
  modulesHost.style.setProperty('--bubble-slice', String(slice))
  modulesHost.style.setProperty('--bubble-border-width', `${slice}px`)
}

/** 贴纸挂在 shadow 里，固定右上角；没选就整块移除，不留空节点。 */
function applySticker(sticker) {
  activeStickerUrl = packMediaUrl(sticker?.source)
  // 旧版把贴纸钉在右上角；现在统一交给气泡里的表情位，顺手清掉历史节点。
  shadow.querySelector('.pet-sticker')?.remove()
  renderBubbleMood()
}

/** 把 ui 相关设置落到真实 DOM 上。设置窗改完即时调用，不走重启。 */
function applyUiSettings(next) {
  if (next === null || typeof next !== 'object') return
  const prevModelId = typeof appSettings?.live2dModelId === 'string' ? appSettings.live2dModelId : ''
  const prevBalanceOn = appSettings?.modules?.['builtin.balance']?.enabled === true
  const prevPoseEvery = Number(appSettings?.poseEverySeconds ?? 60)
  appSettings = next

  // 模型换了（设置窗切了立绘，或刚导入完），重新拉地址再加载，不用重启。
  const nextModelId = typeof next.live2dModelId === 'string' ? next.live2dModelId : ''
  if (nextModelId !== prevModelId) {
    void bootActiveModel()
  }

  // 主题：只换 data-theme，三套配色在 styles.css 里覆盖同一组语义变量。
  // 预设名沿用设置窗的写法（OceanBlue/SakuraPink/Paper），data-theme 是给 CSS 用的短名。
  // 不认识的值一律回退 blue，避免写错一个字符串就整窗掉色。
  const THEME_PRESETS = { OceanBlue: 'blue', SakuraPink: 'pink', Paper: 'ink' }
  const preset = next.theme?.preset
  document.documentElement.dataset.theme = THEME_PRESETS[preset] ?? 'pink'

  const bubble = next.bubble ?? {}
  const bubbleWidth = Number(bubble.width ?? 0)
  // 宽度 0 = 按内容自适应；上限由 CSS 的 min(100% - 20px, --bubble-width) 兜住。
  modulesHost.style.setProperty('--bubble-width', bubbleWidth > 0 ? `${bubbleWidth}px` : '100%')
  modulesHost.style.setProperty('--bubble-line-height', String(bubble.lineHeight ?? 1.5))
  modulesHost.style.setProperty('--bubble-alpha', String(bubble.alpha ?? 0.92))
  applyBubbleArt(bubble)
  // 字号 / 留白 / 圆角统一跟着窗口缩放走，三样一起长、一起收。
  applyUiScale()
  applySticker(next.sticker)
  modulesHost.style.setProperty(
    '--bubble-font-family',
    fontStackFor(bubble.fontFamily)
  )

  applyHud()

  // 换立绘间隔变了：立刻按新间隔重排；改成 0 时 schedule 会清掉定时器。
  if (bundledScene && Number(next.poseEverySeconds ?? 60) !== prevPoseEvery) {
    scheduleBundledPose()
  }

  // 气泡模块被关掉时立刻收起来，不等下次启动 —— 开关的后半段是即时的。
  if (next.modules?.['builtin.bubble']?.enabled === false) {
    hideBubbleNow()
  }

  // 余额模块刚被打开：立刻查一次，不用等下一个五分钟。
  if (next.modules?.['builtin.balance']?.enabled === true && !prevBalanceOn) {
    void refreshBalanceFromHost()
  }
}

// ---------- 余额快照 ----------
//
// 模块 bootstrap 时查一次，把结果写进 memory；宿主读它填状态栏。
// 之后宿主自己按间隔再查，不依赖模块重跑 —— bootstrap 一辈子只发生一次。

const BALANCE_SNAPSHOT_KEY = 'balance.snapshot'
const BALANCE_REFRESH_MS = 5 * 60 * 1000
let balanceRefreshTimer = null

/** 把快照落到界面状态上。拿不到就说清楚原因，不留空白也不写 NaN。 */
function applyBalanceSnapshot(snapshot) {
  const data = typeof snapshot === 'object' && snapshot !== null ? snapshot : {}

  if (data.ok !== true) {
    const reason = typeof data.reason === 'string' ? data.reason : ''
    // 没配钥匙是常见状态，单独给一句话，别写成「查询失败」吓人。
    if (reason === 'no-key') {
      balanceText = '未配置'
    } else if (reason === '') {
      balanceText = '—'
    } else {
      balanceText = '查询失败'
    }
    todayText = '—'
    return
  }

  const total = typeof data.totalBalance === 'number' ? data.totalBalance : null
  const spent = typeof data.todaySpent === 'number' ? data.todaySpent : null
  balanceText = total === null ? '—' : `¥${total.toFixed(2)}`
  // 本地账本估出来的，前面加 ≈ 提醒这是推算值。
  todayText = spent === null ? '—' : `≈¥${spent.toFixed(2)}`
}

/** 直接问主进程要一次最新数字。失败就退成「查询失败」。 */
async function refreshBalanceFromHost() {
  try {
    const result = await window.pet?.queryBalance?.()
    applyBalanceSnapshot(result)
  } catch {
    balanceText = '查询失败'
    todayText = '—'
  }
}

function startBalanceRefresh() {
  if (balanceRefreshTimer !== null) clearInterval(balanceRefreshTimer)
  balanceRefreshTimer = setInterval(() => {
    // 模块关了就不再打扰网络，静静等着就好。
    if (appSettings?.modules?.['builtin.balance']?.enabled !== true) return
    void refreshBalanceFromHost()
  }, BALANCE_REFRESH_MS)
}

async function bootModules() {
  appSettings = (await window.pet?.getSettings?.()) ?? null
  applyUiSettings(appSettings)

  // 每个模块的开关来自 settings.modules。<id>.enabled=false 时 ModuleHost
  // 会把状态记成 disabled，不 bootstrap、不留占位 —— 这就是「模块开关」。
  const configFor = (id) => {
    const toggle = appSettings?.modules?.[id]
    return { enabled: toggle?.enabled ?? true }
  }

  petalRegistry.register(bubbleModule, configFor('builtin.bubble'))
  petalRegistry.register(reminderModule, configFor('builtin.reminder'))
  petalRegistry.register(balanceModule, configFor('builtin.balance'))

  await moduleHost.startAll()

  // 模块刚把一次查询结果写进 memory，读出来填状态栏。
  // 模块没开或没写过就自己问一次，别让数字一直停在「—」。
  const snapshot = await sandboxPorts.readMemory(BALANCE_SNAPSHOT_KEY)
  if (snapshot !== null) {
    applyBalanceSnapshot(snapshot)
  } else if (appSettings?.modules?.['builtin.balance']?.enabled === true) {
    await refreshBalanceFromHost()
  }
  startBalanceRefresh()

  // 设置窗诊断区要读这行；describe() 已把状态压成单行。
  console.log(`[modules] ${moduleHost.describe()}`)

  if (moduleHost.placeholderIds().length > 0) {
    console.warn(`[modules] 占位卡：${moduleHost.placeholderIds().join('、')}`)
  }
}

void bootModules()

// 状态栏的三条数据源：指标、头像、心情。任一条失败都只影响自己那一格。
void initSystemStats()
void primeAssets()
void refreshMood()
setInterval(() => {
  void refreshMood()
}, 60_000)

// ---------- Live2D 渲染 ----------
//
// 单独一层 canvas：#stage 不能既是 2D 上下文又是 WebGL 上下文，
// 所以静态首帧那条路原样保留，Live2D 走自己的画布。
// 模型放在 userData/models，由使用者自己导入；这里只拿 pet-media:// 地址。

let live2dApp = null
let live2dModel = null
/** 自动描边的取消函数与最近一次采样结果，换模型时先撤旧的，避免描边叠两层。 */
let detachOutline = null
let outlineState = null

/**
 * 模型就位后接两件事：动作通道 + 自动描边。
 *
 * 两件都必须在「真的有模型」之后做，所以挂在加载成功的位置，
 * 不在启动时凭空建 —— 没有模型的空态里，动作和描边都无意义。
 */
function attachMotionAndOutline(app, model) {
  motionController?.stop()
  motionController = createMotionController({
    getModel: () => live2dModel ?? currentModel,
    ticker: app?.ticker ?? null,
    onEvent: (event) => {
      if (event.done === true) return
      setMediaStatus(`动作 ${event.key} · 通道 ${event.channel} · 来源 ${event.source}`)
    }
  })
  motionController.refresh()

  detachOutline?.()
  detachOutline = attachAutoOutline({
    canvas: app.view,
    renderer: app.renderer,
    thickness: Math.max(1.5, 2 * currentUiScale()),
    // 默认白边；设置里可以改成深边或按亮度自动挑。
    prefer: appSettings?.presence?.outline ?? DEFAULT_OUTLINE_PREFERENCE,
    onResult: (result) => {
      outlineState = result
      setMediaStatus(
        result.ok === true
          ? `描边 ${result.color} · 亮度 ${result.luma} · 取样 ${result.region}`
          : `描边未启用：${result.reason}`
      )
    }
  })

  // 心情档位在模型加载前可能已经算出来了，这里补一次，不用干等下一拍。
  const level = hud?.dataset.moodLevel
  if (typeof level === 'string' && level !== '') {
    lastMotionMood = ''
    driveMotionByMood(level)
  }
  if (hud !== null && hud.hidden === false) renderHud(lastHudInfo)
}
let live2dResizeObserver = null
/** 缩放缓冲：窗口拖动时先攒着，停手后一次性重建画布。 */
let live2dResizeTimer = null
let live2dResizePending = null

/**
 * 随包立绘兜底。
 *
 * 没有选中模型、Live2D 运行时缺失或载入失败时，用随包的 Cyrene 立绘
 * 先让人看见她。立绘也读不到时才回到空态卡，不假装加载成功。
 */
/**
 * 挑一张随包立绘：只认 Cyrene。
 *
 * manifest 的 poses.default 是唯一真源；manifest 缺失时退到 cyrene 分组的
 * stand/default.png。拿不到 Cyrene 时宁可回到空态，也不换一个人上场。
 */
function pickBundledStand(result) {
  const cyreneDefault = result?.cyrene?.poses?.default
  if (typeof cyreneDefault === 'string' && cyreneDefault !== '') {
    return { url: cyreneDefault, file: 'default.png', label: 'Cyrene · 默认立绘' }
  }

  const groups = Array.isArray(result?.groups) ? result.groups : []
  const cyreneGroup = groups.find((group) => group?.id === 'cyrene')
  const cyreneItems = Array.isArray(cyreneGroup?.items) ? cyreneGroup.items : []
  const cyreneStand =
    cyreneItems.find((item) => item?.file === 'stand/default.png') ??
    cyreneItems.find((item) => typeof item?.file === 'string' && item.file.startsWith('stand/'))
  if (typeof cyreneStand?.url === 'string' && cyreneStand.url !== '') {
    return {
      url: cyreneStand.url,
      file: cyreneStand.file.split('/').pop() || 'stand.png',
      label: `Cyrene · ${cyreneStand.name || '立绘'}`
    }
  }

  return null
}

async function loadBundledStand(reason) {
  try {
    const result = await window.pet?.listAssets?.()
    if (result?.ok !== true) return false

    // 头像与表情都从这份清单里取，顺手留给状态栏。
    assetsSnapshot = result
    const stand = pickBundledStand(result)
    if (stand === null) return false

    const response = await fetch(stand.url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    const file = new File([blob], stand.file, { type: blob.type || 'image/png' })

    await loadModel('image', file, stand.label)
    activateBundledScene(result, stand)
    setMediaStatus(`${lastStatus}（${reason}，已用随包立绘）`)
    // 静态立绘也是她：气泡和状态栏跟着放开。
    applyPresence(true)
    return true
  } catch (error) {
    console.warn('[fallback] 随包立绘载入失败：', error)
    return false
  }
}

/** 按当前画布尺寸把模型放到立绘区正中偏下。 */
function fitLive2DModel(app, model, naturalWidth, naturalHeight) {
  const scale = Math.min(app.screen.width / naturalWidth, app.screen.height / naturalHeight)
  model.scale.set(scale)
  model.x = (app.screen.width - naturalWidth * scale) / 2
  model.y = app.screen.height - naturalHeight * scale
}

function disposeLive2D() {
  if (live2dResizeTimer !== null) {
    clearTimeout(live2dResizeTimer)
    live2dResizeTimer = null
  }
  live2dResizePending = null
  if (live2dResizeObserver !== null) {
    live2dResizeObserver.disconnect()
    live2dResizeObserver = null
  }
  if (live2dModel !== null) {
    live2dModel.destroy()
    live2dModel = null
  }
  if (live2dApp !== null) {
    live2dApp.destroy(true, { children: true })
    live2dApp = null
  }
}

/**
 * 载入一个 Live2D 模型并铺满窗口。
 * 任何一步失败都 dispose 掉半成品，避免显存泄漏，也让空态卡能重新出现。
 */
async function loadLive2DUrl(modelUrl) {
  if (typeof modelUrl !== 'string' || modelUrl === '') {
    disposeLive2D()
    applyPresence(false)
    return { ok: false, reason: 'no-model' }
  }

  const live2d = window.PIXI?.live2d
  if (live2d === undefined) {
    // vendor 脚本没加载成功时如实回报，不假装在加载；先试静态立绘兜底。
    showBanner('Live2D 运行时未加载：检查 renderer/vendor 下的脚本')
    if (await loadBundledStand('Live2D 运行时未加载')) {
      return { ok: false, reason: 'runtime-missing-fallback' }
    }
    return { ok: false, reason: 'runtime-missing' }
  }

  disposeLive2D()
  setMediaStatus('正在载入模型……')

  // 画布必须跟立绘区一样大。
  // profile.w/h 是设计尺寸（600×800），窗口会按 window.scale 缩放；
  // 照设计尺寸建画布，内容就画到窗口外面去了，看上去像「没有立绘」。
  // 立绘区是 flex 里会收缩的那一段，气泡和状态条不参与它的尺寸计算。
  const host = document.getElementById('stage-area')
  const width = Math.max(1, Math.round(host.clientWidth || profile.w))
  const height = Math.max(1, Math.round(host.clientHeight || profile.h))

  const app = new window.PIXI.Application({
    width,
    height,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: true,
    resolution: dpr,
    autoDensity: true
  })
  app.view.id = 'live2d-stage'
  app.view.style.position = 'absolute'
  app.view.style.inset = '0'
  // 同时写死 CSS 尺寸，别让 canvas 的固有宽高反过来撑开它自己。
  app.view.style.width = '100%'
  app.view.style.height = '100%'
  app.view.style.zIndex = '1'
  app.view.style.pointerEvents = 'none'
  // 两层互斥：先把静态首帧收掉，再叠 Live2D 画布。
  hideStaticStage()
  host.appendChild(app.view)
  live2dApp = app

  const startedAt = performance.now()
  try {
    const model = await live2d.Live2DModel.from(modelUrl, { autoInteract: false })
    // 先记原始尺寸：scale.set() 之后 model.width/height 就变成缩放后的值，
    // 继续拿它们乘 scale 会缩两遍，模型被推出画布外，看上去像「没有立绘」。
    const naturalWidth = model.width
    const naturalHeight = model.height
    const scale = Math.min(app.screen.width / naturalWidth, app.screen.height / naturalHeight)
    fitLive2DModel(app, model, naturalWidth, naturalHeight)
    app.stage.addChild(model)
    live2dModel = model
    attachMotionAndOutline(app, model)

    // 状态栏、气泡的显隐会改变立绘区高度，Pixi 的内部画布不会自己跟上。
    // 不跟着 resize 的话，模型会按旧高度排版，被 CSS 纵向压扁。
    if (live2dResizeObserver !== null) live2dResizeObserver.disconnect()
    live2dResizeObserver = new ResizeObserver(() => {
      if (live2dApp === null || live2dModel === null) return
      const nextWidth = Math.max(1, Math.round(host.clientWidth))
      const nextHeight = Math.max(1, Math.round(host.clientHeight))
      // 拖动时 Windows 会一帧一帧地给窗口加 1px，再被主进程写回；
      // 这点差值肉眼看不出来，却会让 Pixi 每帧重建画布，观感就是「闪」。
      // 小于 2px 的抖动直接忽略，真正改尺寸时再同步。
      const EPSILON = 2
      if (
        Math.abs(nextWidth - live2dApp.screen.width) <= EPSILON &&
        Math.abs(nextHeight - live2dApp.screen.height) <= EPSILON
      ) {
        return
      }
      // 缩放缓冲：拖动期间每一帧都 resize 会连续重建 WebGL 画布，
      // 立绘看起来在抖。这里只记下最新尺寸，静置 140ms 再一次性应用。
      live2dResizePending = { width: nextWidth, height: nextHeight }
      if (live2dResizeTimer !== null) clearTimeout(live2dResizeTimer)
      live2dResizeTimer = setTimeout(() => {
        live2dResizeTimer = null
        const pending = live2dResizePending
        live2dResizePending = null
        if (pending === null || live2dApp === null || live2dModel === null) return
        // 定时器等待期间尺寸可能又变了，以最新读数为准。
        const width = Math.max(1, Math.round(host.clientWidth))
        const height = Math.max(1, Math.round(host.clientHeight))
        if (
          Math.abs(width - live2dApp.screen.width) <= EPSILON &&
          Math.abs(height - live2dApp.screen.height) <= EPSILON
        ) {
          return
        }
        live2dApp.renderer.resize(width, height)
        fitLive2DModel(live2dApp, live2dModel, naturalWidth, naturalHeight)
      }, 140)
    })
    live2dResizeObserver.observe(host)

    const costMs = Math.round(performance.now() - startedAt)
    mediaLabel = 'Live2D'
    setMediaStatus(`Live2D · ${Math.round(model.width)}×${Math.round(model.height)} · ${costMs}ms`)
    // 她出场了，气泡和状态栏跟着放开。
    applyPresence(true)
    // 诊断：把布局链路一次打全，免得靠猜判断「画在哪」。
    {
      const rectOf = (element) => {
        const box = element.getBoundingClientRect()
        return `${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.left)},${Math.round(box.top)}`
      }
      console.log(
        `[live2d] 布局 app=${rectOf(document.getElementById('app'))} view=${rectOf(app.view)} ` +
          `screen=${app.screen.width}x${app.screen.height} ` +
          `model=${Math.round(model.width)}x${Math.round(model.height)} ` +
          `scale=${scale.toFixed(3)} pos=${Math.round(model.x)},${Math.round(model.y)} ` +
          `alpha=${model.alpha} visible=${model.visible} ticker=${app.ticker.started}`
      )
    }
    console.log('[live2d] 已载入', modelUrl, `${costMs}ms`)
    return { ok: true, costMs }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[live2d] 载入失败:', message)
    disposeLive2D()
    setMediaStatus('模型载入失败')
    // 模型读不出来时先退回随包立绘；立绘也没有才留空态并提示原因。
    if (await loadBundledStand('Live2D 载入失败')) {
      return { ok: false, reason: 'load-failed-fallback', message }
    }
    applyPresence(false)
    showBanner(`模型载入失败：${message}`)
    return { ok: false, reason: 'load-failed', message }
  }
}

/** 启动时读一次当前模型。没有模型时先用随包立绘兜底，再等使用者导入。 */
async function bootActiveModel() {
  try {
    const active = await window.pet.getActiveModel()
    if (typeof active?.model?.url === 'string' && active.model.url !== '') {
      await loadLive2DUrl(active.model.url)
      return
    }
    const count = Array.isArray(active?.models) ? active.models.length : 0
    const reason = count > 0 ? '还没有选中模型' : '尚未导入模型'
    // 空窗口不是「降级」：先让随包立绘立起来，再把导入入口留给能力中心。
    if (await loadBundledStand(reason)) return

    setMediaStatus(count > 0 ? '已导入模型，但还没有选中' : '等待导入模型')
    // 没有可用的模型与立绘：只留引导卡，气泡和状态栏都不出现。
    applyPresence(false)
  } catch (error) {
    console.warn('[live2d] 读取当前模型失败：', error)
    if (await loadBundledStand('读取模型列表失败')) return
    setMediaStatus('读取模型列表失败')
    applyPresence(false)
  }
}

void bootActiveModel()

// 窗口尺寸变了，气泡可用的高度也跟着变；立绘区由 flex 自己收缩，这里只补测量。
window.addEventListener('resize', () => {
  updateStageMetrics()
})

// 排查入口：正式加载函数挂在独立全局名下，window.pet 是 contextBridge 对象不该往上挂东西。
window.__loadLive2D = loadLive2DUrl
window.__disposeLive2D = disposeLive2D

// 设置窗保存后主进程会广播，主界面即时生效，不必重启。
if (window.pet?.onSettingsChanged) {
  window.pet.onSettingsChanged((next) => {
    applyUiSettings(next)
  })
}

// 每日巡视小结与主动台词都由主进程推来；和台词共用同一条气泡出口。
if (window.pet?.onBubble) {
  window.pet.onBubble((payload) => {
    if (typeof payload?.text === 'string' && payload.text !== '') {
      const ackSegment = payload.ackSegment
      showBubble(payload.text, ackSegment ? HOLD_ACK_MS : HOLD_NOTICE_MS, {
        speak: false,
        ackSegment,
        emojiId: payload.emojiId
      })
      // AI 自己挑了动作就播；播不出来也如实记账，不影响这句话正常显示。
      if (typeof payload.motion === 'string' && payload.motion !== '') playAiMotion(payload.motion)
    }
  })
}

/**
 * 播 AI 指定的动作。
 *
 * AI 报的名字要经过动作表解析，解析不到就是它编的，记进展开行让人看见，
 * 不悄悄当成「播过了」。成功后把心情档位对齐，免得心情通道紧接着又插一个动作。
 */
function playAiMotion(name) {
  if (motionController === null) {
    lastMotionFailure = `ai:${name}→未接线`
    return
  }
  const result = motionController.play(name, { source: 'ai' })
  lastMotionFailure = result.ok === true ? '' : `ai:${name}→${result.reason ?? 'unknown'}`
  if (result.ok === true && hud !== null) lastMotionMood = hud.dataset.moodLevel ?? lastMotionMood
  if (hud !== null && hud.hidden === false) renderHud(lastHudInfo)
}

// 密钥环重建或隔离：说一句就够，细节留给设置里的加密备份。
if (window.pet?.onVaultNotice) {
  window.pet.onVaultNotice((notice) => {
    notifyBeta(notice?.message ?? '加密密钥状态有变化，请到设置里看看')
  })
}

// ---------- 审批 ----------

// 按钮已从主界面移除；远程拍板仍走同一条 DecisionGateway，
// 结果只更新内部状态，不写 DOM。
let pendingId = null

window.pet.onDecision((outcome) => {
  setMediaStatus(`审批结果：${outcome.status}${outcome.usedFallback ? '（超时，已回退本地）' : ''}`)
  pendingId = null
})

// 保留引用，避免被误判为未使用；模块健康由上面的 [modules] 行与设置窗诊断区读取。
void pendingId

// ---------- 开发自检：不弹文件框，直接走同一条四媒体加载路径 ----------

function dataUrlToFile(dataUrl, name, type) {
  const base64 = dataUrl.split(',')[1] ?? ''
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new File([bytes], name, { type })
}

async function recordWebm() {
  const source = document.createElement('canvas')
  source.width = 16
  source.height = 16
  const context = source.getContext('2d')
  if (context === null) throw new Error('拿不到 2d context')
  videoHolder.appendChild(source)
  const stream = source.captureStream(15)
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8'
    : 'video/webm'
  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve
  })
  recorder.start()
  let tick = 0
  const timer = setInterval(() => {
    context.fillStyle = tick++ % 2 === 0 ? '#f08bb4' : '#fffafc'
    context.fillRect(0, 0, 16, 16)
  }, 30)
  await new Promise((resolve) => setTimeout(resolve, 800))
  clearInterval(timer)
  recorder.requestData()
  await new Promise((resolve) => setTimeout(resolve, 100))
  recorder.stop()
  await stopped
  await new Promise((resolve) => setTimeout(resolve, 100))
  return new File(chunks, 'self-test.webm', { type: 'video/webm' })
}

window.__petSelfTest = async () => {
  const results = {}
  const png = dataUrlToFile(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'self-texture.png',
    'image/png'
  )

  try {
    await loadFromFiles([png])
    results.image = 'ok'
  } catch (error) {
    results.image = `fail:${error instanceof Error ? error.message : String(error)}`
  }

  try {
    const gif = dataUrlToFile(
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      'self-test.gif',
      'image/gif'
    )
    await loadFromFiles([gif])
    results.gif = 'ok'
  } catch (error) {
    results.gif = `fail:${error instanceof Error ? error.message : String(error)}`
  }

  try {
    const video = await recordWebm()
    results.videoSize = video.size
    results.videoMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'vp8' : 'webm'
    await loadFromFiles([video])
    results.video = 'ok'
  } catch (error) {
    const element = videoHolder.querySelector('video')
    results.video = `fail:${error instanceof Error ? error.message : String(error)}`
    results.videoError = element?.error?.code ?? 'none'
    results.videoNetwork = element?.networkState ?? -1
    results.videoReady = element?.readyState ?? -1
  }

  try {
    const manifest = new File(
      [JSON.stringify({ textures: ['self-texture.png'] })],
      'self.model3.json',
      { type: 'application/json' }
    )
    await loadFromFiles([manifest, png])
    results.live2d = 'ok'
  } catch (error) {
    results.live2d = `fail:${error instanceof Error ? error.message : String(error)}`
  }

  results.status = lastStatus
  return results
}
