/**
 * 遐蝶桌宠驱动（<工作区>\tools\live2d-driver）的 DSH 端桥。
 *
 * 只做三件事，不碰立绘、不碰设置面板：
 *   1. POST /castorice/say     把一句话当成用户发言递进「遐蝶这间屋子」最新的会话，可选等回复
 *   2. GET  /castorice/emoji/<id>.png   给桌宠窗口供表情图
 *   3. 按工作区注入人设 section（正文在 <工作区>\遐蝶\资料\桌面人设.md）
 *
 * 2026-11-09 从旧桌宠插件 dsh-cyrene-pet 里拆出来；旧插件整个删掉后，
 * 驱动仍然靠这条路说话。
 */

import { readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const inject = ['webServer', 'systemPrompt', 'sessions', 'sessionController']

const PACKAGE_ID = 'dsh-castorice-bridge'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EMOJI_DIR = join(ROOT, 'assets', 'emoji')
const ROUTE_PREFIX = '/castorice'

const WORKSPACE = normalizeWorkspace(
  typeof process.env.DSH_CASTORICE_WORKSPACE === 'string' && process.env.DSH_CASTORICE_WORKSPACE.trim() !== ''
    ? process.env.DSH_CASTORICE_WORKSPACE
    : '',
)
const PERSONA_FILE =
  typeof process.env.DSH_CASTORICE_PERSONA === 'string' && process.env.DSH_CASTORICE_PERSONA.trim() !== ''
    ? process.env.DSH_CASTORICE_PERSONA
    : join(WORKSPACE, '资料', '桌面人设.md')

const BUBBLE_EMOJI_TAG = /[[【(（]\s*图\s*[:：]\s*([^\]】)）\n]{1,40})\s*[\]】)）]/
const BUBBLE_MOTION_TAG = /[[【(（]\s*动作\s*[:：]\s*([^\]】)）\n]{1,24})\s*[\]】)）]/

// 桌宠驱动启动后会把地址登记到这里；会话里有新消息时，我们反过来通知它，
// 这样在 DSH 聊天框里打字，桌宠也会有反应（转圈、出气泡）。
let driverUrl = ''
// 我们自己用 /say 递进去的那一轮，气泡由 /say 的返回值负责，别在事件里重复播一遍。
const suppressedSessions = new Set()

async function notifyDriver(payload) {
  if (driverUrl === '') return
  try {
    await fetch(`${driverUrl}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    })
  } catch {
    /* 驱动没开就算了，别影响会话 */
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 统一成小写、反斜杠、去掉末尾分隔符，用来比路径。 */
function normalizeWorkspace(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return ''
  return text.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function dshHome() {
  return process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh')
}

/** OWN_WORKSPACE 那间屋子的会话 id（去掉 session- 前缀，好和宿主对得上）。 */
function ownSessionIds() {
  try {
    const data = JSON.parse(readFileSync(join(dshHome(), 'storages', 'workspace.json'), 'utf8'))
    const table = data?.tables?.workspaces ?? {}
    for (const key of Object.keys(table)) {
      const ws = table[key]
      if (!ws || typeof ws.path !== 'string') continue
      if (normalizeWorkspace(ws.path) !== WORKSPACE) continue
      const ids = Array.isArray(ws.sessionIds) ? ws.sessionIds : []
      return new Set(ids.map((id) => String(id).replace(/^session-/u, '')))
    }
  } catch {
    /* 读不到就当没有 */
  }
  return new Set()
}

function sessionCreatedAt(session) {
  for (const value of [session?.header?.createdAt, session?.createdAt]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return 0
}

/** 挑这间屋子最新建的会话；挑不到就不递，绝不落到别的房间。 */
function pickSession(sessions) {
  let list = []
  try {
    list = [...sessions.list()]
  } catch {
    return undefined
  }
  if (list.length === 0) return undefined
  const want = ownSessionIds()
  const pool = list.filter((session) => {
    const id = String(session?.id ?? '').replace(/^session-/u, '')
    if (!want.has(id)) return false
    return (session?.header?.delegationDepth ?? 0) === 0
  })
  let best
  for (const session of pool) {
    if (best === undefined) {
      best = session
      continue
    }
    const at = sessionCreatedAt(session)
    const bestAt = sessionCreatedAt(best)
    if (at !== bestAt) {
      if (at > bestAt) best = session
      continue
    }
    if ((session.seq ?? 0) > (best.seq ?? 0)) best = session
  }
  return best
}

/** 宿主的 id 可能带也可能不带 session- 前缀，两种都试。 */
function getSession(sessions, id) {
  const bare = String(id ?? '').replace(/^session-/u, '')
  for (const candidate of [id, bare, `session-${bare}`]) {
    try {
      const session = sessions.get(candidate)
      if (session !== undefined && session !== null) return session
    } catch {
      /* 这个写法找不到就试下一个 */
    }
  }
  return null
}

/** 一条助手事件里的正文。 */
function assistantText(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim()
}

/**
 * 等这一轮跑完，把最后一条助手发言取回来。
 * 直接从宿主活会话的事件里倒着找，不解压会话文件。
 */
async function waitForReply(sessions, sessionId, since, timeoutMs = 100000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(400)
    const session = getSession(sessions, sessionId)
    if (session === null) continue
    let end = 0
    try {
      end = Number(session.seq) || 0
    } catch {
      end = 0
    }
    for (let seq = end - 1; seq >= 0 && seq > end - 800; seq -= 1) {
      const event = session.eventAt?.(seq)
      if (event === undefined || event === null) continue
      const time = typeof event.time === 'number' ? event.time : 0
      if (time !== 0 && time < since) break
      if (event.type === 'assistant/message') {
        const text = assistantText(event)
        if (text !== '') return text
      }
    }
  }
  return ''
}

/** 把回复里的 `[图:id]`、`[动作:名称]` 摘出来；给聊天框的图片也不留在气泡里。 */
function splitBubbleTags(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const hitEmoji = text.match(BUBBLE_EMOJI_TAG)
  const hitMotion = text.match(BUBBLE_MOTION_TAG)
  const emoji = hitEmoji === null ? '' : hitEmoji[1].trim()
  const motion = hitMotion === null ? '' : hitMotion[1].trim()
  const cleaned = text
    .replace(BUBBLE_EMOJI_TAG, '')
    .replace(BUBBLE_MOTION_TAG, '')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: cleaned, emoji, motion }
}

function emojiFileExists(id) {
  if (typeof id !== 'string' || id.trim() === '') return false
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id.trim())) return false
  try {
    return statSync(join(EMOJI_DIR, `${id.trim()}.png`)).isFile()
  } catch {
    return false
  }
}

function sendJson(res, status, value) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  } catch {
    /* 客户端已经断开 */
  }
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw === '' ? {} : JSON.parse(raw))
      } catch (error) {
        reject(new Error(`bad json: ${error.message}`))
      }
    })
    req.on('error', reject)
  })
}

/** 最后几条事件的类型与时间，只给 /status 排查用。 */
function tailEvents(session, count) {
  const out = []
  let end = 0
  try {
    end = Number(session.seq) || 0
  } catch {
    return out
  }
  for (let seq = end - 1; seq >= 0 && out.length < count; seq -= 1) {
    const event = session.eventAt?.(seq)
    if (event === undefined || event === null) continue
    out.push({ type: event.type, time: event.time })
  }
  return out.reverse()
}

/** 人设正文：按 mtime 缓存，改文件后下一轮就生效。 */
let personaCache = { mtimeMs: -1, text: '' }
function personaText() {
  try {
    const info = statSync(PERSONA_FILE)
    if (info.mtimeMs !== personaCache.mtimeMs) {
      personaCache = { mtimeMs: info.mtimeMs, text: readFileSync(PERSONA_FILE, 'utf8').trim() }
    }
    return personaCache.text
  } catch {
    return ''
  }
}

function assemblyCwd(context) {
  try {
    return normalizeWorkspace(context?.agent?.session?.header?.cwd)
  } catch {
    return ''
  }
}

/** 只关心「自己这间屋子」的根会话，子代理的会话不播。 */
function isOwnWorkspaceSession(session) {
  try {
    if (normalizeWorkspace(session?.header?.cwd) !== WORKSPACE) return false
    return (session?.header?.delegationDepth ?? 0) === 0
  } catch {
    return false
  }
}

/** 会话里有新动静时，反过来告诉桌宠：用户发话就转三个点，助手说完就出气泡。 */
function onSessionEvent(session, event) {
  if (!event || typeof event.type !== 'string') return
  if (!isOwnWorkspaceSession(session)) return
  const id = String(session?.id ?? '')
  if (suppressedSessions.has(id)) return
  if (event.type === 'user/message') {
    void notifyDriver({ type: 'typing', on: true })
    return
  }
  if (event.type === 'assistant/message') {
    const raw = assistantText(event)
    if (raw === '') return
    const split = splitBubbleTags(raw)
    const emoji = emojiFileExists(split.emoji) ? split.emoji : ''
    if (split.text === '' && emoji === '') return
    void notifyDriver({ type: 'say', text: split.text, emoji, motion: split.motion })
  }
}

export function apply(ctx) {
  // —— 人设：只在自己那间屋子里注入 ——
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'castorice:companion',
        order: 150,
        text: (context) => (WORKSPACE !== '' && assemblyCwd(context) === WORKSPACE ? personaText() : ''),
        interpolate: false,
      }),
    `${PACKAGE_ID}: persona section`,
  )

  // —— 会话事件 → 桌宠：在 DSH 聊天框里打字，桌宠也要有反应 ——
  ctx.effect(
    () =>
      ctx.on(
        'session/event',
        (session, event) => {
          try {
            onSessionEvent(session, event)
          } catch {
            /* 通知失败不影响会话 */
          }
        },
        { global: true },
      ),
    `${PACKAGE_ID}: session events`,
  )

  // —— 桌面驱动用的路由 ——
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
          try {
            if (route === '/status' && req.method === 'GET') {
              const target = pickSession(ctx.sessions)
              sendJson(res, 200, {
                ok: true,
                value: {
                  version: 1,
                  workspace: WORKSPACE,
                  persona: personaText() !== '',
                  personaFile: PERSONA_FILE,
                  session: target === undefined
                    ? null
                    : { id: target.id, createdAt: sessionCreatedAt(target), seq: target.seq ?? 0 },
                  // 顺手把最后几条事件的类型和时间报出来：排查「等不到回复」时用得着
                  tail: target === undefined ? [] : tailEvents(target, 6),
                  driver: driverUrl,
                },
              })
              return
            }

            // 桌宠驱动把自己的地址登记过来，之后会话里的事件才能反向通知它
            if (route === '/register' && req.method === 'POST') {
              let body = null
              try {
                body = await readJsonBody(req)
              } catch {
                body = null
              }
              const driver = typeof body?.driver === 'string' ? body.driver.trim() : ''
              if (!/^https?:\/\/127\.0\.0\.1:\d{2,5}$/u.test(driver)) {
                sendJson(res, 400, { ok: false, error: { code: 'bad-driver', message: '驱动地址不合法' } })
                return
              }
              driverUrl = driver
              sendJson(res, 200, { ok: true, value: { driver: driverUrl } })
              return
            }

            if (route === '/say' && req.method === 'POST') {
              let body = null
              try {
                body = await readJsonBody(req)
              } catch {
                body = null
              }
              const text = typeof body?.text === 'string' ? body.text.trim() : ''
              if (text === '') {
                sendJson(res, 400, { ok: false, error: { code: 'empty-text', message: '要递过去的话是空的' } })
                return
              }
              const target = pickSession(ctx.sessions)
              if (target === undefined) {
                sendJson(res, 409, { ok: false, error: { code: 'no-session', message: '这间屋子还没有能递进去的会话' } })
                return
              }
              const since = Date.now()
              // 这一轮的气泡由 /say 的返回值负责，事件通知先压住，别重复播
              suppressedSessions.add(String(target.id))
              try {
                const controller = new AbortController()
                const timer = setTimeout(() => controller.abort(), 15000)
                try {
                  await ctx.sessionController.prompt(
                    {
                      requestId: randomUUID(),
                      sessionId: target.id,
                      mode: 'steer',
                      content: [{ type: 'text', text }],
                    },
                    controller.signal,
                  )
                } catch (error) {
                  sendJson(res, 502, {
                    ok: false,
                    error: { code: 'prompt-failed', message: error?.message ?? String(error) },
                  })
                  return
                } finally {
                  clearTimeout(timer)
                }

                if (body?.wait !== true) {
                  sendJson(res, 200, { ok: true, value: { sessionId: target.id } })
                  return
                }
                const reply = await waitForReply(ctx.sessions, target.id, since)
                const split = splitBubbleTags(reply)
                const emoji = emojiFileExists(split.emoji) ? split.emoji : ''
                sendJson(res, 200, {
                  ok: true,
                  value: { sessionId: target.id, reply: split.text, emoji, motion: split.motion },
                })
                return
              } finally {
                suppressedSessions.delete(String(target.id))
              }
            }

            if (route.startsWith('/emoji/') && req.method === 'GET') {
              const raw = decodeURIComponent(route.slice('/emoji/'.length))
              const id = raw.replace(/\.png$/i, '')
              if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id)) {
                sendJson(res, 400, { ok: false, error: { code: 'bad-name', message: '表情名不合法' } })
                return
              }
              try {
                const body = await readFile(join(EMOJI_DIR, `${id}.png`))
                res.writeHead(200, {
                  'content-type': 'image/png',
                  'cache-control': 'public, max-age=86400',
                  'x-content-type-options': 'nosniff',
                })
                res.end(body)
              } catch {
                sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有这张表情：${id}` } })
              }
              return
            }

            sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这个路由' } })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: { code: 'internal', message: error?.message ?? String(error) } })
          }
        },
      }),
    `${PACKAGE_ID}: routes`,
  )
}
