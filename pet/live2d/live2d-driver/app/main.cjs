'use strict'

/**
 * 遐蝶的 Live2D 桌面驱动 · 主进程
 *
 * 形态参考鲸语 jingyu-live2d 的 desktop-pet：一扇很薄的透明窗，渲染全部交给网页。
 * 窗口只做四件事：起本地静态服务、开窗、收命令、放状态。
 * 模型不写死——--model 指到哪个目录，就服务哪个目录。
 *
 *   electron.exe <本目录> --model <模型目录> [--width 420] [--height 640]
 *                        [--port 61945] [--shot <截图路径>] [--catalog <目录文件>]
 *                        [--gui]（同时打开控制台窗口）
 *
 * 本地接口（都绑定 127.0.0.1）：
 *   GET  /api/model            当前模型 model3 的相对地址
 *   GET  /api/state            窗口 bounds + 渲染层上报的状态
 *   GET  /api/catalog          渲染层生成的模型目录（参数表 / 表情 / 动作组）
 *   POST /api/command          命令透传给渲染层，返回执行结果
 *   POST /api/shot             截当前窗口（target: pet | control）
 */

const { app, BrowserWindow, ipcMain, screen, Tray, nativeImage, Menu, dialog, shell } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { URL } = require('node:url')

const argv = process.argv.slice(1)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(name)
const toInt = (value, fallback) => {
  const n = Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : fallback
}

const WEB_ROOT = path.join(__dirname, '..', 'web')
const DOC_PATH = path.join(__dirname, '..', 'docs', 'METHOD.md')
const DEFAULT_MODEL = path.join(__dirname, '..', '..', 'models', 'xiaodie')
let modelDir = path.resolve(arg('--model', process.env.L2D_MODEL_DIR || DEFAULT_MODEL))
let petWidth = toInt(arg('--width', 420), 420)
let petHeight = toInt(arg('--height', 640), 640)
const SHOT = arg('--shot', '')
const CATALOG_PATH = arg('--catalog', '')
const GUI = flag('--gui')
const SIZE_GUARD = !flag('--no-size-guard')
const USER_NAME = arg('--user-name', process.env.L2D_USER_NAME || '风铃')
const DSH_URL = arg('--dsh-url', process.env.L2D_DSH_URL || 'http://127.0.0.1:54819')
const PERSONA_PATH = arg('--persona', process.env.L2D_PERSONA || '')
const EMOJI_DIR = arg(
  '--emoji-dir',
  process.env.L2D_EMOJI_DIR || path.join(__dirname, '..', '..', 'dsh-castorice-bridge', 'assets', 'emoji'),
)
// 窗口大小和位置记在 data\window.json，下次启动照旧
const WINDOW_STATE_PATH = path.join(__dirname, '..', 'data', 'window.json')

function readWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8'))
    return saved && typeof saved === 'object' ? saved : null
  } catch {
    return null
  }
}

function saveWindowState() {
  try {
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    fs.mkdirSync(path.dirname(WINDOW_STATE_PATH), { recursive: true })
    fs.writeFileSync(
      WINDOW_STATE_PATH,
      `${JSON.stringify({ x, y, width: petWidth, height: petHeight }, null, 2)}\n`,
      'utf8',
    )
  } catch {
    /* 记不住就记不住，不挡启动 */
  }
}

let win = null
let controlWin = null
let tray = null
let server = null
let port = 0
let ready = false
let model3Name = ''
let catalogJson = null
let catalogSeq = 0
let rendererState = null
let seq = 0
let sizeLock = null
const pending = new Map()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.moc3': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function fail(message) {
  console.error('[l2d-driver] ' + message)
  app.exit(2)
}

// 主进程兜底：未捕获异常先写进 data/crash.log，然后让程序继续活着。
// 不兜的话 Electron 会弹一个模态的「Error」框——主进程被它卡住，桌宠和 HTTP 全停。
const CRASH_LOG = path.join(__dirname, '..', 'data', 'crash.log')
function logCrash(kind, error) {
  const text = `[${new Date().toISOString()}] ${kind}: ${error?.stack || error}`
  try {
    fs.mkdirSync(path.dirname(CRASH_LOG), { recursive: true })
    fs.appendFileSync(CRASH_LOG, text + '\n')
  } catch {
    /* 写不进去就只打控制台 */
  }
  console.error('[crash] ' + text)
}
process.on('uncaughtException', (error) => logCrash('uncaughtException', error))
process.on('unhandledRejection', (error) => logCrash('unhandledRejection', error))

function findModel3(dir) {
  if (!dir) throw new Error('没有给模型目录')
  if (!fs.existsSync(dir)) throw new Error(`模型目录不存在：${dir}`)
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith('.model3.json'))
    .sort((a, b) => a.length - b.length)
  if (files.length === 0) throw new Error(`模型目录里找不到 *.model3.json：${dir}`)
  return files[0]
}

function serveFile(res, root, relative) {
  const target = path.resolve(root, relative)
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
    fs.createReadStream(target).pipe(res)
  })
}

function json(res, value) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1024 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(new Error('bad json: ' + error.message))
      }
    })
    req.on('error', reject)
  })
}

function runCommand(payload) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed() || !ready) {
      resolve({ ok: false, error: 'renderer not ready' })
      return
    }
    const id = ++seq
    const timer = setTimeout(() => {
      if (pending.delete(id)) resolve({ ok: false, error: 'command timeout' })
    }, 8000)
    pending.set(id, (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    win.webContents.send('l2d:command', id, payload)
  })
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const pathname = decodeURIComponent(url.pathname)
        if (pathname === '/api/model') {
          json(res, { url: '/model/' + encodeURIComponent(model3Name) })
          return
        }
        if (pathname === '/api/state') {
          const bounds = win && !win.isDestroyed() ? win.getBounds() : null
          const display = screen.getPrimaryDisplay()
          let gripPhysical = null
          if (bounds) {
            // 拖动柄在页面右上角：right 8px、top 8px、28px 见方
            const dipPoint = { x: bounds.x + bounds.width - 22, y: bounds.y + 22 }
            gripPhysical = screen.dipToScreenPoint(dipPoint)
          }
          json(res, {
            ready,
            bounds,
            modelDir,
            model3: model3Name,
            control: controlWin && !controlWin.isDestroyed() ? { contentBounds: controlWin.getContentBounds() } : null,
            topmost: win && !win.isDestroyed() ? win.isAlwaysOnTop() : false,
            visible: win && !win.isDestroyed() ? win.isVisible() : false,
            display: {
              scaleFactor: display.scaleFactor,
              bounds: display.bounds,
              workArea: display.workArea,
              cursor: screen.getCursorScreenPoint(),
            },
            gripPhysical: gripPhysical
              ? { x: Math.round(gripPhysical.x), y: Math.round(gripPhysical.y) }
              : null,
            renderer: rendererState,
          })
          return
        }
        if (pathname === '/api/catalog') {
          if (!catalogJson) {
            res.writeHead(404)
            res.end('no catalog yet')
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(catalogJson)
          return
        }
        if (pathname === '/api/control' && req.method === 'POST') {
          // 让外部也能把控制台叫出来（托盘菜单之外的一条路，排查时用）
          if (controlWin && !controlWin.isDestroyed()) {
            controlWin.show()
            controlWin.focus()
          }
          json(res, { ok: true, visible: !!(controlWin && !controlWin.isDestroyed() && controlWin.isVisible()) })
          return
        }
        // 桥插件反向通知：DSH 聊天框里发了消息 → 转三个点；助手说完 → 出气泡
        if (pathname === '/api/echo' && req.method === 'POST') {
          const body = await readBody(req)
          let result = null
          if (body?.type === 'typing') {
            result = await runCommand({ cmd: 'typing', on: body.on !== false })
          } else if (body?.type === 'say') {
            const emoji = typeof body.emoji === 'string' ? body.emoji : ''
            result = await runCommand({
              cmd: 'say',
              text: String(body.text ?? ''),
              duration: 12000,
              emojiUrl: emoji === '' ? '' : `${DSH_URL}/castorice/emoji/${encodeURIComponent(emoji)}.png`,
              motion: typeof body.motion === 'string' ? body.motion : '',
              emoji,
            })
          }
          json(res, { ok: true, result })
          return
        }
        if (pathname === '/api/shot' && req.method === 'POST') {
          const body = await readBody(req)
          if (!body.path) {
            res.writeHead(400)
            res.end('path required')
            return
          }
          const source = body.target === 'control' && controlWin && !controlWin.isDestroyed() ? controlWin : win
          const fileTarget = path.resolve(String(body.path))
          const image = await source.webContents.capturePage()
          fs.mkdirSync(path.dirname(fileTarget), { recursive: true })
          fs.writeFileSync(fileTarget, image.toPNG())
          json(res, { ok: true, path: fileTarget })
          return
        }
        if (pathname === '/api/command' && req.method === 'POST') {
          const payload = await readBody(req)
          json(res, await runCommand(payload))
          return
        }
        if (pathname.startsWith('/model/')) {
          serveFile(res, modelDir, pathname.slice('/model/'.length))
          return
        }
        serveFile(res, WEB_ROOT, pathname === '/' ? 'index.html' : pathname.slice(1))
      } catch (error) {
        /* 只回固定文案：路径与调用栈留在本机控制台，别顺着 HTTP 漏给请求方 */
        console.error('[live2d] 请求处理失败', error)
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('internal-error')
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      resolve(port)
    })
  })
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea
  const saved = readWindowState()
  let x = area.x + area.width - petWidth - 24
  let y = area.y + area.height - petHeight - 16
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const sx = Math.round(saved.x)
    const sy = Math.round(saved.y)
    // 别把窗口恢复到屏幕外面去
    if (
      sx + petWidth > area.x + 60 &&
      sx < area.x + area.width - 60 &&
      sy + petHeight > area.y + 60 &&
      sy < area.y + area.height - 60
    ) {
      x = sx
      y = sy
    }
  }
  // 记住的位置可能贴着屏幕底，按窗口尺寸再夹回工作区里
  x = Math.max(area.x, Math.min(x, area.x + area.width - petWidth))
  y = Math.max(area.y, Math.min(y, area.y + area.height - petHeight))
  win = new BrowserWindow({
    width: petWidth,
    height: petHeight,
    x,
    y,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  win.setMenu(null)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== `http://127.0.0.1:${port}`) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[l2d-driver] renderer gone: ' + details.reason)
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`[l2d-driver] load failed ${code}: ${description}`)
  })
  win.on('resize', () => enforceSize('resize-event'))
  win.loadURL(`http://127.0.0.1:${port}/index.html?desktop=1`)
}

function setupTray() {
  try {
    const pixels = Buffer.alloc(16 * 16 * 4)
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        if ((x - 7.5) ** 2 + (y - 7.5) ** 2 < 56) {
          const i = (y * 16 + x) * 4
          pixels[i] = 120
          pixels[i + 1] = 150
          pixels[i + 2] = 200
          pixels[i + 3] = 255
        }
      }
    }
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }))
    tray.setToolTip('遐蝶 · Live2D 驱动')
    const rebuild = () => {
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: '打开控制台', click: () => createControlWindow() },
          { label: '显示 / 隐藏', click: () => (win && !win.isDestroyed() ? (win.isVisible() ? win.hide() : win.showInactive()) : null) },
          { label: '退出', click: () => app.quit() },
        ]),
      )
    }
    rebuild()
    tray.on('double-click', () => {
      if (win && !win.isDestroyed()) win.showInactive()
    })
  } catch (error) {
    console.error('[l2d-driver] tray unavailable: ' + error.message)
  }
}

function createControlWindow() {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.show()
    controlWin.focus()
    return controlWin
  }
  controlWin = new BrowserWindow({
    width: 800,
    height: 700,
    minWidth: 640,
    minHeight: 500,
    title: '遐蝶 · 驱动控制台',
    backgroundColor: '#14111d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'control-preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      // 控制台被别的窗口挡住时 Chromium 会把定时器压到一分钟一次，
      // 大小滑杆那种「停手再应用」的防抖就永远等不到——所以别让它降频。
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  controlWin.loadURL(`http://127.0.0.1:${port}/control.html`)
  // 显式叫出来：有些情况下 ready-to-show 会赶在窗口真正可显示之前，
  // 结果控制台一直藏着，滑杆那种防抖定时器还会被隐藏页冻结。
  controlWin.show()
  controlWin.once('ready-to-show', () => {
    if (controlWin && !controlWin.isDestroyed()) controlWin.show()
  })
  controlWin.on('closed', () => {
    controlWin = null
  })
  return controlWin
}

ipcMain.handle('ctl:info', () => {
  const bounds = win && !win.isDestroyed() ? win.getBounds() : null
  return {
    modelDir,
    model3: model3Name,
    ready,
    port,
    bounds,
    topmost: win && !win.isDestroyed() ? win.isAlwaysOnTop() : false,
    visible: win && !win.isDestroyed() ? win.isVisible() : false,
    catalogVersion: catalogSeq,
    renderer: rendererState,
  }
})

ipcMain.handle('ctl:catalog', () => {
  if (!catalogJson) return null
  try {
    return JSON.parse(catalogJson)
  } catch {
    return null
  }
})

ipcMain.handle('ctl:pick-model', async () => {
  const result = await dialog.showOpenDialog(controlWin && !controlWin.isDestroyed() ? controlWin : win, {
    title: '选一个 Live2D 模型目录',
    properties: ['openDirectory'],
    defaultPath: modelDir || undefined,
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('ctl:apply-model', async (_event, dir) => {
  try {
    const target = path.resolve(String(dir || ''))
    const name = findModel3(target)
    modelDir = target
    model3Name = name
    ready = false
    rendererState = null
    catalogJson = null
    catalogSeq = 0
    if (win && !win.isDestroyed()) {
      win.loadURL(`http://127.0.0.1:${port}/index.html?desktop=1`)
    }
    console.log(`[l2d-driver] model=${model3Name} dir=${modelDir} (switched)`)
    return { ok: true, modelDir, model3: model3Name }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('ctl:command', (_event, payload) => runCommand(payload))

ipcMain.handle('ctl:resize', (_event, width, height) => {
  try {
    if (!win || win.isDestroyed()) return { ok: false, error: 'no pet window' }
    const w = Math.max(140, Math.min(900, Math.round(Number(width) || 0)))
    const h = Math.max(200, Math.min(1200, Math.round(Number(height) || 0)))
    // 别让窗口大到装不进屏幕（装了也不好看，底下会看不见）
    const area = screen.getPrimaryDisplay().workArea
    const cappedW = Math.min(w, area.width)
    const cappedH = Math.min(h, area.height)
    // 先把目标尺寸写进 sizeLock，再真的改窗口：
    // 否则 setSize 触发的 resize 事件会让看门狗按旧尺寸把它改回去，
    // 表现就是「滑杆拖了没反应」。
    petWidth = cappedW
    petHeight = cappedH
    sizeLock = { width: cappedW, height: cappedH }
    setSizeExact(cappedW, cappedH)
    lockSize()
    saveWindowState()
    return { ok: true, width: cappedW, height: cappedH }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('ctl:topmost', (_event, on) => {
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!on, 'screen-saver')
  return { ok: true, topmost: !!on }
})

ipcMain.handle('ctl:pet-visible', (_event, on) => {
  if (win && !win.isDestroyed()) {
    if (on) win.showInactive()
    else win.hide()
  }
  return { ok: true, visible: !!on }
})

ipcMain.handle('ctl:open-doc', async () => {
  try {
    const failure = await shell.openPath(DOC_PATH)
    return failure || null
  } catch (error) {
    return error.message
  }
})

ipcMain.handle('ctl:quit', () => {
  app.quit()
})

// 摸一下 / 戳一下：把「被碰了哪里」递进 DSH 里的会话，顺手等一句回复。
// 部位名由渲染层按包围盒算出来；认不出的名字回落到「戳了戳你」。
const TOUCH_LINES = {
  head: (name) => `（${name}摸了摸你的头。）`,
  face: (name) => `（${name}碰了碰你的脸。）`,
  shoulder: (name) => `（${name}拍了拍你的肩。）`,
  chest: (name) => `（${name}碰了碰你的衣领。）`,
  waist: (name) => `（${name}碰了碰你的肚子。）`,
  skirt: (name) => `（${name}碰了碰你的裙摆。）`,
  foot: (name) => `（${name}碰了碰你的脚踝。）`,
}
const TOUCH_ZONES = new Set(Object.keys(TOUCH_LINES))
// 会话那边可能正在跑一轮长回合，「发一句、等一句」得给它留够时间；
// 超过这个数就放弃，让窗口出本地那句，不干等。
const TOUCH_WAIT_MS = 120000

/** 把驱动的地址告诉桥插件，之后 DSH 会话里的事件才能反向通知过来。 */
function registerWithBridge() {
  if (!Number.isFinite(port) || port <= 0) return
  fetch(`${DSH_URL}/castorice/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ driver: `http://127.0.0.1:${port}` }),
    signal: AbortSignal.timeout(3000),
  })
    .then(() => {})
    .catch(() => {})
}

/** 把一句话当成用户发言递给 DSH 的会话；wait 为真时等她的回复。触摸和输入框共用这一条。 */
async function sendToSession(text, { wait = true } = {}) {
  const response = await fetch(`${DSH_URL}/castorice/say`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text, wait }),
    signal: AbortSignal.timeout(wait ? TOUCH_WAIT_MS : 15000),
  })
  const data = await response.json().catch(() => null)
  const value = data?.value ?? {}
  const emoji = typeof value.emoji === 'string' ? value.emoji.trim() : ''
  return {
    ok: !!data?.ok,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
    reply: typeof value.reply === 'string' ? value.reply : '',
    motion: typeof value.motion === 'string' ? value.motion.trim() : '',
    emoji,
    // 表情图由自建的小桥（dsh-castorice-bridge）供，窗口直接拿来当 img.src
    emojiUrl: emoji === '' ? '' : `${DSH_URL}/castorice/emoji/${encodeURIComponent(emoji)}.png`,
    error: data?.error?.message || '',
  }
}

ipcMain.handle('pet:touch', async (_event, payload) => {
  const zone = TOUCH_ZONES.has(payload?.zone) ? payload.zone : ''
  const text = zone === ''
    ? `（${USER_NAME}戳了戳你。）`
    : TOUCH_LINES[zone](USER_NAME)
  try {
    const result = await sendToSession(text)
    console.log(
      `[touch] zone=${zone || 'body'} relY=${payload?.relY ?? '-'} ok=${result.ok} reply=${result.reply.slice(0, 40)}`
    )
    return { ...result, text, zone }
  } catch (error) {
    console.log(`[touch] zone=${zone || 'body'} bridge failed: ${error.message}`)
    return { ok: false, text, zone, reply: '', error: error.message }
  }
})

// 桌宠窗口底部的输入框：风铃打的话同样递进会话（不是只在本地说一遍）。
ipcMain.handle('pet:say', async (_event, payload) => {
  const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
  if (text === '') return { ok: false, reply: '', error: 'empty-text' }
  try {
    const result = await sendToSession(text)
    console.log(`[say] ok=${result.ok} text=${text.slice(0, 30)} reply=${result.reply.slice(0, 40)}`)
    return result
  } catch (error) {
    console.log(`[say] bridge failed: ${error.message}`)
    return { ok: false, reply: '', error: error.message }
  }
})

/** 表情图 id 清单：给能力消息用，省得智能体瞎猜 [图:id]。 */
function listEmojiIds() {
  try {
    return fs
      .readdirSync(EMOJI_DIR)
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .map((name) => name.replace(/\.png$/i, ''))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/** 把能力识别结果整理成一段能直接说的话。 */
function buildCapabilityMessage(catalog, modelName) {
  const capability = catalog?.capability
  if (!capability) return ''
  const base = `http://127.0.0.1:${port}`
  const present = capability.present || {}
  const parts = []
  for (const key of ['brows', 'mouth', 'cheeks', 'eyes', 'eyeBall', 'head', 'body', 'arms', 'legs']) {
    const list = Array.isArray(present[key]) ? present[key] : []
    if (list.length > 0) parts.push(`${key}: ${list.join('、')}`)
  }
  const lines = [
    `（桌宠自带模型的能力清单。她在 ${base}，用 POST /api/command 驱动这具身体；回话时句尾可带 [图:id] 和 [动作:名称]。）`,
    `模型：${modelName || '未知'}`,
    `可动性：Lv.${capability.level}/5（${capability.levelLabel}，分 ${capability.score}）`,
    `能做：${(capability.can || []).join('；') || '—'}`,
    `能拼出来：${(capability.derived || []).join('；') || '—'}`,
    `做不到：${(capability.cannot || []).join('；') || '无'}`,
  ]
  if (Array.isArray(capability.expressions) && capability.expressions.length > 0) {
    lines.push(`表情 id：${capability.expressions.join('、')}`)
  }
  if (Array.isArray(capability.motions) && capability.motions.length > 0) {
    lines.push(`动作名：${capability.motions.join('、')}`)
  }
  if (parts.length > 0) lines.push(`能压的参数：${parts.join('；')}`)
  const emojiIds = listEmojiIds()
  if (emojiIds.length > 0) {
    lines.push(`表情图 id（回话里写 [图:id]）：${emojiIds.join('、')}`)
  }
  lines.push(
    '姿势预设：angry / sad / shy / surprise / sleepy / lookLeft / lookRight（{"cmd":"pose","preset":"shy"}，也可以直接给 params 自己捏）。',
  )
  lines.push(
    '命令：{"cmd":"expression","name":"016脸红"}、{"cmd":"motion","group":"小动作","name":"歪头"}、{"cmd":"mood","name":"shy"}、{"cmd":"pose","params":{"ParamMouthForm":-1}}、{"cmd":"gaze","x":-1,"y":0}、{"cmd":"say","text":"…"}、{"cmd":"stop"}。',
  )
  lines.push('完整说明在 docs/AGENT-GUIDE.md；模型清单在 data/catalog.json。')
  return lines.join('\n')
}

/** 读人设文件：路径可用 --persona 改。 */
function readPersonaFile() {
  try {
    return fs.readFileSync(PERSONA_PATH, 'utf8').trim()
  } catch {
    return ''
  }
}

function buildPersonaMessage() {
  const text = readPersonaFile()
  if (text === '') return ''
  return [
    '（以下是桌宠自带的人设，请照着这个扮演；不需要时忽略即可。回话句尾可以带 [图:id] 和 [动作:名称]。）',
    '',
    text,
    '',
    `（这具身体在 http://127.0.0.1:${port} ，能力清单可以用控制台的「把这份能力告诉她」再发一次。）`,
  ].join('\n')
}

// 一键把当前模型的能力递进会话，让她知道怎么驱动这具身体。
ipcMain.handle('ctl:tell-capability', async () => {
  if (!catalogJson) return { ok: false, error: '模型目录还没生成' }
  let catalog = null
  try {
    catalog = JSON.parse(catalogJson)
  } catch (error) {
    return { ok: false, error: `模型目录不是合法 JSON：${error.message}` }
  }
  const text = buildCapabilityMessage(catalog, model3Name)
  if (text === '') return { ok: false, error: '这份目录里没有能力识别结果' }
  try {
    const result = await sendToSession(text, { wait: false })
    console.log(`[capability] sent ok=${result.ok} session=${result.sessionId}`)
    return result.ok ? { ok: true, sessionId: result.sessionId, text } : { ok: false, error: result.error || '递话失败', text }
  } catch (error) {
    console.log(`[capability] bridge failed: ${error.message}`)
    return { ok: false, error: error.message, text }
  }
})

// 一键把自带人设递进会话：别的智能体接手这具身体时，照着这段扮演。
ipcMain.handle('ctl:send-persona', async () => {
  const text = buildPersonaMessage()
  if (text === '') return { ok: false, error: `读不到人设文件：${PERSONA_PATH}` }
  try {
    const result = await sendToSession(text, { wait: false })
    console.log(`[persona] sent ok=${result.ok} session=${result.sessionId}`)
    return result.ok ? { ok: true, sessionId: result.sessionId, text } : { ok: false, error: result.error || '递话失败', text }
  } catch (error) {
    console.log(`[persona] bridge failed: ${error.message}`)
    return { ok: false, error: error.message, text }
  }
})

let selfTested = false

async function runSelfTest() {
  if (selfTested) return
  selfTested = true
  try {
    if (!controlWin || controlWin.isDestroyed()) createControlWindow()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const clicked = await controlWin.webContents.executeJavaScript(`(async () => {
      const chips = [...document.querySelectorAll('#expressions .chip')]
      const chip = chips.find((c) => (c.dataset.name || '').includes('016'))
      if (!chip) return 'no-chip'
      chip.click()
      await new Promise((r) => setTimeout(r, 900))
      return chip.dataset.name
    })()`)
    // 渲染层每两秒才心跳一次，等它把新表情报上来
    for (let i = 0; i < 16 && !rendererState?.expression; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    console.log(`[selftest] click=${clicked} expression=${rendererState?.expression || 'null'}`)
    if (process.env.L2D_SELFTEST_SHOT) {
      const image = await controlWin.webContents.capturePage()
      const target = path.resolve(process.env.L2D_SELFTEST_SHOT)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, image.toPNG())
    }
  } catch (error) {
    console.error('[selftest] failed: ' + error.message)
  }
  if (process.env.L2D_SELFTEST_SHOT) app.quit()
}

let dragOffset = null
let fixingSize = false
let dragging = false

// 透明无边框窗在 150% 缩放下有两个毛病：
// 1) 系统会把窗口悄悄撑大几像素；2) getSize 取回的值会多 1px。
// 所以看门狗只认「差超过 2px 才动手」，定时把真实尺寸写回去。
// 拖动窗口时不看：每帧 setSize 会让透明窗重新合成一次，画面就高频闪一下；
// 拖完停手再收一次尺寸就够。
// 另外把 min/max 都钉死在这个尺寸上——只松开一边，Windows 搬窗时会顺着空隙把外框撑大。
function lockSize() {
  if (!win || win.isDestroyed()) return
  // 建窗时就把当时的实际尺寸记下来：透明窗在 150% 缩放下会被系统补上几像素的边，
  // 用命令行传入的值当锁反而会小一圈，松手收尺寸时会明显缩一下。
  const [width, height] = win.getSize()
  sizeLock = { width, height }
}

function enforceSize(tag) {
  if (!SIZE_GUARD || !sizeLock || !win || win.isDestroyed() || fixingSize || dragging) return
  const [width, height] = win.getSize()
  if (Math.abs(width - sizeLock.width) <= 2 && Math.abs(height - sizeLock.height) <= 2) return
  fixingSize = true
  try {
    // 不可缩放的窗会被 min/max 卡住，先松开再写回
    win.setMinimumSize(1, 1)
    win.setMaximumSize(10000, 10000)
    win.setSize(sizeLock.width, sizeLock.height)
    console.log(`[size-guard] ${tag}: ${width}x${height} -> ${sizeLock.width}x${sizeLock.height}`)
  } finally {
    fixingSize = false
  }
}

function setSizeExact(width, height) {
  if (!win || win.isDestroyed()) return false
  win.setMinimumSize(1, 1)
  win.setMaximumSize(10000, 10000)
  win.setSize(width, height)
  return true
}

ipcMain.on('pet:drag-start', (_event, point) => {
  if (!win || win.isDestroyed() || !point) return
  const px = Number(point.x)
  const py = Number(point.y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    // 坐标不是数字就不起拖：setPosition 里塞进 NaN 会直接抛异常，
    // Electron 主进程一抛异常就弹系统报错框，整个桌宠跟着卡住。
    dragOffset = null
    dragging = false
    return
  }
  dragging = true
  const [wx, wy] = win.getPosition()
  dragOffset = { x: px - wx, y: py - wy }
})
ipcMain.on('pet:drag-move', (_event, point) => {
  if (!win || win.isDestroyed() || !dragOffset || !point) return
  // 拖动中只挪位置，不碰尺寸：一 setSize 就会重排、重绘，看起来就是闪。
  // 位置要落到物理像素上：150% 缩放下整数 DIP 会变成半个物理像素，
  // Windows 会顺手把透明窗的外框补齐，窗口就一帧一帧地「长胖」。
  const scale = screen.getPrimaryDisplay().scaleFactor || 1
  const snap = (value) => Math.round((Math.round(value) * scale) / scale)
  const x = snap(Number(point.x) - dragOffset.x)
  const y = snap(Number(point.y) - dragOffset.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  win.setPosition(x, y)
})
ipcMain.on('pet:drag-end', () => {
  dragOffset = null
  dragging = false
  // 等系统把这一下的窗口外框动完，再收一次尺寸；收完通知渲染层可以重排了。
  setTimeout(() => {
    enforceSize('drag-end')
    saveWindowState()
    if (win && !win.isDestroyed()) win.webContents.send('pet:drag-settled')
  }, 120)
})

ipcMain.on('pet:ready', () => {
  ready = true
  if (win && !win.isDestroyed()) win.showInactive()
  if (SHOT) {
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage()
        fs.mkdirSync(path.dirname(SHOT), { recursive: true })
        fs.writeFileSync(SHOT, image.toPNG())
        console.log('[l2d-driver] shot -> ' + SHOT)
      } catch (error) {
        console.error('[l2d-driver] shot failed: ' + error.message)
        process.exitCode = 3
      }
      app.quit()
    }, 1600)
  }
  if (process.env.L2D_SELFTEST) runSelfTest()
})

ipcMain.on('pet:fatal', (_event, message) => {
  console.error('[l2d-driver] fatal from renderer: ' + message)
  process.exitCode = 1
  if (SHOT) app.quit()
})

ipcMain.on('l2d:catalog', (_event, raw) => {
  try {
    catalogJson = String(raw)
    catalogSeq += 1
    if (CATALOG_PATH) {
      const target = path.resolve(CATALOG_PATH)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, catalogJson, 'utf8')
      console.log('[l2d-driver] catalog -> ' + target)
    }
  } catch (error) {
    console.error('[l2d-driver] catalog save failed: ' + error.message)
  }
})

ipcMain.on('l2d:state', (_event, raw) => {
  try {
    rendererState = JSON.parse(String(raw))
  } catch {
    rendererState = { raw: String(raw) }
  }
})

ipcMain.on('l2d:result', (_event, id, result) => {
  const resolve = pending.get(id)
  if (resolve) {
    pending.delete(id)
    resolve(result)
  }
})

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

// 只允许一个实例；--shot 是无人值守测试，放行
const singleLock = SHOT ? true : app.requestSingleInstanceLock()
if (!singleLock) app.quit()
app.on('second-instance', () => {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.show()
    controlWin.focus()
  }
  if (win && !win.isDestroyed()) win.showInactive()
})

const DEBUG_PORT = String(arg('--debug-port', process.env.L2D_DEBUG_PORT || ''))
if (/^[1-9]\d{3,4}$/.test(DEBUG_PORT)) {
  app.commandLine.appendSwitch('remote-debugging-port', DEBUG_PORT)
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

app.whenReady().then(async () => {
  if (!singleLock) return
  try {
    model3Name = findModel3(modelDir)
    // 上次的大小先接过来，再开窗
    const saved = readWindowState()
    if (saved) {
      if (Number.isFinite(saved.width)) petWidth = Math.max(140, Math.min(900, Math.round(saved.width)))
      if (Number.isFinite(saved.height)) petHeight = Math.max(200, Math.min(1200, Math.round(saved.height)))
    }
    await startServer()
    console.log(`[l2d-driver] model=${model3Name} dir=${modelDir} port=${port}`)
    createWindow()
    lockSize()
    setupTray()
    if (GUI && !SHOT) createControlWindow()
    // 告诉桥插件「我在这儿」；桥要是晚起/重启，隔一会儿再登记一次
    registerWithBridge()
    setInterval(registerWithBridge, 15000).unref?.()
  } catch (error) {
    fail(error.stack || String(error))
  }
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  ready = false
  saveWindowState()
  if (server) server.close()
  if (tray) tray.destroy()
})
