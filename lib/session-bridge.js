/**
 * 会话桥（只读）。
 *
 * 依据 docs/会话接入结论.md：
 *   DSH 0.2.1-rc.3 的宿主侧没有可直接调用的发送入口，
 *   唯一的 session/prompt 是远端 claim，要求 owner peer。
 *
 * 所以这里只做三件事：
 *   1. 列会话（工作区 + 会话目录）
 *   2. 读历史（zstd 解压 + 事件映射）
 *   3. 增量推送（轮询 mtime，变了才重新解压）
 *
 * send() 永远返回 501 语义，不写假成功、不排队、不重试。
 * 本模块不依赖 Electron，存储根可从外面注入。
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

const SESSION_DIR_RE = /^session-(.+)$/
const SESSION_ID_RE = /^[A-Za-z0-9_-]{6,80}$/
const COMPRESSED = 'session.v4.jsonl.zstd'
const PLAIN = 'session.v4.jsonl'

export const SEND_UNAVAILABLE = 'send-unavailable'

/** 绑定会话优先；没有绑定就跟当前活动会话。 */
export function resolveSessionId(boundSessionId, activeSessionId) {
  return boundSessionId ?? activeSessionId ?? null
}

export function resolveSessionsRoot(dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  return join(dshHome, 'sessions')
}

/**
 * 宿主活会话的「生成中」判断。
 *
 * DSH 没有一条固定字段名写进文档：不同版本里可能是 running / isRunning /
 * status。这里只认明确的布尔值或状态词，拿不到就返回 undefined，交给文件侧
 * 的 turn 事件推断，不把「不知道」当成「空闲」。
 */
export function sessionRunning(session) {
  if (session === null || typeof session !== 'object') return undefined
  for (const value of [session.running, session.isRunning]) {
    if (typeof value === 'boolean') return value
  }
  const status = String(session.status ?? session.state ?? '')
    .trim()
    .toLowerCase()
  if (['running', 'busy', 'working', 'active', 'generating'].includes(status)) return true
  if (['idle', 'done', 'finished', 'stopped', 'ended', 'complete', 'completed'].includes(status)) return false
  return undefined
}

/** 宿主活会话里能顺手拿到的标题；只读，不为了标题去解压历史。 */
export function sessionTitle(session) {
  if (session === null || typeof session !== 'object') return ''
  for (const value of [session.title, session.header?.title, session.meta?.title]) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

function defaultDecompress(buffer) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 没有 zstd 解压能力')
  }
  return zlib.zstdDecompressSync(buffer)
}

function clip(text, max = 1200) {
  const value = typeof text === 'string' ? text : String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 把 message.content 里的文本片段拼起来。 */
export function textOf(content, filter = null) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((item) => item && typeof item === 'object')
    .filter((item) => (filter === null ? item.type === 'text' : item.type === filter))
    .map((item) => (typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n')
}

/** 事件 → 桌宠能直接用的消息。返回 null 表示这条事件不展示。 */
export function summarizeEvent(event) {
  const type = event?.type
  const data = event?.data ?? {}
  const at = event?.time ?? null
  switch (type) {
    case 'user/message':
      return { kind: 'message', role: 'user', id: data.id ?? null, text: textOf(data.content), at }
    case 'assistant/message':
      return {
        kind: 'message',
        role: 'assistant',
        turn: data.turn ?? null,
        step: data.step ?? null,
        text: textOf(data.message?.content),
        reasoning: textOf(data.message?.content, 'reasoning'),
        at,
      }
    case 'tool/call':
      return {
        kind: 'tool-call',
        name: data.name ?? '?',
        callId: data.callId ?? null,
        arguments: clip(data.arguments, 2000),
        at,
      }
    case 'tool/result':
      return {
        kind: 'tool-result',
        callId: data.message?.toolCallId ?? null,
        text: clip(textOf(data.message?.content), 2000),
        isError: data.message?.isError === true,
        at,
      }
    case 'session/title':
      return { kind: 'title', title: data.title ?? '', at }
    case 'todo/write':
      return { kind: 'todo', todos: data.todos ?? [], at }
    case 'approval/asked':
      return { kind: 'approval', approvalId: data.id ?? null, toolName: data.toolName ?? '', reason: data.reason ?? '', at }
    case 'approval/decided':
      return { kind: 'approval-result', approvalId: data.id ?? null, outcome: data.outcome ?? '', at }
    case 'turn/start':
      return { kind: 'turn', phase: 'start', turn: data.turn ?? null, at }
    case 'turn/end':
      return { kind: 'turn', phase: 'end', turn: data.turn ?? null, reason: data.reason ?? '', at }
    default:
      return null
  }
}

/**
 * 工具参数是 JSON 字符串，但可能已经被截断。挑一个最能说明意图的字段做摘要：
 * 先认路径与命令，只有正文类字段时说清楚是多大一段，不把代码搬出来。
 */
export function summarizeToolArguments(raw, max = 48) {
  const text = typeof raw === 'string' ? raw : ''
  if (text.trim() === '') return ''
  let parsed = null
  if (typeof raw === 'object' && raw !== null) {
    parsed = raw
  } else {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  const keys = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'name']
  if (parsed !== null && typeof parsed === 'object') {
    for (const key of keys) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim() !== '') return shortenPath(value, max)
    }
    for (const key of ['content', 'new_string', 'old_string', 'prompt']) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim() !== '') {
        return key === 'prompt' ? `指令 ${value.length} 字` : `正文 ${value.length} 字`
      }
    }
    return ''
  }

  /* 截断的 JSON 解不开，就从原文里按同样的优先级抠字段 */
  for (const key of keys) {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)
    if (match !== null && match[1].trim() !== '') return shortenPath(match[1], max)
  }
  if (/"(content|new_string|old_string|prompt)"\s*:\s*"/.test(text)) return '正文（较长）'
  return ''
}

/** 用户目录换成 ~，少暴露一点本机信息。 */
function shortenPath(value, max) {
  let text = typeof value === 'string' ? value : String(value ?? '')
  const home = homedir()
  if (home !== '' && text.includes(home)) text = text.split(home).join('~')
  return clip(text, max)
}

/**
 * 把消息流里的 tool-call / tool-result 配成一条条记录。
 *
 * 状态：running（只有调用）、ok、failed（结果带 isError）。
 * 耗时用两个事件的时间戳相减，单位是毫秒。
 */
export function buildToolRuns(messages, limit = 8) {
  const runs = []
  const pending = new Map()
  for (const item of messages) {
    if (item?.kind === 'tool-call') {
      const run = {
        callId: item.callId ?? null,
        name: clip(item.name ?? '工具', 24),
        summary: summarizeToolArguments(item.arguments),
        argText: shortenPath(item.arguments ?? '', 320),
        startedAt: typeof item.at === 'number' ? item.at : null,
        endedAt: null,
        durationMs: null,
        status: 'running',
        detail: '',
      }
      if (run.callId !== null) pending.set(run.callId, run)
      runs.push(run)
      continue
    }
    if (item?.kind === 'tool-result') {
      const run = item.callId !== null ? pending.get(item.callId) : undefined
      if (run === undefined) {
        /* 只有结果没有调用：单独留一条，标成孤儿不硬配 */
        runs.push({
          callId: item.callId ?? null,
          name: '工具',
          summary: '',
          argText: '',
          startedAt: null,
          endedAt: typeof item.at === 'number' ? item.at : null,
          durationMs: null,
          status: item.isError === true ? 'failed' : 'ok',
          detail: shortenPath(item.text ?? '', 320),
        })
        continue
      }
      run.endedAt = typeof item.at === 'number' ? item.at : null
      run.status = item.isError === true ? 'failed' : 'ok'
      run.detail = shortenPath(item.text ?? '', 320)
      if (run.startedAt !== null && run.endedAt !== null) {
        run.durationMs = Math.max(0, run.endedAt - run.startedAt)
      }
    }
  }
  return runs.slice(-limit)
}

async function pickFile(dir) {
  for (const name of [COMPRESSED, PLAIN]) {
    const file = join(dir, name)
    try {
      await stat(file)
      return file
    } catch {
      /* 下一个 */
    }
  }
  return null
}

export function createSessionBridge(options = {}) {
  const root = options.root ?? resolveSessionsRoot(options.dshHome)
  const decompress = options.decompress ?? defaultDecompress
  const pollMs = options.pollMs ?? 1200
  const historyLimit = options.historyLimit ?? 400
  const cache = new Map()

  async function loadRecord(file) {
    const info = await stat(file)
    const cached = cache.get(file)
    if (cached && cached.mtimeMs === info.mtimeMs) return cached

    const raw = await readFile(file)
    const text = /\.zstd$/i.test(file) ? decompress(raw).toString('utf8') : raw.toString('utf8')
    const events = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        events.push(JSON.parse(trimmed))
      } catch {
        /* 正在写入的尾行，跳过 */
      }
    }
    const record = { mtimeMs: info.mtimeMs, size: info.size, events }
    cache.set(file, record)
    return record
  }

  async function locate(id) {
    if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) return null
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name, `session-${id}`)
      const file = await pickFile(dir)
      if (file !== null) return { id, workspace: entry.name, dir, file }
    }
    return null
  }

  /** 列会话：只读目录与文件元信息，不解压。 */
  async function listSessions() {
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return { root, exists: false, workspaces: [] }
    }

    const workspaces = []
    for (const entry of entries.slice(0, 40)) {
      if (!entry.isDirectory()) continue
      const workspacePath = join(root, entry.name)
      let children = []
      try {
        children = await readdir(workspacePath, { withFileTypes: true })
      } catch {
        continue
      }

      const sessions = []
      for (const child of children) {
        if (!child.isDirectory()) continue
        const match = SESSION_DIR_RE.exec(child.name)
        if (match === null) continue
        const dir = join(workspacePath, child.name)
        const file = await pickFile(dir)
        if (file === null) continue
        let info = null
        try {
          info = await stat(file)
        } catch {
          continue
        }
        const cached = cache.get(file)
        const title = cached === undefined
          ? null
          : (cached.events.find((event) => event?.type === 'session/title')?.data?.title ?? null)
        sessions.push({
          id: match[1],
          workspace: entry.name,
          file,
          size: info.size,
          updatedAt: info.mtimeMs,
          title,
        })
      }

      sessions.sort((a, b) => b.updatedAt - a.updatedAt)
      workspaces.push({
        name: entry.name,
        path: workspacePath,
        total: sessions.length,
        sessions: sessions.slice(0, 50),
      })
    }

    return { root, exists: true, workspaces }
  }

/** 消息流里不展示的元事件：标题单独给，待办与审批各有自己的视图。 */
const META_KINDS = new Set(['title', 'todo', 'approval', 'approval-result'])

function toMessages(events) {
  return events
    .map(summarizeEvent)
    .filter((item) => item !== null && !META_KINDS.has(item.kind))
}

  /** 读历史：返回最近 limit 条可展示消息。 */
  async function readSession(id, readOptions = {}) {
    const located = await locate(id)
    if (located === null) return null
    const record = await loadRecord(located.file)
    const limit = Number.isFinite(readOptions.limit) ? readOptions.limit : historyLimit
    const all = toMessages(record.events)
    const title = record.events.find((event) => event?.type === 'session/title')?.data?.title ?? null
    const lastTurn = [...record.events].reverse().find((event) => event?.type === 'turn/start' || event?.type === 'turn/end')
    /* 最后一条可展示的消息：跳过 turn 标记，实在没有才回落到标记本身 */
    const lastMessage = [...all].reverse().find((item) => item.kind !== 'turn') ?? all.at(-1) ?? null
    return {
      id,
      workspace: located.workspace,
      file: located.file,
      updatedAt: record.mtimeMs,
      total: all.length,
      title,
      /* 最后一次回合是 start 说明这一轮还没收尾 */
      busy: lastTurn?.type === 'turn/start',
      last:
        lastMessage === null
          ? null
          : {
              kind: lastMessage.kind,
              role: lastMessage.role ?? null,
              text: clip(lastMessage.text ?? '', 120),
              at: lastMessage.at ?? null,
            },
      messages: all.slice(Math.max(0, all.length - limit)),
      /* 工具记录从全量事件派生，不受 messages 的 limit 影响 */
      tools: buildToolRuns(all),
    }
  }

  /**
   * 增量跟随：只在消息条数变化时回调。
   * onAppend(fresh, meta)；首次回调是 initial，fresh 为空。
   */
  function watch(id, onAppend, onError) {
    let stopped = false
    let lastCount = -1
    let timer = null

    const tick = async () => {
      if (stopped) return
      try {
        const located = await locate(id)
        if (located === null) throw new Error('会话不存在')
        const record = await loadRecord(located.file)
        const messages = toMessages(record.events)
        if (lastCount < 0) {
          lastCount = messages.length
          onAppend([], { initial: true, total: lastCount })
          return
        }
        if (messages.length > lastCount) {
          const fresh = messages.slice(lastCount)
          lastCount = messages.length
          onAppend(fresh, { initial: false, total: lastCount })
        }
      } catch (error) {
        onError?.(error)
      }
    }

    timer = setInterval(() => {
      void tick()
    }, pollMs)
    timer.unref?.()
    void tick()

    return () => {
      stopped = true
      if (timer !== null) clearInterval(timer)
    }
  }

  /** 发送：能力未开放，固定返回 501 语义。 */
  function send() {
    return {
      ok: false,
      code: SEND_UNAVAILABLE,
      reason: 'DSH 宿主侧没有可调用的发送入口；session/prompt 是远端 claim，需要 owner peer',
      doc: 'docs/会话接入结论.md',
    }
  }

  return { root, listSessions, readSession, watch, send, locate }
}
