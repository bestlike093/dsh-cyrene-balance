/**
 * 主动开口前的闸门：安静时段、每日上限、连续没回应就停。
 *
 * 纯函数 + 一个小状态机，不碰窗口、不读文件，方便单测。
 * 三条规则的优先级：安静时段 > 沉默放弃 > 每日上限。
 * 安静时段对手动触发同样生效；另外两条只拦自动开口。
 */

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
    const presence = settings?.presence ?? {}

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
      const days = (nowDate.getTime() - lastContactAt.getTime()) / 86400000
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
