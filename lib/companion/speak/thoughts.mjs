/**
 * 念头池：还没说出口的话，以及每次主动决策的记录。
 *
 * 这一层不发起消息，也不替代 proactive.mjs 的判断。
 * 它做两件事：
 * - 把「刚才想到、但没说」的念头暂存起来，过几天还能自己想起来；
 * - 每次主动判断都留一条 gate / reason，观察台能回答「这次为什么没说」。
 *
 * 念头会过期，决策只留最近若干条，避免长期运行后无限增长。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { decideProactive } from './proactive.mjs'

const SCHEMA_VERSION = 2
const SAVE_DEBOUNCE_MS = 1_000
const DEFAULT_SCOPE = 'desktop'

/** 攒下的念头先放一会儿再说，避免刚记下就贴到脸上。 */
export const THOUGHT_MIN_AGE_MS = 20 * 60_000

export const DEFAULT_THOUGHT_LIMITS = {
  /** 同时最多挂 40 条，超出丢最旧的。 */
  maxThoughts: 40,
  /** 一条念头默认七天内有效。 */
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  /** 决策记录保留最近 40 条，观察台默认看 20 条。 */
  maxDecisions: 40
}

const STATUSES = new Set(['open', 'used', 'expired', 'dropped'])

function asText(value, max = 200) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, max)
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function cleanScope(value) {
  const scope = asText(value, 120)
  return scope === '' ? DEFAULT_SCOPE : scope
}

/** 决策闸门只有三类：放行、硬条件挡住、没有理由。 */
export function gateOf(reason) {
  const value = asText(reason, 40)
  if (value === 'addressed' || value === 'name_only' || value === 'topic_match' || value === 'closing') {
    return 'open'
  }
  if (value === 'empty' || value === 'from_self' || value === 'no_reason') return 'no_reason'
  if (value === '') return 'no_reason'
  return 'hard'
}

function freshThought(item) {
  const at = Math.max(0, asNumber(item?.at, 0))
  const ttl = Math.max(1000, asNumber(item?.ttlMs, DEFAULT_THOUGHT_LIMITS.ttlMs))
  const savedExpiry = asNumber(item?.expiresAt, 0)
  return {
    id: asText(item?.id, 40) || `t-${at}-${Math.random().toString(36).slice(2, 8)}`,
    scope: cleanScope(item?.scope),
    text: asText(item?.text),
    kind: asText(item?.kind, 24) || 'idle',
    at,
    // 0 与负数一律视为「没记过期时间」，按 at+ttl 重算，
    // 避免旧数据把 0 当成「永不过期」悄悄留下来。
    expiresAt: savedExpiry > 0 ? savedExpiry : at + ttl,
    status: STATUSES.has(item?.status) ? item.status : 'open',
    usedAt: Math.max(0, asNumber(item?.usedAt, 0)),
    weight: Math.min(1, Math.max(0, asNumber(item?.weight, 0.5)))
  }
}

function cleanThoughts(value) {
  const list = Array.isArray(value) ? value : []
  return list
    .map((item) => freshThought(item))
    .filter((item) => item.text !== '')
    .slice(-DEFAULT_THOUGHT_LIMITS.maxThoughts)
}

function freshDecision(item) {
  return {
    at: Math.max(0, asNumber(item?.at, 0)),
    scope: cleanScope(item?.scope),
    speak: item?.speak === true,
    // source 记录决策来自哪条通道；回读时不能丢，观察台才能看出全貌。
    source: asText(item?.source, 20),
    gate: asText(item?.gate, 20) || 'hard',
    reason: asText(item?.reason, 40) || 'unknown',
    text: asText(item?.text, 160),
    thoughtId: asText(item?.thoughtId, 40),
    hitCount: Math.max(0, asNumber(item?.hitCount, 0))
  }
}

function cleanDecisions(value) {
  const list = Array.isArray(value) ? value : []
  return list.map((item) => freshDecision(item)).slice(-DEFAULT_THOUGHT_LIMITS.maxDecisions)
}

export function createThoughtPool({ file = null, now = Date.now, log = () => {}, fs: io = fs } = {}) {
  let thoughts = []
  let decisions = []
  let loaded = false
  let loading = null
  let saveTimer = null
  let needsBackup = false
  // 最近一次读盘失败（非 ENOENT）的原因；坏文件隔离成功前禁止写盘，
  // 否则会用内存里的空数据把原文件整个覆盖掉。
  let loadError = null

  async function ready() {
    if (loaded) return { thoughts, decisions }
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (file !== null) {
          const parsed = JSON.parse(await io.readFile(file, 'utf8'))
          if (parsed !== null && typeof parsed === 'object') {
            const version = Number(parsed.schemaVersion)
            if (!Number.isFinite(version) || version < SCHEMA_VERSION) needsBackup = true
            thoughts = cleanThoughts(parsed.thoughts)
            decisions = cleanDecisions(parsed.decisions)
          }
        }
        loadError = null
        loaded = true
      } catch (error) {
        if (error?.code === 'ENOENT') {
          // 文件本来就不存在，属于首次启动，直接按空白开始。
          loadError = null
          loaded = true
        } else {
          // 读失败保持未加载，让下一次 ready() 有机会重试；
          // 坏文件在写盘前会被先隔离，而不是被空数据覆盖。
          loadError = error
          loaded = false
          log('念头池读取失败，等待重试', error)
        }
      } finally {
        loading = null
      }
      return { thoughts, decisions }
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
      await io.mkdir(path.dirname(file), { recursive: true })
      // 读盘失败过的坏文件不能直接覆盖：先改名隔离，改不了名就这次不写。
      // 隔离成功后才允许写新文件，坏文件本身留在 .corrupt-* 里等人工查看。
      if (loadError !== null) {
        try {
          await io.rename(file, `${file}.corrupt-${Date.now()}`)
          loadError = null
        } catch (error) {
          if (error?.code === 'ENOENT') {
            // 文件已经不在了，没有可覆盖的坏文件，放行这次写入。
            loadError = null
          } else {
            log('念头池坏文件隔离失败，本次跳过写入', error)
            return
          }
        }
      }
      if (needsBackup) {
        try {
          await io.copyFile(file, `${file}.bak`)
        } catch (error) {
          if (error?.code !== 'ENOENT') log('念头池迁移备份失败，继续写入', error)
        }
      }
      // 先写临时文件再 rename：写到一半进程退出，最多留下 .tmp，
      // 不会把正式文件截成半截 JSON。
      const tmp = `${file}.tmp`
      await io.writeFile(
        tmp,
        JSON.stringify({ schemaVersion: SCHEMA_VERSION, thoughts, decisions }),
        'utf8'
      )
      await io.rename(tmp, file)
      needsBackup = false
    } catch (error) {
      log('念头池写入失败', error)
    }
  }

  async function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await persist()
  }

  /** 过期的念头只是改状态，不删；观察台仍能看出它曾经存在过。 */
  function expireStale() {
    const at = now()
    let changed = false
    for (const item of thoughts) {
      if (item.status === 'open' && item.expiresAt > 0 && item.expiresAt <= at) {
        item.status = 'expired'
        changed = true
      }
    }
    if (changed) scheduleSave()
    return changed
  }

  /**
   * 记一条念头。同 scope 下相同文字若还开着，直接返回旧的那条，
   * 避免同一件事反复入池。
   */
  function add({ text, scope = DEFAULT_SCOPE, kind = 'idle', ttlMs, weight } = {}) {
    const clean = asText(text)
    if (clean === '') return null
    const key = cleanScope(scope)
    expireStale()
    const existing = thoughts.find(
      (item) => item.scope === key && item.text === clean && item.status === 'open'
    )
    if (existing !== undefined) return { ...existing }

    const at = now()
    const ttl = Math.max(1000, asNumber(ttlMs, DEFAULT_THOUGHT_LIMITS.ttlMs))
    const thought = freshThought({
      text: clean,
      scope: key,
      kind,
      at,
      expiresAt: at + ttl,
      weight
    })
    thoughts.push(thought)
    if (thoughts.length > DEFAULT_THOUGHT_LIMITS.maxThoughts) {
      thoughts = thoughts.slice(-DEFAULT_THOUGHT_LIMITS.maxThoughts)
    }
    scheduleSave()
    return { ...thought }
  }

  function list({ scope = null, status = null, limit = 20 } = {}) {
    expireStale()
    const key = scope === null ? null : cleanScope(scope)
    const wanted = typeof status === 'string' ? status : null
    return thoughts
      .filter((item) => (key === null || item.scope === key) && (wanted === null || item.status === wanted))
      .slice(-Math.max(1, limit))
      .reverse()
      .map((item) => ({ ...item }))
  }

  /** 只有还开着的念头能被用掉；重复调用不会改写已经结束的状态。 */
  function markUsed(id, { scope = null } = {}) {
    const key = scope === null ? null : cleanScope(scope)
    const item = thoughts.find(
      (entry) => entry.id === id && (key === null || entry.scope === key) && entry.status === 'open'
    )
    if (item === undefined) return null
    item.status = 'used'
    item.usedAt = now()
    scheduleSave()
    return { ...item }
  }

  function drop(id, { scope = null, reason = '' } = {}) {
    const key = scope === null ? null : cleanScope(scope)
    const item = thoughts.find(
      (entry) => entry.id === id && (key === null || entry.scope === key) && entry.status === 'open'
    )
    if (item === undefined) return null
    item.status = 'dropped'
    item.usedAt = now()
    if (reason !== '') item.kind = asText(reason, 24)
    scheduleSave()
    return { ...item }
  }

  /** 在还开着的念头里挑一条和这次话题最接近的，挑不到就返回 null。 */
  function pickForHits(hits, { scope = DEFAULT_SCOPE } = {}) {
    const key = cleanScope(scope)
    const fragments = (Array.isArray(hits) ? hits : [])
      .map((item) => asText(item?.fragment, 60))
      .filter((item) => item !== '')
    if (fragments.length === 0) return null
    expireStale()
    let best = null
    let bestScore = 0
    for (const item of thoughts) {
      if (item.scope !== key || item.status !== 'open') continue
      let score = 0
      for (const fragment of fragments) if (item.text.includes(fragment)) score += 1
      if (score > bestScore) {
        best = item
        bestScore = score
      }
    }
    return best === null ? null : { ...best }
  }

  /**
   * 每次主动判断都留档；gate 与 reason 不允许为空。
   *
   * text 是候选原文，spoken 是真正进了气泡的那句。
   * 句末温度只发生在气泡通道，两条都截在记录层，截断不回写气泡。
   */
  function recordDecision({
    scope = DEFAULT_SCOPE,
    speak = false,
    source = '',
    gate,
    reason,
    text = '',
    spoken = '',
    thoughtId = '',
    hits = []
  } = {}) {
    const cleanReason = asText(reason, 40) || 'unknown'
    const decision = {
      at: now(),
      scope: cleanScope(scope),
      speak: speak === true,
      source: asText(source, 20),
      gate: asText(gate, 20) || gateOf(cleanReason),
      reason: cleanReason,
      text: asText(text, 160),
      spoken: asText(spoken, 160),
      thoughtId: asText(thoughtId, 40),
      hitCount: Array.isArray(hits) ? hits.length : 0
    }
    decisions.push(decision)
    if (decisions.length > DEFAULT_THOUGHT_LIMITS.maxDecisions) {
      decisions = decisions.slice(-DEFAULT_THOUGHT_LIMITS.maxDecisions)
    }
    scheduleSave()
    return { ...decision }
  }

  /**
   * 包一层 decideProactive：判断完立刻记档。
   * 放行时如果命中池里的念头，顺手把那条标记为已用。
   */
  function decideAndRecord(options = {}) {
    // 统一用池子的时钟，测试与回放才能和决策记录对上。
    const decision = decideProactive({ ...options, now: now() })
    const scope = cleanScope(options.scope)
    const gate = decision.speak === true ? 'open' : gateOf(decision.reason)
    const picked = decision.speak === true ? pickForHits(decision.hits, { scope }) : null
    recordDecision({
      scope,
      speak: decision.speak,
      source: asText(options.source, 20) || (picked === null ? '' : 'thought'),
      gate,
      reason: decision.reason,
      text: options.text,
      thoughtId: picked?.id ?? '',
      hits: decision.hits
    })
    if (picked !== null) markUsed(picked.id, { scope })
    return decision
  }

  function decisionsList({ limit = 20 } = {}) {
    return decisions.slice(-Math.max(1, limit)).reverse().map((item) => ({ ...item }))
  }

  function snapshot() {
    expireStale()
    const counts = { open: 0, used: 0, expired: 0, dropped: 0 }
    for (const item of thoughts) {
      if (counts[item.status] !== undefined) counts[item.status] += 1
    }
    return {
      total: thoughts.length,
      counts,
      open: list({ status: 'open', limit: 10 }),
      decisions: decisionsList({ limit: 20 })
    }
  }

  /** 恢复备份后重新读盘，不让旧念头继续参与主动开口。 */
  async function reload() {
    if (file === null) return { thoughts, decisions }
    try {
      const parsed = JSON.parse(await io.readFile(file, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        thoughts = cleanThoughts(parsed.thoughts)
        decisions = cleanDecisions(parsed.decisions)
      }
      loaded = true
      loadError = null
    } catch (error) {
      if (error?.code === 'ENOENT') {
        loaded = true
        loadError = null
      } else {
        // 重载失败保留当前内存内容，但记下失败原因，
        // 让下一次写盘前先把坏文件隔离，而不是直接覆盖。
        loadError = error
        log('念头池重载失败，保留当前内容', error)
      }
    }
    return { thoughts, decisions }
  }

  async function reset() {
    thoughts = []
    decisions = []
    await persist()
  }

  return {
    ready,
    reload,
    add,
    list,
    markUsed,
    drop,
    pickForHits,
    recordDecision,
    decideAndRecord,
    decisions: decisionsList,
    snapshot,
    flush,
    reset,
    toJSON: () => ({ schemaVersion: SCHEMA_VERSION, thoughts, decisions })
  }
}
