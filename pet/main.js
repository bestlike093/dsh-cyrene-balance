const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const BASE_WIDTH = 480
const BASE_HEIGHT = 560
const DATA_DIR = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '.', '.dsh'), 'storages', 'cyrene-pet')
const STATUS_PATH = path.join(DATA_DIR, 'pet-status.json')
const WINDOW_STATE_PATH = path.join(DATA_DIR, 'pet-window.json')
const LIVE_PATH = path.join(DATA_DIR, 'live.json')
const COMMAND_PATH = path.join(DATA_DIR, 'pet-command.json')

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
  if (win === null) return
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

/* 状态栏展开时窗口向上长高：底边固定、只往上长，状态栏和人物都不会被推走 */
function applyExtraHeight(extra) {
  if (win === null) return extraHeight
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
  alwaysOnTop = next
  if (win !== null) win.setAlwaysOnTop(next, 'screen-saver')
  saveWindowState()
  rebuildTray()
}

function sendCommand(payload) {
  try {
    writeJson(COMMAND_PATH, { id: Date.now(), at: new Date().toISOString(), ...payload })
  } catch {
    /* 命令写不进去时不影响窗口 */
  }
}

function rebuildTray() {
  if (tray === null) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: hidden ? '显示桌宠' : '先藏起来', click: () => setPetVisible(hidden) },
      { label: '总在最前', type: 'checkbox', checked: alwaysOnTop, click: (item) => setAlwaysOnTop(item.checked) },
      { type: 'separator' },
      { label: '说句话', click: () => sendCommand({ action: 'say' }) },
      { label: '换一个姿势', click: () => sendCommand({ action: 'pose' }) },
      { label: '刷新余额', click: () => sendCommand({ action: 'refresh' }) },
      { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ]),
  )
}

function createWindow() {
  const saved = loadWindowState()
  const width = Math.round(BASE_WIDTH * zoom)
  const baseHeight = Math.round(BASE_HEIGHT * zoom)
  /* 上次的状态栏撑高也一起恢复：重启时窗口不会先矮后长，人物不闪 */
  const savedExtra = Number(saved.extra)
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
      sandbox: false,
      nodeIntegration: false,
      webSecurity: false,
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

  void win.loadFile(path.join(__dirname, 'index.html'))
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

app.whenReady().then(() => {
  app.setAppUserModelId('dsh.cyrene.pet')
  /* 诊断文件每次启动重写一次：旧版本的字段不会残留下来误导排查 */
  writeJson(STATUS_PATH, { at: new Date().toISOString(), stage: 'boot' })
  createWindow()

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
  ipcMain.handle('pet:window-state', () => ({
    zoom,
    alwaysOnTop,
    visible: !hidden,
    baseWidth: Math.round(BASE_WIDTH * zoom),
    baseHeight: Math.round(BASE_HEIGHT * zoom),
    extraHeight,
  }))
  ipcMain.handle('pet:set-zoom', (_event, value) => {
    applyZoom(value)
    return zoom
  })
  ipcMain.handle('pet:set-interactive', (_event, value) => {
    if (win === null || dragging) return false
    win.setIgnoreMouseEvents(value !== true, { forward: true })
    return true
  })
  ipcMain.handle('pet:extra-height', (_event, value) => applyExtraHeight(value))
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
