/**
 * DailyBudgetGate：按本地自然日累计的消费额度。
 *
 * 与 TokenBucket 分工不同：
 * - TokenBucket 管「短时间内的速率」，防止瞬时把 provider 打爆；
 * - 这里管「一天总共能花多少」，防止长时间缓慢烧穿余额。
 *
 * 跨日按本地日期键滚动，而不是固定 24 小时：用户理解的「今天」是日历上的今天。
 */

function clampRatio(value) {
  if (!Number.isFinite(value) || value <= 0) return 0.8
  return Math.min(1, value)
}

function normalizeAmount(value) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value
}

/** 本地日期键 YYYY-MM-DD。用本地时区，跨日点与用户直觉一致。 */
export function localDayKey(at) {
  const date = new Date(at)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 每日额度闸门。
 *
 * `canSpend` 不扣减，允许同一轮里多次预检；真正的扣减只发生在 `record`。
 */
export class DailyBudgetGate {
  constructor(options = {}) {
    this.dailyLimit = Math.max(0, Number.isFinite(options.dailyLimit) ? options.dailyLimit : 0)
    this.warnRatio = clampRatio(options.warnRatio ?? 0.8)
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.dayKeyValue = options.initialDayKey ?? localDayKey(this.now())
    this.usedValue = normalizeAmount(options.initialUsed ?? 0)
    this.rollIfNeeded()
  }

  get limit() {
    return this.dailyLimit
  }

  get used() {
    this.rollIfNeeded()
    return this.usedValue
  }

  get dayKey() {
    this.rollIfNeeded()
    return this.dayKeyValue
  }

  /** 预检：估计要花 estimated 时还能不能继续。不扣减。 */
  canSpend(estimated = 0) {
    this.rollIfNeeded()

    if (this.dailyLimit === 0) {
      return { allowed: true, remaining: Number.POSITIVE_INFINITY }
    }

    const amount = normalizeAmount(estimated)
    const remaining = Math.max(0, this.dailyLimit - this.usedValue)

    /* 额度恰好用完也算耗尽：此时再发起任何请求都不该放行。 */
    if (this.usedValue >= this.dailyLimit || this.usedValue + amount > this.dailyLimit) {
      return {
        allowed: false,
        reason: 'limit-reached',
        used: this.usedValue,
        limit: this.dailyLimit
      }
    }

    return { allowed: true, remaining: remaining - amount }
  }

  /**
   * 事后结算实际用量。
   *
   * 超额也照实记账，不夹到上限：看板需要知道「超了多少」。
   */
  record(amount) {
    this.rollIfNeeded()

    const normalized = normalizeAmount(amount)
    if (normalized > 0) this.usedValue += normalized

    return this.status()
  }

  status() {
    this.rollIfNeeded()

    const limit = this.dailyLimit
    const ratio = limit === 0 ? 0 : this.usedValue / limit

    const level =
      limit === 0 ? 'ok' : this.usedValue >= limit ? 'exhausted' : ratio >= this.warnRatio ? 'warn' : 'ok'

    return {
      dayKey: this.dayKeyValue,
      used: this.usedValue,
      limit,
      remaining: limit === 0 ? Number.POSITIVE_INFINITY : Math.max(0, limit - this.usedValue),
      ratio: Math.round(ratio * 1000) / 1000,
      level
    }
  }

  serialize() {
    this.rollIfNeeded()
    return { dayKey: this.dayKeyValue, used: this.usedValue }
  }

  /** 恢复：跨了日就在构造时清空，没跨日就接着累计。 */
  static restore(options, state) {
    return new DailyBudgetGate({
      ...options,
      initialDayKey: state.dayKey,
      initialUsed: state.used
    })
  }

  /** 只有日期键变化才清零；同一天内多次调用无副作用。 */
  rollIfNeeded() {
    const today = localDayKey(this.now())
    if (today === this.dayKeyValue) return

    this.dayKeyValue = today
    this.usedValue = 0
  }
}
