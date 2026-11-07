const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, protocol, net } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const BASE_WIDTH = 480
const BASE_HEIGHT = 560
/* 卡片模式：不显示立绘，只留一块审批 / 提问卡片的位置 */
const CARD_WIDTH = 380
const CARD_HEIGHT = 240
const DATA_DIR = process.env.CYRENE_PET_HOME
  ? path.resolve(process.env.CYRENE_PET_HOME)
  : path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '.', '.dsh'), 'storages', 'cyrene-pet')
const STATE_PATH = path.join(DATA_DIR, 'state.json')
const STATUS_PATH = path.join(DATA_DIR, 'pet-status.json')
const WINDOW_STATE_PATH = path.join(DATA_DIR, 'pet-window.json')
const LIVE_PATH = path.join(DATA_DIR, 'live.json')
const COMMAND_PATH = path.join(DATA_DIR, 'pet-command.json')

/* ------------------------------ 受限素材协议 ------------------------------ */

/*
 * 渲染层不再拿 file:// 绝对路径。素材只通过 pet-media://local/ 读取，按前缀分根：
 *   plugin/ —— 插件自己的页面与内置素材
 *   models/ —— 用户导入的素材包
 * 单 host 是为了让页面、图片、Live2D 纹理同源，避免 WebGL 跨域读纹理失败。
 * 其它 host、未知前缀、越界路径、空路径一律拒绝。
 */
const MEDIA_HOST = 'local'
const MEDIA_PREFIXES = [
  { prefix: 'plugin/', root: path.join(__dirname, '..') },
  { prefix: 'models/', root: path.join(DATA_DIR, 'models') },
]

const MEDIA_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.moc3': 'application/octet-stream',
  '.wasm': 'application/wasm',
}

function toMediaUrl(prefix, segments) {
  const safe = segments
    .filter((item) => typeof item === 'string' && item !== '')
    .map((item) => item.split('/').filter(Boolean).map(encodeURIComponent).join('/'))
    .join('/')
  return `pet-media://${MEDIA_HOST}/${prefix}${safe}`
}

function resolveMediaPath(requestUrl) {
  let parsed = null
  try {
    parsed = new URL(requestUrl)
  } catch {
    return ''
  }
  if (parsed.protocol !== 'pet-media:' || parsed.hostname !== MEDIA_HOST) return ''
  let relative = ''
  try {
    relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  } catch {
    return ''
  }
  if (relative === '' || relative.includes('\0')) return ''
  const entry = MEDIA_PREFIXES.find((item) => relative.startsWith(item.prefix))
  if (entry === undefined) return ''
  const rest = relative.slice(entry.prefix.length)
  if (rest === '') return ''
  const target = path.resolve(entry.root, rest)
  const inside = path.relative(entry.root, target)
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return ''
  return target
}

function registerMediaProtocol() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'pet-media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ])
}

function installMediaHandler() {
  protocol.handle('pet-media', (request) => {
    const file = resolveMediaPath(request.url)
    if (file === '') return new Response('not found', { status: 404 })
    try {
      const info = fs.statSync(file)
      if (!info.isFile()) return new Response('not found', { status: 404 })
    } catch {
      return new Response('not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(file).href).catch(() => {
      const type = MEDIA_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
      return new Response(fs.readFileSync(file), { headers: { 'content-type': type } })
    })
  })
}

registerMediaProtocol()

/* ------------------------------ 背景图 ------------------------------ */

const BACKGROUND_DIR = path.join(DATA_DIR, 'backgrounds')
const BACKGROUND_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}
const BACKGROUND_MAX_BYTES = 24 * 1024 * 1024

function safeBackgroundName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name) ? name : ''
}

const BUILTIN_BACKGROUND_DIR = path.join(__dirname, '..', 'assets', 'backgrounds')
const BUILTIN_SEED_MARKER = path.join(BACKGROUND_DIR, '.builtin-seeded')

/* marker 记录已经放过的文件名；旧版 marker 是时间戳，读不出名单时按「已放过」处理 */
function readSeededBackgrounds() {
  try {
    const raw = fs.readFileSync(BUILTIN_SEED_MARKER, 'utf8').trim()
    if (raw.startsWith('{')) {
      const data = JSON.parse(raw)
      if (Array.isArray(data.names)) return new Set(data.names)
    }
  } catch {
    /* marker 缺失或损坏，按首次启动处理 */
  }
  return null
}

/* 每次启动补一次新内置图；用户删掉的不会补回来，后续版本新增的仍能进到已装环境 */
function seedBuiltinBackgrounds() {
  const seeded = readSeededBackgrounds()
  try {
    const names = fs.readdirSync(BUILTIN_BACKGROUND_DIR)
    fs.mkdirSync(BACKGROUND_DIR, { recursive: true })
    const next = seeded ?? new Set()
    for (const name of names) {
      if (safeBackgroundName(name) === '') continue
      if (BACKGROUND_TYPES[path.extname(name).toLowerCase()] === undefined) continue
      if (seeded !== null && seeded.has(name)) continue
      const target = path.join(BACKGROUND_DIR, name)
      if (seeded === null && fs.existsSync(target)) {
        next.add(name)
        continue
      }
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(BUILTIN_BACKGROUND_DIR, name), target)
      next.add(name)
    }
    fs.writeFileSync(BUILTIN_SEED_MARKER, JSON.stringify({ names: [...next].sort() }))
  } catch {
    /* 内置图缺失不影响用户自己上传 */
  }
}

function listBackgroundFiles() {
  try {
    return fs.readdirSync(BACKGROUND_DIR)
      .filter((name) => safeBackgroundName(name) !== '' && BACKGROUND_TYPES[path.extname(name).toLowerCase()] !== undefined)
      .map((name) => {
        try {
          const info = fs.statSync(path.join(BACKGROUND_DIR, name))
          return info.isFile()
            ? { id: name, size: info.size, addedAt: Math.round(info.mtimeMs), builtin: name.startsWith('builtin-') }
            : null
        } catch {
          return null
        }
      })
      .filter((item) => item !== null && item.size > 0)
      .sort((a, b) => a.addedAt - b.addedAt)
  } catch {
    return []
  }
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 1.75
const MAX_EXTRA_HEIGHT = 360

let win = null
let tray = null
let zoom = 1
let alwaysOnTop = true
let hidden = false
let dragging = false
let dragTimer = null
let dragCursor = null
let liveMtime = 0
let liveTimer = null
let cursorTimer = null
let captureTimer = null
let extraHeight = 0
let targetSize = { width: 0, height: 0 }
let shownAskId = 0
let shownApprovalId = 0
let cardOnly = false

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
}

/* ------------------------------ 状态读写 ------------------------------ */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(temp, file)
  } catch {
    /* 状态写入失败不影响桌宠本身 */
  }
}

function writeStatus(payload) {
  const previous = readJson(STATUS_PATH, {})
  writeJson(STATUS_PATH, { ...previous, at: new Date().toISOString(), ...payload })
}

/* 界面模式由宿主写进 state.json，桌宠启动时读一次；切换后由设置页触发重启 */
function readUiMode() {
  const saved = readJson(STATE_PATH, null)
  return saved !== null && saved.ui === 'card' ? 'card' : 'pet'
}

/* 形象渲染由宿主写进 state.json：默认立绘；选了 Live2D 且模型文件存在才走 Live2D */
let modelPack = null

/* model-pack 是 ESM，主进程这边用动态 import 载入；失败就只走内置立绘 */
async function loadModelPack() {
  try {
    modelPack = await import(pathToFileURL(path.join(__dirname, 'model-pack.mjs')).href)
  } catch {
    modelPack = null
  }
}

/** 读自定义素材配置；没装、目录丢了、sprite.json 坏了都返回 null。 */
function readModelConfig() {
  const saved = readJson(STATE_PATH, null)
  const id = saved !== null && typeof saved.modelId === 'string' ? saved.modelId.trim() : ''
  if (id === '' || modelPack === null) return null
  const dir = path.join(DATA_DIR, 'models', id)
  return modelPack.resolveModelConfig(dir, id)
}

function readRenderer() {
  const config = readModelConfig()
  if (config !== null) return config.kind === 'live2d' ? 'live2d' : 'sprite'
  const saved = readJson(STATE_PATH, null)
  if (saved === null || saved.renderer !== 'live2d') return 'sprite'
  const model = path.join(__dirname, 'assets', 'live2d', 'cyrene', 'Cyrene.model3.json')
  return fs.existsSync(model) ? 'live2d' : 'sprite'
}

function loadWindowState() {
  const saved = readJson(WINDOW_STATE_PATH, {})
  zoom = Number.isFinite(Number(saved.zoom)) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(saved.zoom))) : 1
  alwaysOnTop = saved.alwaysOnTop !== false
  hidden = saved.visible === false
  return saved
}

function saveWindowState(extra) {
  if (win === null) return
  const bounds = win.getBounds()
  const previous = readJson(WINDOW_STATE_PATH, {})
  writeJson(WINDOW_STATE_PATH, {
    ...previous,
    x: bounds.x,
    y: bounds.y,
    bottomY: bounds.y + bounds.height,
    zoom,
    extra: extraHeight,
    alwaysOnTop,
    visible: !hidden,
    ...extra,
    at: Date.now(),
  })
}

/* ------------------------------ 窗口 ------------------------------ */

function clampToDisplay(x, y, width, height) {
  const displays = screen.getAllDisplays()
  const visible = displays.some((display) => {
    const area = display.workArea
    const overlapW = Math.min(x + width, area.x + area.width) - Math.max(x, area.x)
    const overlapH = Math.min(y + height, area.y + area.height) - Math.max(y, area.y)
    return overlapW > width / 3 && overlapH > height / 3
  })
  if (visible) return { x, y }
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(area.x + area.width - width - 24),
    y: Math.round(area.y + area.height - height - 24),
  }
}

function trayIcon() {
  const candidates = [
    path.join(path.dirname(app.getAppPath()), 'icon.png'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
  ]
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const image = nativeImage.createFromPath(file)
      if (!image.isEmpty()) return image.resize({ width: 16, height: 16 })
    } catch {
      /* 继续找下一个图标 */
    }
  }
  return nativeImage.createEmpty()
}

function keepInside(x, y, width, height) {
  const area = screen.getDisplayMatching({ x, y, width, height }).workArea
  const maxX = area.x + area.width - width - 8
  const maxY = area.y + area.height - height - 8
  return {
    x: Math.round(Math.min(Math.max(x, area.x + 8), Math.max(area.x + 8, maxX))),
    y: Math.round(Math.min(Math.max(y, area.y + 8), Math.max(area.y + 8, maxY))),
  }
}

/* 窗口尺寸由程序控制：保持 resizable 以便 setBounds 生效，用户拖边缘改出来的尺寸会被拉回去 */
function applyBounds(x, y, width, height) {
  if (win === null || win.isDestroyed()) return
  targetSize = { width, height }
  win.setBounds({ x, y, width, height }, false)
}

/* 用户拖窗口边缘、或系统替我们改了尺寸时，把尺寸拉回程序设定的值；底边保持不动 */
function restoreTargetSize() {
  if (win === null || win.isDestroyed()) return
  if (targetSize.width <= 0 || targetSize.height <= 0) return
  const bounds = win.getBounds()
  if (bounds.width === targetSize.width && bounds.height === targetSize.height) return
  applyBounds(
    bounds.x,
    bounds.y + bounds.height - targetSize.height,
    targetSize.width,
    targetSize.height,
  )
  saveWindowState()
}

function applyZoom(next) {
  if (win === null || cardOnly) return
  const value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next) || 1))
  const bounds = win.getBounds()
  const width = Math.round(BASE_WIDTH * value)
  const height = Math.round(BASE_HEIGHT * value)
  zoom = value
  extraHeight = 0
  const anchorX = bounds.x + Math.round((bounds.width - width) / 2)
  const anchorY = bounds.y + Math.round(bounds.height - height)
  const inside = keepInside(anchorX, anchorY, width, height)
  applyBounds(inside.x, inside.y, width, height)
  saveWindowState()
  rebuildTray()
  win.webContents.send('pet:zoom', { zoom, baseWidth: width, baseHeight: height })
}

/* 卡片模式打开设置时临时放大窗口，关掉设置再缩回卡片大小 */
function setCardPanel(mode) {
  if (win === null || !cardOnly) return
  const width = mode === 'settings' ? BASE_WIDTH : CARD_WIDTH
  const height = mode === 'settings' ? BASE_HEIGHT : CARD_HEIGHT
  const bounds = win.getBounds()
  const bottom = bounds.y + bounds.height
  const position = keepInside(bounds.x, bottom - height, width, height)
  applyBounds(position.x, position.y, width, height)
  saveWindowState()
}

/* 一键归位：放回主屏右下角，多屏拔插或缩放变化后也能把桌宠找回来 */
function dockToBottomRight() {
  if (win === null || win.isDestroyed()) return false
  const bounds = win.getBounds()
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(bounds.width, Math.max(1, area.width - 16))
  const height = Math.min(bounds.height, Math.max(1, area.height - 16))
  const position = keepInside(
    Math.round(area.x + area.width - width - 24),
    Math.round(area.y + area.height - height - 24),
    width,
    height,
  )
  applyBounds(position.x, position.y, width, height)
  saveWindowState()
  writeStatus({ docked: true, dockAt: Date.now() })
  return true
}

/* 显示器分辨率、缩放或数量变化后，把当前窗口重新拉回可见区域 */
function reclampToDisplays() {
  if (win === null || win.isDestroyed()) return false
  const bounds = win.getBounds()
  const clamped = clampToDisplay(bounds.x, bounds.y, bounds.width, bounds.height)
  const position = keepInside(clamped.x, clamped.y, bounds.width, bounds.height)
  if (position.x === bounds.x && position.y === bounds.y) return false
  applyBounds(position.x, position.y, bounds.width, bounds.height)
  saveWindowState()
  return true
}

/* 状态栏展开时窗口向上长高：底边固定、只往上长，状态栏和人物都不会被推走 */
function applyExtraHeight(extra) {
  if (win === null) return extraHeight
  if (cardOnly) return extraHeight
  const baseHeight = Math.round(BASE_HEIGHT * zoom)
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  /* 高度不超过工作区，否则状态栏会被顶到屏幕外 */
  const ceiling = Math.max(0, area.height - 8 - baseHeight)
  const value = Math.max(0, Math.min(MAX_EXTRA_HEIGHT, ceiling, Math.round(Number(extra) || 0)))
  if (Math.abs(value - extraHeight) < 1) return extraHeight
  extraHeight = value
  const width = Math.round(BASE_WIDTH * zoom)
  const height = baseHeight + value
  const bottom = bounds.y + bounds.height
  /* 从底边往上长；贴屏幕顶时允许伸出屏幕外，那块是透明的，人物和状态栏仍在原位 */
  applyBounds(bounds.x, bottom - height, width, height)
  saveWindowState()
  return extraHeight
}

function setPetVisible(next) {
  hidden = !next
  if (win === null) return
  if (hidden) win.hide()
  else win.showInactive()
  saveWindowState()
  rebuildTray()
}

function setAlwaysOnTop(next) {
  alwaysOnTop = next === true
  if (win !== null) win.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
  saveWindowState()
}

function rebuildTray() {
  if (tray === null) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: hidden ? '显示桌宠' : '隐藏桌宠', click: () => setPetVisible(hidden) },
      {
        label: '回到右下角',
        click: () => {
          setPetVisible(true)
          dockToBottomRight()
        },
      },
      { type: 'separator' },
      {
        label: '打开设置',
        click: () => {
          setPetVisible(true)
          if (win !== null) win.webContents.send('pet:open-settings')
        },
      },
      { label: '退出桌宠', click: () => app.quit() },
    ]),
  )
}

function createWindow() {
  const saved = loadWindowState()
  cardOnly = readUiMode() === 'card'
  const width = Math.round((cardOnly ? CARD_WIDTH : BASE_WIDTH) * (cardOnly ? 1 : zoom))
  const baseHeight = Math.round((cardOnly ? CARD_HEIGHT : BASE_HEIGHT) * (cardOnly ? 1 : zoom))
  /* 上次的状态栏撑高也一起恢复：重启时窗口不会先矮后长，人物不闪 */
  const savedExtra = cardOnly ? 0 : Number(saved.extra)
  extraHeight = Number.isFinite(savedExtra)
    ? Math.max(0, Math.min(MAX_EXTRA_HEIGHT, Math.round(savedExtra)))
    : 0
  const height = baseHeight + extraHeight
  /* 以底边为锚：窗口随状态栏长高时，人物不会整体漂移 */
  const savedBottom = Number.isFinite(Number(saved.bottomY))
    ? Number(saved.bottomY)
    : Number.isFinite(Number(saved.y))
      ? Number(saved.y) + height
      : NaN
  const topY = Number.isFinite(savedBottom) ? Math.round(savedBottom - height) : Number.MAX_SAFE_INTEGER
  const fallback = clampToDisplay(
    Number.isFinite(saved.x) ? Number(saved.x) : Number.MAX_SAFE_INTEGER,
    topY,
    width,
    height,
  )
  const rawPosition = Number.isFinite(saved.x) && Number.isFinite(topY)
    ? clampToDisplay(saved.x, topY, width, height)
    : fallback
  const position = keepInside(rawPosition.x, rawPosition.y, width, height)

  win = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    transparent: true,
    frame: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop,
    show: false,
    title: '昔涟 · 桌宠',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  win.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  targetSize = { width, height }
  win.on('will-resize', (event) => event.preventDefault())
  /* 兜底：Windows 上无边框窗口仍可能被拖出别的尺寸，这里立刻拉回来 */
  win.on('resize', () => restoreTargetSize())

  win.once('ready-to-show', () => {
    if (hidden) win.hide()
    else win.showInactive()

    clearTimeout(captureTimer)
    captureTimer = setTimeout(() => {
      void captureDiagnostics()
    }, 2600)
  })

  win.on('moved', () => saveWindowState())

  win.on('closed', () => {
    win = null
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    writeStatus({ fatal: 'render-process-gone', details })
  })

  const query = new URLSearchParams()
  if (cardOnly) query.set('ui', 'card')
  if (!cardOnly && readRenderer() === 'live2d') query.set('renderer', 'live2d')
  if (!cardOnly) {
    const model = readModelConfig()
    if (model !== null) {
      const payload = { ...model, entry: toMediaUrl('models/', [model.id, model.entry]) }
      if (Array.isArray(model.poses)) {
        payload.poses = model.poses.map((pose) => ({
          name: pose.name,
          url: toMediaUrl('models/', [model.id, pose.file]),
        }))
      }
      query.set('model', JSON.stringify(payload))
    }
  }
  /* 渲染层加载完成前推送的 live 会丢；这里清掉时间戳，重发一次 */
  win.webContents.on('did-finish-load', () => {
    liveMtime = 0
    pushLive()
  })

  const suffix = query.toString() === '' ? '' : `?${query.toString()}`
  void win.loadURL(`pet-media://${MEDIA_HOST}/plugin/pet/index.html${suffix}`)
}

/* ------------------------------ 拖拽 ------------------------------ */

function stopDragTimer() {
  if (dragTimer !== null) {
    clearInterval(dragTimer)
    dragTimer = null
  }
  dragCursor = null
}

function startDrag() {
  if (win === null || dragging) return
  dragging = true
  dragCursor = screen.getCursorScreenPoint()
  stopDragTimer()
  dragTimer = setInterval(() => {
    if (win === null || !dragging) return
    const point = screen.getCursorScreenPoint()
    if (dragCursor === null) {
      dragCursor = point
      return
    }
    const dx = point.x - dragCursor.x
    const dy = point.y - dragCursor.y
    if (dx === 0 && dy === 0) return
    const bounds = win.getBounds()
    win.setBounds({ x: bounds.x + dx, y: bounds.y + dy, width: bounds.width, height: bounds.height })
    dragCursor = point
  }, 16)
}

function endDrag() {
  if (!dragging) return
  dragging = false
  stopDragTimer()
  if (win !== null) {
    const bounds = win.getBounds()
    const position = clampToDisplay(bounds.x, bounds.y, bounds.width, bounds.height)
    if (position.x !== bounds.x || position.y !== bounds.y) {
      win.setBounds({ ...bounds, ...position })
    }
  }
  saveWindowState()
}

/* ------------------------------ 与 dsh 插件同步 ------------------------------ */

function pushLive() {
  if (win === null) return
  try {
    const stat = fs.statSync(LIVE_PATH)
    if (stat.mtimeMs === liveMtime) return
    liveMtime = stat.mtimeMs
    const data = readJson(LIVE_PATH, null)
    if (data !== null) {
      /* 对话里的提问要接管时，先把藏起来的桌宠叫出来 */
      const ask = data.ask
      if (ask !== null && typeof ask === 'object' && ask.source === 'conversation') {
        const askId = Number(ask.id) || 0
        if (askId !== 0 && askId !== shownAskId) {
          shownAskId = askId
          if (hidden) setPetVisible(true)
        }
      }
      /* 风险审批同样把藏起来的桌宠叫出来 */
      const approval = data.approval
      if (approval !== null && typeof approval === 'object') {
        const approvalId = Number(approval.id) || 0
        if (approvalId !== 0 && approvalId !== shownApprovalId) {
          shownApprovalId = approvalId
          if (hidden) setPetVisible(true)
        }
      }
      win.webContents.send('pet:live', data)
      clearTimeout(captureTimer)
      captureTimer = setTimeout(() => {
        void captureDiagnostics()
      }, 1800)
    }
  } catch {
    /* live.json 还没生成 */
  }
}

/* ------------------------------ 诊断 ------------------------------ */

async function captureDiagnostics() {
  if (win === null) return
  try {
    const image = await win.capturePage()
    const size = image.getSize()
    const bitmap = image.toBitmap()
    let filled = 0
    let r = 0
    let g = 0
    let b = 0
    let vivid = 0
    for (let i = 0; i < bitmap.length; i += 4) {
      const alpha = bitmap[i + 3]
      if (alpha <= 8) continue
      filled++
      const bb = bitmap[i]
      const gg = bitmap[i + 1]
      const rr = bitmap[i + 2]
      r += rr
      g += gg
      b += bb
      if (Math.max(rr, gg, bb) - Math.min(rr, gg, bb) > 40) vivid++
    }
    const total = bitmap.length / 4
    fs.writeFileSync(path.join(DATA_DIR, 'pet-capture.png'), image.toPNG())
    writeStatus({
      captured: true,
      captureSize: size,
      filled,
      total,
      filledRatio: Math.round((filled / total) * 1000) / 1000,
      avgColor: filled === 0 ? null : [Math.round(r / filled), Math.round(g / filled), Math.round(b / filled)],
      vividRatio: filled === 0 ? 0 : Math.round((vivid / filled) * 1000) / 1000,
    })
  } catch (error) {
    writeStatus({ captured: false, captureError: String(error) })
  }
}

/* ------------------------------ 生命周期 ------------------------------ */

app.whenReady().then(async () => {
  app.setAppUserModelId('dsh.cyrene.pet')
  /* 受限素材协议必须在建窗之前挂上，否则首帧的 relative 资源会拿不到 */
  installMediaHandler()
  /* 诊断文件每次启动重写一次：旧版本的字段不会残留下来误导排查 */
  writeJson(STATUS_PATH, { at: new Date().toISOString(), stage: 'boot' })
  seedBuiltinBackgrounds()
  /* 素材包解析器先就绪，createWindow 才知道这次该把哪个形象交给渲染层 */
  await loadModelPack()
  createWindow()

  /* 换分辨率、改缩放、拔掉副屏时，窗口可能落在看不见的地方 */
  screen.on('display-metrics-changed', reclampToDisplays)
  screen.on('display-removed', reclampToDisplays)

  try {
    tray = new Tray(trayIcon())
    tray.setToolTip('昔涟 · 桌宠')
    tray.on('click', () => setPetVisible(hidden))
    rebuildTray()
  } catch (error) {
    writeStatus({ trayError: String(error) })
  }

  clearInterval(liveTimer)
  liveTimer = setInterval(pushLive, 800)
  pushLive()

  clearInterval(cursorTimer)
  cursorTimer = setInterval(() => {
    if (win === null || win.isDestroyed() || !win.isVisible()) return
    try {
      const point = screen.getCursorScreenPoint()
      const bounds = win.getBounds()
      win.webContents.send('pet:cursor', { x: point.x - bounds.x, y: point.y - bounds.y })
    } catch {
      /* 取不到光标位置时跳过这一帧 */
    }
  }, 80)

  ipcMain.handle('pet:status', (_event, payload) => {
    writeStatus(payload)
    return true
  })
  ipcMain.handle('pet:bounds', () => (win === null ? null : win.getBounds()))
  ipcMain.handle('pet:dock', () => dockToBottomRight())
  ipcMain.handle('pet:window-state', () => ({
    zoom,
    alwaysOnTop,
    visible: !hidden,
    ui: cardOnly ? 'card' : 'pet',
    baseWidth: cardOnly ? CARD_WIDTH : Math.round(BASE_WIDTH * zoom),
    baseHeight: cardOnly ? CARD_HEIGHT : Math.round(BASE_HEIGHT * zoom),
    extraHeight,
  }))
  ipcMain.handle('pet:set-zoom', (_event, value) => {
    applyZoom(value)
    return zoom
  })
  ipcMain.handle('pet:set-always-on-top', (_event, value) => {
    setAlwaysOnTop(value === true)
    return alwaysOnTop
  })
  ipcMain.handle('pet:set-interactive', (_event, value) => {
    if (win === null || dragging) return false
    win.setIgnoreMouseEvents(value !== true, { forward: true })
    return true
  })
  ipcMain.handle('pet:extra-height', (_event, value) => applyExtraHeight(value))
  ipcMain.handle('pet:card-panel', (_event, mode) => {
    setCardPanel(mode)
    return true
  })
  ipcMain.handle('pet:drag-start', () => {
    startDrag()
    return true
  })
  ipcMain.handle('pet:drag-end', () => {
    endDrag()
    return true
  })
  ipcMain.handle('pet:command', (_event, payload) => {
    const command = { id: Date.now(), at: new Date().toISOString(), ...payload }
    writeJson(COMMAND_PATH, command)
    return true
  })
  /* 背景图：渲染层只拿字节和清单，真正落盘在这里，宿主半只存选中的 id */
  ipcMain.handle('pet:backgrounds', () => listBackgroundFiles())
  ipcMain.handle('pet:background-data', (_event, id) => {
    const name = safeBackgroundName(id)
    if (name === '') return ''
    const type = BACKGROUND_TYPES[path.extname(name).toLowerCase()]
    if (type === undefined) return ''
    try {
      const bytes = fs.readFileSync(path.join(BACKGROUND_DIR, name))
      if (bytes.length === 0 || bytes.length > BACKGROUND_MAX_BYTES) return ''
      return `data:${type};base64,${bytes.toString('base64')}`
    } catch {
      return ''
    }
  })
  ipcMain.handle('pet:background-upload', (_event, payload) => {
    const raw = payload !== null && typeof payload?.dataUrl === 'string' ? payload.dataUrl : ''
    const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(raw)
    if (match === null) return { ok: false, error: '图片格式不对，请重新选择' }
    const ext = Object.keys(BACKGROUND_TYPES).find((key) => BACKGROUND_TYPES[key] === match[1].toLowerCase())
    if (ext === undefined) return { ok: false, error: '只支持 PNG / JPG / GIF / WebP / AVIF' }
    const bytes = Buffer.from(match[2], 'base64')
    if (bytes.length === 0) return { ok: false, error: '图片是空的' }
    if (bytes.length > BACKGROUND_MAX_BYTES) return { ok: false, error: '图片超过 24MB，换一张小一点的吧' }
    try {
      fs.mkdirSync(BACKGROUND_DIR, { recursive: true })
      const name = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`
      fs.writeFileSync(path.join(BACKGROUND_DIR, name), bytes)
      return { ok: true, id: name }
    } catch (error) {
      return { ok: false, error: error?.message ?? '写入失败' }
    }
  })
  ipcMain.handle('pet:background-remove', (_event, id) => {
    const name = safeBackgroundName(id)
    if (name === '') return false
    try {
      fs.unlinkSync(path.join(BACKGROUND_DIR, name))
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('pet:hide', () => {
    setPetVisible(false)
    return true
  })
  ipcMain.handle('pet:quit', () => {
    app.quit()
    return true
  })
})

app.on('second-instance', () => {
  if (win !== null) win.showInactive()
})

app.on('before-quit', () => {
  endDrag()
  clearInterval(liveTimer)
  clearTimeout(captureTimer)
  saveWindowState()
})

app.on('window-all-closed', () => {
  app.quit()
})
