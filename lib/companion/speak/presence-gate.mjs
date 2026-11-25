/**
 * 主动开口前的闸门：安静时段、每日上限、连续没回应就停。
 *
 * 纯函数 + 一个小状态机，不碰窗口、不读文件，方便单测。
 * 三条规则的优先级：安静时段 > 沉默放弃 > 每日上限。
 * 安静时段对手动触发同样生效；另外两条只拦自动开口。
 */

import { TIME } from '../standard.mjs'

export const DEFAULT_QUIET = { enabled: true, start: '23:00', end: '08:00' }
export const DEFAULT_DAILY_CAP = 6
export const DEFAULT_SILENCE_DAYS = 3

/** "23:00" → 1380；格式不合法返回 null。 */
export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

/** 本地日期键，用来判断「今天」有没有翻页。 */
export function dayKey(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 此刻是否在安静时段内。
 * 支持跨午夜（23:00–07:00）；起止相同视为没设，直接放行。
 */
export function inQuietHours(now = new Date(), quiet = DEFAULT_QUIET) {
  if (quiet === null || quiet?.enabled === false) return false
  const start = parseClock(quiet?.start ?? quiet?.from) ?? parseClock(DEFAULT_QUIET.start)
  const end = parseClock(quiet?.end ?? quiet?.to) ?? parseClock(DEFAULT_QUIET.end)
  if (start === null || end === null || start === end) return false
  const current = now.getHours() * 60 + now.getMinutes()
  return start < end
    ? current >= start && current < end
    : current >= start || current < end
}

/**
 * 设置页的「夜间不扰」用的是 from/to，闸门内部统一成 start/end。
 *
 * 它是唯一的时段来源：调度层和闸门读同一份设置，改了立刻一致。
 */
export function quietWindow(presence = {}) {
  const quiet = presence?.quiet
  if (quiet === null || typeof quiet !== 'object') {
    return { ...DEFAULT_QUIET, mode: 'urgentOnly' }
  }
  return {
    enabled: quiet.enabled !== false,
    start: typeof quiet.from === 'string' ? quiet.from : DEFAULT_QUIET.start,
    end: typeof quiet.to === 'string' ? quiet.to : DEFAULT_QUIET.end,
    mode: typeof quiet.mode === 'string' ? quiet.mode : 'urgentOnly'
  }
}

/**
 * 宿主侧组装 settings.presence：state 那份 + 设置文件那一份，合成闸门认的形状。
 *
 * A2-010：这一段原先写在 lib/index.js 的 getSettings() 里，是个 5 键字面量，
 * 只认 state.presence，从不看 settings.json。而 intimacy 有 readPetIntimacy()
 * 专门去读文件，presence 没有对应的一手 —— 于是设置里写了 quiet / dailyCap /
 * silenceDays / useWeather，闸门永远收不到，改了不随动（假旋钮）。
 *
 * 先原样搬出来（还没接文件段），语义跟 index.js 那几个键一字不差：
 * 空字符串在这里不补默认城市，回落交给运行时；autoLocate 只认严格 true；
 * locatedAt 拿不到数就当 0（从没探过）。
 */
export function hostPresenceView({ statePresence = {}, fileSettings = null } = {}) {
  const state = statePresence !== null && typeof statePresence === 'object' ? statePresence : {}
  const view = {
    city: typeof state.city === 'string' ? state.city : '',
    ownerCity: typeof state.ownerCity === 'string' ? state.ownerCity : '',
    autoLocate: state.autoLocate === true,
    /* 外壳独占字段：core 只存不探测，当前无外壳写入方。 */
    autoLocatedCity: typeof state.autoLocatedCity === 'string' ? state.autoLocatedCity : '',
    locatedAt: Number(state.locatedAt) || 0
  }

  /*
   * 文件段怎么认，直接套闸门自己那套 presenceSettingsOf —— 嵌套与 schema 展平两种写法
   * 它都已经认了，宿主这边再抄一遍就是第三份形状（D2 那格的教训：认形状的口只留一个）。
   * 上面那五个键仍然以 state 为准：city 类归外壳写，文件里塞什么都不许盖过它。
   */
  const fromFile = presenceSettingsOf(fileSettings !== null && typeof fileSettings === 'object' ? fileSettings : {})

  const quiet = fromFile.quiet
  if (quiet !== null && typeof quiet === 'object') {
    const picked = {}
    if (typeof quiet.enabled === 'boolean') picked.enabled = quiet.enabled
    for (const key of ['from', 'to', 'start', 'end']) {
      if (typeof quiet[key] === 'string' && quiet[key].trim() !== '') picked[key] = quiet[key]
    }
    if (typeof quiet.mode === 'string' && quiet.mode.trim() !== '') picked.mode = quiet.mode
    if (Object.keys(picked).length > 0) view.quiet = picked
  }

  /* 数值类只交有限非负数；脏值一律不接管，让闸门继续用它自己的默认。 */
  for (const key of ['dailyCap', 'silenceDays', 'intervalMinutes']) {
    const raw = fromFile[key]
    if (raw === null || raw === undefined || raw === '') continue
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 0) view[key] = Math.floor(value)
  }

  /* 天气这条只认真 false：默认是开，写歪了不许把它弄没。 */
  const nestedWeather = fromFile.useWeather
  const flatWeather = fileSettings?.['presence.useWeather']
  if (nestedWeather === false || flatWeather === false) view.useWeather = false

  return view
}

/**
 * 设置里的 presence 段可能是嵌套对象，也可能是 schema 展平后的点号键。
 * 两个来源都认，避免「设置页改了、闸门读不到」这种假旋钮。
 */
export function presenceSettingsOf(settings = {}) {
  const nested = settings?.presence
  const base = nested !== null && typeof nested === 'object' ? nested : {}
  const flat = (path) => settings?.[`presence.${path}`]

  const nestedQuiet = base.quiet !== null && typeof base.quiet === 'object' ? base.quiet : null
  const hasFlatQuiet =
    flat('quiet.enabled') !== undefined ||
    flat('quiet.from') !== undefined ||
    flat('quiet.to') !== undefined ||
    flat('quiet.mode') !== undefined
  const quiet = nestedQuiet ?? (hasFlatQuiet
    ? {
        enabled: flat('quiet.enabled'),
        from: flat('quiet.from'),
        to: flat('quiet.to'),
        mode: flat('quiet.mode'),
      }
    : undefined)

  const numberOr = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== ''
    ? Number(value)
    : fallback)

  return {
    ...base,
    quiet,
    dailyCap: numberOr(base.dailyCap ?? flat('dailyCap'), undefined),
    silenceDays: numberOr(base.silenceDays ?? flat('silenceDays'), undefined),
    intervalMinutes: numberOr(base.intervalMinutes ?? flat('intervalMinutes'), undefined),
  }
}

export function createPresenceGate({ now = () => new Date(), initial = null } = {}) {
  // 从上一轮运行接过来的账。日期不是今天时，第一次 rollDay 会自然清零。
  let today = typeof initial?.day === 'string' ? initial.day : ''
  let spokenToday =
    Number.isFinite(initial?.spokenToday) && initial.spokenToday > 0
      ? Math.floor(initial.spokenToday)
      : 0

  function rollDay(nowDate) {
    const key = dayKey(nowDate)
    if (key === today) return
    today = key
    spokenToday = 0
  }

  /**
   * 该不该让她现在开口。
   *
   * @param {object} input
   * @param {object} input.settings 完整设置（只读 presence 段）
   * @param {string} input.reason auto / loop / manual / wake
   * @param {Date|null} input.lastContactAt 上次真正说话的时间
   * @returns {{ok:boolean, reason:string, detail:string}}
   */
  function check({ settings = {}, reason = 'auto', lastContactAt = null } = {}) {
    const nowDate = now()
    rollDay(nowDate)
    const presence = presenceSettingsOf(settings)

    // 时段只认设置页的「夜间不扰」；降频模式仍要说话，间隔由调度层拉长。
    const quiet = quietWindow(presence)
    if (quiet.mode !== 'reduce' && inQuietHours(nowDate, quiet)) {
      return { ok: false, reason: 'quiet-hours', detail: '这个点她已经休息了' }
    }

    // 手动点她，是想现在听一句，不按「她该不该主动」那套算。
    if (reason === 'manual') return { ok: true, reason: 'ok', detail: '' }

    const silenceDays = Number.isFinite(presence.silenceDays)
      ? presence.silenceDays
      : DEFAULT_SILENCE_DAYS
    if (lastContactAt instanceof Date && silenceDays > 0) {
      const days = (nowDate.getTime() - lastContactAt.getTime()) / TIME.DAY
      if (days >= silenceDays) {
        return {
          ok: false,
          reason: 'silent-away',
          detail: `已经 ${Math.floor(days)} 天没说话了，等她先开口`
        }
      }
    }

    const cap = Number.isFinite(presence.dailyCap) ? presence.dailyCap : DEFAULT_DAILY_CAP
    if (cap > 0 && spokenToday >= cap) {
      return { ok: false, reason: 'daily-cap', detail: `今天已经开口 ${spokenToday} 次` }
    }

    return { ok: true, reason: 'ok', detail: '' }
  }

  function noteSpoken() {
    rollDay(now())
    spokenToday += 1
  }

  function snapshot() {
    rollDay(now())
    return { day: today, spokenToday }
  }

  return { check, noteSpoken, snapshot }
}
