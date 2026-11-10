/**
 * 把 DSH 的回复念出来（只读）。
 *
 * 不碰 cyrene 宿主：DSH 自己把每轮事件按行写进会话文件，
 * assistant/message 里 type === 'text' 的片段就是她要说的正文。
 * 这里只做「找到最新会话 → 取出新的那几条」。
 *
 * 两个刻意的取舍：
 * - 压缩会话每次都是整文件重写，行号游标不可靠，所以靠事件时间去重。
 * - 只认启动之后的时间戳，打开开关不会把整段历史重播一遍。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import zlib from 'node:zlib'

const COMPRESSED = 'session.v4.jsonl.zstd'
const PLAIN = 'session.v4.jsonl'
const DEFAULT_MAX_CHARS = 800
const SEEN_LIMIT = 800
// 启动前后几秒内的回复也算「新的」，免得刚好卡在边界上丢掉一句。
const CLOCK_SLACK_MS = 5000

export function resolveSessionsRoot(dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  return join(dshHome, 'sessions')
}

/** message.content 里只取 text 片段；reasoning 不进气泡，也不念。 */
export function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((item) => item && typeof item === 'object' && item.type === 'text')
    .map((item) => (typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * 事件时间统一成毫秒。
 *
 * DSH 不同版本里可能是秒级数字、毫秒级数字或 ISO 字符串，
 * 认不出来就返回 null —— 宁可这一句不念，也不把时间猜错后重播历史。
 */
export function eventTime(event) {
  const raw = event?.time
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw < 1e12 ? raw * 1000 : raw
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function parseEvents(text) {
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      // 正在写入的半行、或非 JSON 行：跳过这一次，下一轮 mtime 变了会重读。
    }
  }
  return events
}

function decodeSession(buffer, compressed) {
  if (!compressed) return buffer.toString('utf8')
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 没有 zstd 解压能力')
  }
  return zlib.zstdDecompressSync(buffer).toString('utf8')
}

/** 同一目录里压缩版优先；它还活着就说明是最新的一份。 */
async function pickSessionFile(dir) {
  for (const [name, compressed] of [
    [COMPRESSED, true],
    [PLAIN, false]
  ]) {
    const file = join(dir, name)
    try {
      const info = await stat(file)
      if (info.isFile()) return { file, compressed, mtimeMs: info.mtimeMs, size: info.size }
    } catch {
      // 不存在就试下一个
    }
  }
  return null
}

/** 一个目录里直接有会话文件？没有就再看一层子目录。 */
async function collectSessionFiles(dir) {
  const direct = await pickSessionFile(dir)
  if (direct !== null) return [{ ...direct, id: basename(dir) }]

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = await pickSessionFile(join(dir, entry.name))
    if (nested !== null) found.push({ ...nested, id: entry.name })
  }
  return found
}

/**
 * 列出所有会话，按修改时间从新到旧排。
 *
 * 实测 DSH 是两层：sessions/<工作区>/<会话>/session.v4.jsonl.zstd。
 * 工作区目录名随工作区变化，所以不按固定前缀过滤，只认「里面有会话文件」。
 */
export async function listSessions(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    found.push(...(await collectSessionFiles(join(root, entry.name))))
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found
}

/** 找最近写过的会话。 */
export async function pickLatestSession(root) {
  const all = await listSessions(root)
  return all.length === 0 ? null : all[0]
}

function hashText(text) {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function replyKey(event, text) {
  const id = event?.data?.id
  if (typeof id === 'string' && id !== '') return id
  return `${event?.data?.turn ?? ''}:${event?.data?.step ?? ''}:${hashText(text)}`
}

function clipReply(text, maxChars) {
  const value = text.trim()
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value
}

/**
 * 轮询会话文件，把新出现的 assistant 正文交给 onReply。
 *
 * 只读、可随时 stop；任何一步读失败都只记日志，不影响桌宠本身。
 */
export function createDshSpeechWatcher(options = {}) {
  const dshHome = options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const root = resolveSessionsRoot(dshHome)
  const intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs >= 250 ? options.intervalMs : 800
  const rawMax = Number(options.maxChars)
  const maxChars = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : DEFAULT_MAX_CHARS
  const onReply = typeof options.onReply === 'function' ? options.onReply : () => {}
  const log = typeof options.log === 'function' ? options.log : () => {}

  let timer = null
  let busy = false
  let startedAt = 0
  let lastFile = null
  let lastMtime = 0
  let lastSessionId = null
  let lastReplyAt = null
  let lastError = null
  const seen = new Map()
  /** 被淘汰 key 的快照：key → 淘汰时刻。会话文件整重写后旧事件会再次出现，
   * 已经念过又被挤出去的句子靠这张表做二次过滤，不重播。 */
  const evicted = new Map()

  function remember(key, at = Date.now()) {
    seen.set(key, at)
    if (seen.size <= SEEN_LIMIT) return
    // Map 保持插入顺序，最早那条先丢；丢之前把时间戳留在 evicted 里。
    const oldest = seen.keys().next()
    if (!oldest.done) {
      evicted.set(oldest.value, seen.get(oldest.value) ?? at)
      seen.delete(oldest.value)
    }
    // evicted 同样限长，防止无限膨胀。
    if (evicted.size > SEEN_LIMIT) {
      const first = evicted.keys().next()
      if (!first.done) evicted.delete(first.value)
    }
  }

  async function tick() {
    if (busy) return
    busy = true
    try {
      const latest = await pickLatestSession(root)
      if (latest === null) return

      // mtime 没动就不解压，省掉整文件重读。
      if (latest.file === lastFile && latest.mtimeMs === lastMtime) return

      const buffer = await readFile(latest.file)
      let events
      try {
        events = parseEvents(decodeSession(buffer, latest.compressed))
      } catch (error) {
        // 压缩版解不开（老 Node 没有 zstd）时回退读同目录的明文会话，
        // 别因为一个解压能力缺失把整条念白链路闷掉；明文也没有就照常记错。
        if (!latest.compressed) throw error
        const plainFile = join(dirname(latest.file), PLAIN)
        try {
          events = parseEvents(await readFile(plainFile, 'utf8'))
        } catch {
          throw error
        }
      }
      lastFile = latest.file
      lastMtime = latest.mtimeMs
      lastSessionId = latest.id
      lastError = null

      // 回看这一轮是谁在说话：只认 source.kind === 'user' 的真实输入，
      // 时间戳、运行环境这些注入片段不算。
      let replyTo = ''

      for (const event of events) {
        if (event?.type === 'user/message') {
          if (event?.data?.source?.kind === 'user') replyTo = textOf(event?.data?.content)
          continue
        }
        if (event?.type !== 'assistant/message') continue
        const at = eventTime(event)
        // 时间认不出来就跳过：宁缺一句，也不拿旧回复凑数。
        if (at === null || at < startedAt - CLOCK_SLACK_MS) continue

        const text = clipReply(textOf(event?.data?.message?.content), maxChars)
        if (text === '') continue

        const key = replyKey(event, text)
        if (seen.has(key)) continue
        // 被淘汰过的 key：事件时间早于淘汰时刻的说明念过又被挤出，跳过；
        // 比淘汰时刻新才是真正的新事件。
        const evictedAt = evicted.get(key)
        if (evictedAt !== undefined && at <= evictedAt) continue
        remember(key, at)

        try {
          onReply(text, { sessionId: latest.id, at, userText: replyTo })
          lastReplyAt = Date.now()
        } catch (error) {
          // 回调失败就撤掉 seen：下一轮重读还能再试一次，别让一句台词永久丢失。
          seen.delete(key)
          log('[dsh-speech] 回调失败：', error?.message ?? error)
        }
      }
    } catch (error) {
      const message = error?.message ?? String(error)
      // 同一个错误不刷屏。
      if (message !== lastError) {
        lastError = message
        log('[dsh-speech] 读取会话失败：', message)
      }
    } finally {
      busy = false
    }
  }

  function start() {
    if (timer !== null) return
    startedAt = Date.now()
    seen.clear()
    // 淘汰快照跟着会话周期走：重启后 startedAt 会拦住旧事件，旧快照没有意义。
    evicted.clear()
    lastFile = null
    lastMtime = 0
    lastError = null
    log('[dsh-speech] 开始监听 DSH 回复', root)
    void tick()
    timer = setInterval(() => void tick(), intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop() {
    if (timer === null) return
    clearInterval(timer)
    timer = null
    log('[dsh-speech] 已停止监听')
  }

  return {
    start,
    stop,
    isRunning: () => timer !== null,
    status: () => ({
      running: timer !== null,
      sessionsRoot: root,
      sessionId: lastSessionId,
      lastReplyAt,
      error: lastError
    })
  }
}
