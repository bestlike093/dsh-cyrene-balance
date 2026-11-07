/**
 * 跨窗口承接：在桌面聊到一半，切到 QQ 时还能接上那句没说完的话。
 *
 * 只存一句话题摘要，不存原文。摘要由调用方生成，这里只负责：
 * - 把摘要和「从哪来」「到哪去」一起记下来；
 * - TTL 到点自动失效；
 * - 同一对窗口只保留最新一条，避免旧话反复冒出来。
 */
import fs from 'node:fs/promises'

const SCHEMA_VERSION = 2
const SAVE_DEBOUNCE_MS = 500
export const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000
const MAX_ITEMS = 20
const MAX_TOPIC_CHARS = 80
const MAX_TOPIC_SOURCE_CHARS = 36

function asText(value, max = 120) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, max)
}

function readEntry(value) {
  if (value === null || typeof value !== 'object') return null
  const fromScope = asText(value.fromScope, 80)
  const toScope = asText(value.toScope, 80)
  const topic = asText(value.topic, MAX_TOPIC_CHARS)
  const createdAt = Number(value.createdAt)
  const ttlMs = Number(value.ttlMs)
  if (fromScope === '' || toScope === '' || topic === '') return null
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null
  return {
    fromScope,
    toScope,
    topic,
    createdAt,
    ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS
  }
}

/**
 * 只让桌面与 QQ 私聊互相带话。
 *
 * 群聊是公开场合，把私下没说完的话带进去不合适；反过来也不该把群里的
 * 对话带回桌面。这里先挡住方向，再谈摘要。
 */
export function canHandoff(fromScope, toScope) {
  const from = asText(fromScope, 80)
  const to = asText(toScope, 80)
  if (from === '' || to === '' || from === to) return false
  const privateScope = (scope) => scope === 'desktop' || /^qq:private(?::|$)/.test(scope)
  return privateScope(from) && privateScope(to)
}

/**
 * 从上一段对话里取一句「还没说完」的话题。
 *
 * 只取对方最后一句话的开头，不带她的回复，也不拼成长段原文。
 * 切过去以后由模型自己决定怎么接，不把整段对话搬过去。
 */
export function summarizeHandoffTopic(history) {
  const turns = Array.isArray(history) ? history : []
  const lastUser = [...turns].reverse().find((turn) => turn?.role === 'user')
  const text = asText(lastUser?.content, MAX_TOPIC_SOURCE_CHARS)
  return text === '' ? '' : `刚才在说「${text}」`
}

export function createHandoffStore({ file = null, now = Date.now, log = () => {} } = {}) {
  let entries = []
  let loaded = false
  let loading = null
  let saveTimer = null
  let needsBackup = false

  async function ready() {
    if (loaded) return list()
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (file !== null) {
          const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
          if (parsed !== null && typeof parsed === 'object') {
            const version = Number(parsed.schemaVersion)
            if (!Number.isFinite(version) || version < SCHEMA_VERSION) needsBackup = true
            const source = Array.isArray(parsed.entries) ? parsed.entries : []
            entries = source.map(readEntry).filter((item) => item !== null).slice(-MAX_ITEMS)
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') log('承接记录读取失败，从空白开始', error)
      } finally {
        loaded = true
        loading = null
      }
      return list()
    })()
    return loading
  }

  function scheduleSave() {
    if (file === null || saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }

  async function persist() {
    if (file === null) return
    try {
      await fs.mkdir(file.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
      if (needsBackup) {
        try {
          await fs.copyFile(file, `${file}.bak`)
        } catch (error) {
          if (error?.code !== 'ENOENT') log('承接记录迁移备份失败，继续写入', error)
        }
      }
      await fs.writeFile(
        file,
        JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries }),
        'utf8'
      )
      needsBackup = false
    } catch (error) {
      log('承接记录写入失败', error)
    }
  }

  async function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await persist()
  }

  function alive(entry) {
    return entry.createdAt + entry.ttlMs > now()
  }

  /** 顺手清掉过期项；只在真的有变化时标脏。 */
  function refresh() {
    const next = entries.filter(alive)
    if (next.length !== entries.length) {
      entries = next
      scheduleSave()
    }
  }

  /**
   * 记一条承接摘要。
   * topic 只该是一句话，长段落会被压平并截断——原文不归这里管。
   */
  function write({ fromScope, toScope, topic, ttlMs } = {}) {
    refresh()
    const from = asText(fromScope, 80)
    const to = asText(toScope, 80)
    const summary = asText(topic, MAX_TOPIC_CHARS)
    if (from === '' || to === '' || summary === '' || from === to) {
      return { ok: false, reason: 'invalid' }
    }
    const entry = {
      fromScope: from,
      toScope: to,
      topic: summary,
      createdAt: now(),
      ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS
    }
    // 同一对窗口只留最新一条：旧话不该在新场景里反复出现。
    entries = entries.filter((item) => !(item.fromScope === from && item.toScope === to))
    entries.push(entry)
    if (entries.length > MAX_ITEMS) entries = entries.slice(-MAX_ITEMS)
    scheduleSave()
    return { ok: true, entry }
  }

  /** 到某个窗口时该接的那一句；没有就返回 null。 */
  function readFor(toScope) {
    refresh()
    const target = asText(toScope, 80)
    if (target === '') return null
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry !== undefined && entry.toScope === target) return { ...entry }
    }
    return null
  }

  /**
   * 到某个窗口时接上这一句，并把它消费掉。
   *
   * 和 `readFor` 的区别：同一句话只该提醒一次，否则每轮都会重复。
   */
  function consumeFor(toScope) {
    refresh()
    const target = asText(toScope, 80)
    if (target === '') return null
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry !== undefined && entry.toScope === target) {
        entries.splice(index, 1)
        scheduleSave()
        return { ...entry }
      }
    }
    return null
  }

  /** 观察台用：未过期的全部记录，最新在前。 */
  function list() {
    refresh()
    return entries.slice().reverse().map((entry) => ({ ...entry }))
  }

  /** 手动清空某个方向的承接，比如用户不想被追问。 */
  function clear({ fromScope = null, toScope = null } = {}) {
    const from = fromScope === null ? null : asText(fromScope, 80)
    const to = toScope === null ? null : asText(toScope, 80)
    const before = entries.length
    entries = entries.filter((item) => {
      if (from !== null && item.fromScope !== from) return true
      if (to !== null && item.toScope !== to) return true
      return false
    })
    const removed = before - entries.length
    if (removed > 0) scheduleSave()
    return { ok: true, removed }
  }

  return {
    ready,
    write,
    readFor,
    consumeFor,
    list,
    clear,
    flush,
    toJSON: () => ({ schemaVersion: SCHEMA_VERSION, entries })
  }
}
