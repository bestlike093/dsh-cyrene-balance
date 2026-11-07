/**
 * 群梗词典。
 *
 * 规则层只负责「发现候选」和「记录用后反馈」，不判断梗的含义——
 * 含义判断留给模型。这里存的是使用轨迹：
 *   seen       在群里见过几次
 *   uses       被她实际用出去几次
 *   pickedUp   用出去之后有人接了几次
 *   askedBack  用出去之后有人反问「什么意思」几次
 *
 * 可用度 = (pickedUp + 1) / (uses + askedBack * 2 + 1)。
 * 接了就算加分，被反问两次还没人接，就退役，不再往提示词里塞。
 *
 * 只存短语本身，不存原句；落盘文件在 userData 下，和画像分开。
 */
import fs from 'node:fs/promises'

const VERSION = 1
const DEFAULT_MAX_ENTRIES = 300
const STALE_DAYS = 90
const RECENT_USE_MS = 24 * 60 * 60 * 1000
const SAVE_DEBOUNCE_MS = 1000

function asNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function cleanPhrase(value) {
  if (typeof value !== 'string') return ''
  const phrase = value.trim().replace(/\s+/g, ' ')
  if (phrase.length < 2 || phrase.length > 12) return ''
  return phrase
}

function cleanScope(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : ''
}

function keyOf(scope, phrase) {
  return `${scope}\u0000${phrase}`
}

/** 反问 / 没听懂。命中说明这个梗用得不合时宜。 */
const ASK_BACK = /(什么|啥|咋)意思|没听懂|听不懂|看不懂|没懂|啥梗|什么梗/

/**
 * @param {object} options
 * @param {string} options.filePath
 * @param {() => number} [options.now]
 * @param {(message: string, error?: unknown) => void} [options.log]
 * @param {number} [options.maxEntries]
 */
export function createMemeDictionary(options = {}) {
  const { filePath, now = Date.now, log = () => {}, maxEntries = DEFAULT_MAX_ENTRIES } = options

  /** @type {Map<string, object>} */
  let entries = new Map()
  let loaded = false
  let loading = null
  let saveTimer = null
  let writeChain = Promise.resolve(true)

  async function load() {
    if (loaded) return { ok: true, count: entries.size }
    if (loading !== null) return loading
    loading = (async () => {
      try {
        let parsed = null
        try {
          parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
        } catch (error) {
          if (error?.code === 'ENOENT') return { ok: true, count: 0 }
          throw error
        }
        const list = Array.isArray(parsed?.entries) ? parsed.entries : []
        entries = new Map()
        for (const item of list) {
          if (item === null || typeof item !== 'object') continue
          const scope = cleanScope(item.scope)
          const phrase = cleanPhrase(item.phrase)
          if (scope === '' || phrase === '') continue
          entries.set(keyOf(scope, phrase), {
            scope,
            phrase,
            firstSeenAt: asNumber(item.firstSeenAt, 0),
            lastSeenAt: asNumber(item.lastSeenAt, 0),
            seen: Math.max(0, Math.floor(asNumber(item.seen))),
            uses: Math.max(0, Math.floor(asNumber(item.uses))),
            pickedUp: Math.max(0, Math.floor(asNumber(item.pickedUp))),
            askedBack: Math.max(0, Math.floor(asNumber(item.askedBack))),
            lastUsedAt: asNumber(item.lastUsedAt, 0),
            retired: item.retired === true,
            updatedAt: asNumber(item.updatedAt, 0)
          })
        }
        return { ok: true, count: entries.size }
      } catch (error) {
        log('群梗词典读取失败，按空词典继续', error)
        entries = new Map()
        return { ok: false, reason: 'unreadable' }
      } finally {
        loaded = true
        loading = null
      }
    })()
    return loading
  }

  function scheduleSave() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flush()
    }, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }

  async function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    writeChain = writeChain.then(async () => {
      try {
        prune()
        const list = [...entries.values()]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, maxEntries)
        const temp = `${filePath}.tmp`
        await fs.mkdir(filePath.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
        await fs.writeFile(temp, JSON.stringify({ version: VERSION, entries: list }), 'utf8')
        await fs.rename(temp, filePath)
        return true
      } catch (error) {
        log('群梗词典写入失败', error)
        return false
      }
    })
    return writeChain
  }

  /** 太久没出现、也没被用过的条目直接清掉，避免文件无限长。 */
  function prune() {
    const at = now()
    for (const [key, entry] of entries) {
      const lastSeen = entry.lastSeenAt || entry.updatedAt
      if (entry.uses === 0 && at - lastSeen > STALE_DAYS * 86_400_000) entries.delete(key)
    }
  }

  /** 收录候选：见一次加一次，不覆盖第一次出现的时间。 */
  function observe(scope, candidates, at = now()) {
    const cleanScopeValue = cleanScope(scope)
    if (cleanScopeValue === '' || !Array.isArray(candidates)) return 0
    let changed = 0
    for (const item of candidates) {
      const phrase = cleanPhrase(item?.phrase ?? item)
      if (phrase === '') continue
      const key = keyOf(cleanScopeValue, phrase)
      const previous = entries.get(key)
      const count = Math.max(1, Math.floor(asNumber(item?.count, 1)))
      if (previous === undefined) {
        entries.set(key, {
          scope: cleanScopeValue,
          phrase,
          firstSeenAt: at,
          lastSeenAt: at,
          seen: count,
          uses: 0,
          pickedUp: 0,
          askedBack: 0,
          lastUsedAt: 0,
          retired: false,
          updatedAt: at
        })
      } else {
        previous.seen += count
        previous.lastSeenAt = at
        previous.updatedAt = at
      }
      changed += 1
    }
    if (changed > 0) scheduleSave()
    return changed
  }

  /**
   * 她刚刚把哪些梗说出去了。只记该 scope 下、最近 24 小时内没在用的条目，
   * 避免一句话里重复命中同一个词被算成多次。
   */
  function markUsed(scope, text, at = now()) {
    const cleanScopeValue = cleanScope(scope)
    if (cleanScopeValue === '' || typeof text !== 'string' || text === '') return []
    const used = []
    for (const entry of entries.values()) {
      if (entry.scope !== cleanScopeValue || entry.retired) continue
      if (!text.includes(entry.phrase)) continue
      entry.uses += 1
      entry.lastUsedAt = at
      entry.updatedAt = at
      used.push(entry.phrase)
    }
    if (used.length > 0) scheduleSave()
    return used
  }

  /**
   * 别人说了什么：如果 24 小时内她刚用过某个梗，而这句话里又出现了，
   * 就算「被接住」；如果同时是在问意思，就算「被反问」。
   */
  function observeReply(scope, text, at = now()) {
    const cleanScopeValue = cleanScope(scope)
    if (cleanScopeValue === '' || typeof text !== 'string' || text === '') return []
    const asked = ASK_BACK.test(text)
    const hits = []
    for (const entry of entries.values()) {
      if (entry.scope !== cleanScopeValue) continue
      if (!text.includes(entry.phrase)) continue
      const recent = entry.lastUsedAt > 0 && at - entry.lastUsedAt <= RECENT_USE_MS
      if (!recent) continue
      if (asked) entry.askedBack += 1
      else entry.pickedUp += 1
      // 被反问两次还没人接，退役：以后不再主动给模型。
      if (entry.askedBack >= 2 && entry.pickedUp === 0) entry.retired = true
      entry.updatedAt = at
      hits.push(entry.phrase)
    }
    if (hits.length > 0) scheduleSave()
    return hits
  }

  /** 可用度。没被用过的条目给一个中性分，让模型先试一次。 */
  function scoreOf(entry) {
    if (entry.retired) return 0
    const attempts = entry.uses + entry.askedBack * 2
    const base = attempts === 0 ? 0.5 : (entry.pickedUp + 1) / (attempts + 1)
    const freshness = Math.max(0, 1 - (now() - (entry.lastSeenAt || entry.updatedAt)) / (STALE_DAYS * 86_400_000))
    return Math.round((base * 0.8 + freshness * 0.2) * 1000) / 1000
  }

  /** 给模型看：只返回还在用、且确实在群里出现过的。 */
  function digest(scope, limit = 3) {
    const cleanScopeValue = cleanScope(scope)
    if (cleanScopeValue === '') return []
    return [...entries.values()]
      .filter((entry) => entry.scope === cleanScopeValue && !entry.retired && entry.seen >= 3)
      .map((entry) => ({ ...entry, score: scoreOf(entry) }))
      .sort((a, b) => b.score - a.score || b.seen - a.seen)
      .slice(0, Math.max(1, limit))
      .map((entry) => ({
        phrase: entry.phrase,
        score: entry.score,
        seen: entry.seen,
        uses: entry.uses,
        pickedUp: entry.pickedUp,
        askedBack: entry.askedBack
      }))
  }

  function get(scope, phrase) {
    return entries.get(keyOf(cleanScope(scope), cleanPhrase(phrase))) ?? null
  }

  function snapshot(scope) {
    const list = [...entries.values()].filter((entry) => scope === undefined || entry.scope === cleanScope(scope))
    return { total: list.length, entries: list.map((entry) => ({ ...entry })) }
  }

  async function reset() {
    entries = new Map()
    await flush()
    return snapshot()
  }

  return { load, observe, markUsed, observeReply, digest, get, snapshot, flush, reset, toJSON: () => snapshot() }
}
