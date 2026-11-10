/**
 * 主动开口前的闸门：安静时段、每日上限、连续没回应就停。
 *
 * 纯函数 + 一个小状态机，不碰窗口、不读文件，方便单测。
 * 三条规则的优先级：安静时段 > 沉默放弃 > 每日上限。
 * 手动触发（单击立绘 / 设置页「试一句」）不受安静时段约束——
 * 那是用户现在想听一句，不是「她该不该主动」；另外两条也只拦自动开口。
 */

export const DEFAULT_QUIET = { enabled: true, start: '23:00', end: '08:00' }
export const DEFAULT_DAILY_CAP = 6
export const DEFAULT_SILENCE_DAYS = 3

/** "23:00" / "23" / "8" → 分钟数；格式不合法返回 null。 */
export function parseClock(text) {
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(text ?? '').trim())
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = match[2] === undefined ? 0 : Number(match[2])
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
  // 落盘里混进未来日期也不怕：第一次 rollDay 就会把它校正成真实的今天。
  const initialDay = typeof initial?.day === 'string' ? initial.day : ''
  const realToday = dayKey(now())
  let today = initialDay !== '' && initialDay <= realToday ? initialDay : realToday
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
   * @param {Date|string|null} input.lastContactAt 上次真正说话的时间
   * @returns {{ok:boolean, reason:string, detail:string}}
   */
  function check({ settings = {}, reason = 'auto', lastContactAt = null } = {}) {
    const nowDate = now()
    rollDay(nowDate)
    const presence = settings?.presence ?? {}

    // 手动点她（单击立绘 manual / 设置页「试一句」preview），是想现在听一句，
    // 不按「她该不该主动」那套算。夜里点「试一句」也该有回应。
    if (reason === 'manual' || reason === 'preview') return { ok: true, reason: 'ok', detail: '' }

    // 时段只认设置页的「夜间不扰」；降频模式仍要说话，间隔由调度层拉长。
    const quiet = quietWindow(presence)
    if (quiet.mode !== 'reduce' && inQuietHours(nowDate, quiet)) {
      return { ok: false, reason: 'quiet-hours', detail: '这个点她已经休息了' }
    }

    const silenceDays = Number.isFinite(presence.silenceDays)
      ? presence.silenceDays
      : DEFAULT_SILENCE_DAYS
    // 兼容 Date 与 ISO 字符串：落盘读回来的常见形态不该让沉默放弃静默失效。
    const lastContact =
      lastContactAt instanceof Date
        ? lastContactAt
        : typeof lastContactAt === 'string' && lastContactAt.trim() !== ''
          ? new Date(Date.parse(lastContactAt))
          : null
    if (lastContact !== null && Number.isFinite(lastContact.getTime()) && silenceDays > 0) {
      const days = (nowDate.getTime() - lastContact.getTime()) / 86400000
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

  /**
   * 检查并立刻占住名额（同一同步调用内完成，检查与计数之间没有 await，
   * 并发入口无法同时通过）。手动 / 试一句 / 兜底句不占名额。
   * 占住之后这一轮如果最终没说话（模型失败退兜底），调用方用 release() 退还。
   */
  function claim(input = {}) {
    const verdict = check(input)
    if (verdict.ok !== true) return { ...verdict, claimed: false }
    const reason = String(input.reason ?? 'auto')
    if (reason !== 'manual' && reason !== 'preview' && reason !== 'fallback') {
      noteSpoken()
      return { ...verdict, claimed: true }
    }
    return { ...verdict, claimed: false }
  }

  /** 退还一次刚占住的名额；只会在 claim 成功后被调用，不会减成负数。 */
  function release() {
    rollDay(now())
    spokenToday = Math.max(0, spokenToday - 1)
  }

  function snapshot() {
    rollDay(now())
    return { day: today, spokenToday }
  }

  return { check, noteSpoken, claim, release, snapshot }
}
