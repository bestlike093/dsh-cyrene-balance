/**
 * 群聊格式画像的落盘层。
 *
 * 只存统计结果，不存原文：样本从网关内存来，算出平均值、比例、连发分布后
 * 立刻丢掉原句。这样重启后画像还在，但聊天内容不会因此多出一份副本。
 *
 * 两个来源合并时按「样本数 × 7 天时间衰减」加权；旧画像放久了会自动变轻，
 * 不会让一个半年前的群一直用当时的腔调说话。
 */
import fs from 'node:fs/promises'

const VERSION = 1
const DEFAULT_MAX_SCOPES = 200
const DECAY_DAYS = 7
const SAVE_DEBOUNCE_MS = 1000

/** 允许落盘的字段；白名单之外的东西一律不写，避免误存原文。 */
const STAT_KEYS = ['avgLength', 'shortRatio', 'emojiRatio', 'punctuationRatio', 'mentionRatio', 'imageRatio', 'avgGapSeconds']
const RATIO_KEYS = new Set(['shortRatio', 'emojiRatio', 'punctuationRatio', 'mentionRatio', 'imageRatio'])

function asNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clampRatio(value) {
  return Math.min(1, Math.max(0, asNumber(value)))
}

function cleanPhrases(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item.phrase === 'string' && item.phrase.trim() !== '')
    .slice(0, 6)
    .map((item) => ({
      phrase: item.phrase.trim().slice(0, 8),
      count: Math.max(0, Math.floor(asNumber(item.count)))
    }))
}

function cleanWords(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item !== '').slice(0, 4).map((item) => item.slice(0, 8))
}

/** 只留白名单字段，顺便把范围钳住。 */
export function sanitizeStats(stats) {
  if (stats === null || typeof stats !== 'object') return null
  const result = {
    sampleSize: Math.max(0, Math.floor(asNumber(stats.sampleSize))),
    avgLength: Math.max(0, Math.round(asNumber(stats.avgLength) * 10) / 10),
    burst: {
      one: clampRatio(stats.burst?.one),
      two: clampRatio(stats.burst?.two),
      threePlus: clampRatio(stats.burst?.threePlus),
      avg: Math.max(0, Math.round(asNumber(stats.burst?.avg, 1) * 10) / 10)
    },
    particles: cleanWords(stats.particles),
    frequentPhrases: cleanPhrases(stats.frequentPhrases),
    openers: cleanWords(stats.openers),
    closers: cleanWords(stats.closers)
  }
  for (const key of STAT_KEYS) {
    result[key] = RATIO_KEYS.has(key) ? clampRatio(stats[key]) : Math.max(0, asNumber(stats[key]))
  }
  return result
}

/**
 * @param {object} options
 * @param {string} options.filePath
 * @param {() => number} [options.now]
 * @param {(message: string, error?: unknown) => void} [options.log]
 * @param {number} [options.maxScopes]
 */
export function createSocialProfileStore(options = {}) {
  const {
    filePath,
    now = Date.now,
    log = () => {},
    maxScopes = DEFAULT_MAX_SCOPES
  } = options

  /** @type {Map<string, {stats: object, updatedAt: number, samples: number}>} */
  let profiles = new Map()
  let loaded = false
  let loading = null
  let saveTimer = null
  let writeChain = Promise.resolve(true)

  async function load() {
    if (loaded) return { ok: true, count: profiles.size }
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
        const list = Array.isArray(parsed?.profiles) ? parsed.profiles : []
        profiles = new Map()
        for (const item of list) {
          if (item === null || typeof item !== 'object') continue
          const scope = typeof item.scope === 'string' ? item.scope.trim().slice(0, 120) : ''
          if (scope === '') continue
          const stats = sanitizeStats(item.stats)
          if (stats === null || stats.sampleSize <= 0) continue
          profiles.set(scope, {
            stats,
            updatedAt: asNumber(item.updatedAt, 0),
            samples: Math.max(1, Math.floor(asNumber(item.samples, stats.sampleSize)))
          })
        }
        return { ok: true, count: profiles.size }
      } catch (error) {
        log('群聊画像读取失败，按空画像继续', error)
        profiles = new Map()
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
        const list = [...profiles.entries()]
          .map(([scope, value]) => ({ scope, updatedAt: value.updatedAt, samples: value.samples, stats: value.stats }))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, maxScopes)
        const temp = `${filePath}.tmp`
        await fs.mkdir(filePath.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
        await fs.writeFile(temp, JSON.stringify({ version: VERSION, profiles: list }), 'utf8')
        await fs.rename(temp, filePath)
        return true
      } catch (error) {
        log('群聊画像写入失败', error)
        return false
      }
    })
    return writeChain
  }

  /** 旧画像按 7 天半衰期变轻；放太久的直接让新样本说话。 */
  function weightOf(entry, at) {
    if (entry === undefined) return 0
    const days = Math.max(0, (at - entry.updatedAt) / 86_400_000)
    return entry.samples * Math.exp(-days / DECAY_DAYS)
  }

  function mergeStats(oldStats, fresh, oldWeight, freshWeight) {
    const result = sanitizeStats(fresh)
    if (oldStats === null || oldWeight <= 0.5) return result
    const total = oldWeight + freshWeight
    for (const key of STAT_KEYS) {
      result[key] = Math.round(((asNumber(oldStats[key]) * oldWeight + asNumber(fresh[key]) * freshWeight) / total) * 100) / 100
    }
    for (const key of ['one', 'two', 'threePlus']) {
      result.burst[key] =
        Math.round(((asNumber(oldStats.burst?.[key]) * oldWeight + asNumber(fresh.burst?.[key]) * freshWeight) / total) * 100) /
        100
    }
    result.burst.avg =
      Math.round(((asNumber(oldStats.burst?.avg, 1) * oldWeight + asNumber(fresh.burst?.avg, 1) * freshWeight) / total) * 10) / 10
    return result
  }

  /**
   * 记一份新统计。返回合并后的画像（可直接给 describeStyle）。
   * 样本太少（< 6）时不落盘，避免把两句玩笑当成群风格。
   */
  function remember(scope, stats) {
    const key = typeof scope === 'string' ? scope.trim().slice(0, 120) : ''
    const fresh = sanitizeStats(stats)
    if (key === '' || fresh === null || fresh.sampleSize < 6) return null
    const at = now()
    const previous = profiles.get(key)
    const oldWeight = weightOf(previous, at)
    const merged = mergeStats(previous?.stats ?? null, fresh, oldWeight, fresh.sampleSize)
    profiles.set(key, { stats: merged, updatedAt: at, samples: fresh.sampleSize })
    scheduleSave()
    return { ...merged, updatedAt: at, samples: fresh.sampleSize }
  }

  function get(scope) {
    const entry = profiles.get(typeof scope === 'string' ? scope.trim() : '')
    if (entry === undefined) return null
    return { ...entry.stats, updatedAt: entry.updatedAt, samples: entry.samples }
  }

  function snapshot() {
    return {
      total: profiles.size,
      profiles: [...profiles.entries()].map(([scope, value]) => ({
        scope,
        updatedAt: value.updatedAt,
        samples: value.samples,
        stats: { ...value.stats }
      }))
    }
  }

  async function reset() {
    profiles = new Map()
    await flush()
    return snapshot()
  }

  return { load, remember, get, snapshot, flush, reset, toJSON: () => snapshot() }
}
