/**
 * DSH 念出的自检：用真实会话文件走一遍 查找 → 解压 → 取正文。
 *
 * 只读，不启动桌宠、不发声。输出能直接看出「能不能找到会话、能不能读出她的原话」。
 * 用法：node electron/dsh-speech-check.mjs
 */
import { readFile } from 'node:fs/promises'
import zlib from 'node:zlib'
import { eventTime, listSessions, parseEvents, resolveSessionsRoot, textOf } from './dsh-speech.mjs'

function decode(buffer, compressed) {
  if (!compressed) return buffer.toString('utf8')
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 没有 zstd 解压能力')
  }
  return zlib.zstdDecompressSync(buffer).toString('utf8')
}

const SCAN = 12

const root = resolveSessionsRoot()
const sessions = await listSessions(root)
if (sessions.length === 0) {
  console.log(JSON.stringify({ ok: false, reason: 'no-session', sessionsRoot: root }))
  process.exit(1)
}

let assistants = 0
let withText = 0
const samples = []

for (const session of sessions.slice(0, SCAN)) {
  let events
  try {
    events = parseEvents(decode(await readFile(session.file), session.compressed))
  } catch {
    continue
  }
  for (const event of events) {
    if (event?.type !== 'assistant/message') continue
    assistants += 1
    const text = textOf(event?.data?.message?.content).trim()
    if (text === '') continue
    withText += 1
    if (samples.length < 3) {
      samples.push({ session: session.id, at: eventTime(event), length: text.length, head: text.slice(0, 60) })
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: withText > 0,
      sessionsRoot: root,
      sessions: sessions.length,
      scanned: Math.min(SCAN, sessions.length),
      latest: { id: sessions[0].id, compressed: sessions[0].compressed, mtime: new Date(sessions[0].mtimeMs).toISOString() },
      assistantMessages: assistants,
      repliesWithText: withText,
      samples
    },
    null,
    2
  )
)
