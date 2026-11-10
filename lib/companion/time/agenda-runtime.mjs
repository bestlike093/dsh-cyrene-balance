/**
 * 日程的运行时状态：她正在陪你，原计划先放一会儿。
 *
 * 节目单本身不变，这里只记「当前段被临时打断到什么时候」。
 * 三条分寸：
 * - 打断有上限，最长 30 分钟，到点自动回到日程；
 * - 只对当天有效，跨天自动清空；
 * - 只影响「她现在在做什么」的说法，不阻止回复，也不改节目单结构。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const SCHEMA_VERSION = 2
const SAVE_DEBOUNCE_MS = 1_000

export const DEFAULT_SUSPEND_LIMITS = {
  /** 单次默认陪 10 分钟。 */
  defaultMs: 10 * 60 * 1000,
  /** 一次打断最多 30 分钟，不能无限续。 */
  maxMs: 30 * 60 * 1000,
  /** 最短 1 分钟，避免误触后立刻恢复。 */
  minMs: 60 * 1000
}

function asText(value, max = 120) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, max)
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

/** 现状日界：本地时间。要换成人格时区由外壳显式注入，本文件不设统一默认。 */
function localDateKey(now) {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function freshState() {
  return {
    date: '',
    segmentId: '',
    title: '',
    reason: '',
    // sleep 单独标出来：睡觉被打断和「先停一下做别的事」不是同一种状态。
    kind: '',
    startedAt: 0,
    until: 0
  }
}

function readState(value) {
  if (value === null || typeof value !== 'object') return freshState()
  return {
    date: asText(value.date, 20),
    segmentId: asText(value.segmentId, 60),
    title: asText(value.title, 60),
    reason: asText(value.reason, 60),
    kind: asText(value.kind, 20),
    startedAt: Math.max(0, asNumber(value.startedAt, 0)),
    until: Math.max(0, asNumber(value.until, 0))
  }
}

export function createAgendaRuntime({ file = null, now = Date.now, log = () => {}, dateKeyOf = localDateKey } = {}) {
  let state = freshState()
  let loaded = false
  let loading = null
  let saveTimer = null
  let needsBackup = false
  // 最近一次读盘失败（非 ENOENT）的原因；坏文件隔离成功前禁止写盘，
  // 否则会用内存里的空状态把原文件整个覆盖掉。
  let loadError = null

  async function ready() {
    if (loaded) return snapshot()
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (file !== null) {
          const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
          if (parsed !== null && typeof parsed === 'object') {
            const version = Number(parsed.schemaVersion)
            if (!Number.isFinite(version) || version < SCHEMA_VERSION) needsBackup = true
            state = readState(parsed.state ?? parsed)
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
          // 坏文件在写盘前会被先隔离，而不是被空状态覆盖。
          loadError = error
          loaded = false
          log('日程状态读取失败，等待重试', error)
        }
      } finally {
        loading = null
      }
      return snapshot()
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
      await fs.mkdir(path.dirname(file), { recursive: true })
      // 读盘失败过的坏文件不能直接覆盖：先改名隔离，改不了名就这次不写。
      if (loadError !== null) {
        try {
          await fs.rename(file, `${file}.corrupt-${Date.now()}`)
          loadError = null
        } catch (error) {
          if (error?.code === 'ENOENT') {
            // 文件已经不在了，没有可覆盖的坏文件，放行这次写入。
            loadError = null
          } else {
            log('日程状态坏文件隔离失败，本次跳过写入', error)
            return
          }
        }
      }
      if (needsBackup) {
        try {
          await fs.copyFile(file, `${file}.bak`)
        } catch (error) {
          if (error?.code !== 'ENOENT') log('日程状态迁移备份失败，继续写入', error)
        }
      }
      // 先写临时文件再 rename：写到一半进程退出，最多留下 .tmp，
      // 不会把正式文件截成半截 JSON。
      const tmp = `${file}.tmp`
      await fs.writeFile(
        tmp,
        JSON.stringify({ schemaVersion: SCHEMA_VERSION, state }),
        'utf8'
      )
      await fs.rename(tmp, file)
      needsBackup = false
    } catch (error) {
      log('日程状态写入失败', error)
    }
  }

  async function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await persist()
  }

  /** 跨天或到点就自动清空，读的时候顺手做，不依赖定时器。 */
  function normalize() {
    const at = now()
    if (state.until > 0 && state.until <= at) {
      state = freshState()
      scheduleSave()
      return
    }
    if (state.date !== '' && state.date !== dateKeyOf(at)) {
      state = freshState()
      scheduleSave()
    }
  }

  /**
   * 开始陪对方一段时间。重复调用会续期，但不会超过从首次开始算的 30 分钟。
   */
  function suspend({
    date = dateKeyOf(now()),
    segmentId = '',
    title = '',
    reason = 'chat',
    kind = '',
    minutes
  } = {}) {
    normalize()
    const at = now()
    const limits = DEFAULT_SUSPEND_LIMITS
    // 先转数值，让 "30" 这类字符串输入也能生效；转不出有限数才回落默认，
    // 最后统一夹到 [minMs, maxMs]，避免 0 或超大值溜进状态。
    const parsedMinutes = Number(minutes)
    const requested = Number.isFinite(parsedMinutes)
      ? Math.round(parsedMinutes) * 60 * 1000
      : limits.defaultMs
    const span = Math.min(limits.maxMs, Math.max(limits.minMs, requested))

    const sameSession = state.startedAt > 0 && state.date === dateKeyOf(at)
    const startedAt = sameSession ? state.startedAt : at
    // 续期从首次打断算，不能被反复延长成一整天。
    const until = Math.min(startedAt + limits.maxMs, at + span)

    state = {
      date: asText(date, 20) || dateKeyOf(at),
      segmentId: asText(segmentId, 60),
      title: asText(title, 60),
      reason: asText(reason, 60),
      kind: asText(kind, 20),
      startedAt,
      until
    }
    scheduleSave()
    return snapshot()
  }

  function resume() {
    if (state.until > 0 || state.date !== '') {
      state = freshState()
      scheduleSave()
    }
    return snapshot()
  }

  /** 当前是否在陪对方；到点会自动变回 false。 */
  function isSuspended() {
    normalize()
    return state.until > now() && state.date !== ''
  }

  function snapshot() {
    normalize()
    const at = now()
    const suspended = state.until > at && state.date !== ''
    return {
      suspended,
      // 睡眠被打断仍然算挂起，但单独给一个标记：界面和提示词都不能再说成「先停一下」。
      interrupted: suspended && state.kind === 'sleep',
      kind: state.kind,
      date: state.date,
      segmentId: state.segmentId,
      title: state.title,
      reason: state.reason,
      startedAt: state.startedAt,
      until: state.until,
      remainingMs: suspended ? Math.max(0, state.until - at) : 0
    }
  }

  return {
    ready,
    suspend,
    resume,
    isSuspended,
    snapshot,
    flush,
    toJSON: () => ({ schemaVersion: SCHEMA_VERSION, state })
  }
}
