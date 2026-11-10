/**
 * 把「余额」和「电脑状态」写成一句能直接放进提示词的生活话。
 *
 * 只做纯函数：数据缺失就不猜，采样过期就当没看到。
 * 提示词里出现的是「她恰好注意到的事」，不是监控面板，所以不写字段名、不列指标。
 */

/** 采样超过这个时间就当没看到：HUD 关掉后快照会停在最后一拍。 */
export const STALE_MS = 120_000

/** 低电量：只在明确没插电时提，正在充电或状态未知都不催。 */
const LOW_BATTERY_PERCENT = 20

/** 内存快满：到这个比例才提一句。 */
const HIGH_MEMORY_PERCENT = 90

function formatYuan(value) {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

/**
 * 余额：低于提醒线时提醒一句「别撺掇对方乱花钱」，正常时只给事实。
 * amount 不是有限数或为负时返回空串，宁可少一句也不编数字。
 */
export function describeBalance(balance) {
  if (balance === null || typeof balance !== 'object') return ''
  const amount = Number(balance.amount)
  if (!Number.isFinite(amount) || amount < 0) return ''

  const threshold = Number(balance.threshold)
  if (Number.isFinite(threshold) && threshold > 0 && amount < threshold) {
    return `账户额度只剩 ${formatYuan(amount)} 元，已经低于 ${formatYuan(threshold)} 元的提醒线；别撺掇对方乱花钱。`
  }
  return `账户里还剩 ${formatYuan(amount)} 元额度。`
}

/**
 * 电脑状态：只提两件会影响当下的事——快没电了、内存快满了。
 * CPU 单拍噪声太大，不在这里报。
 */
export function describeSystem(system, now = Date.now()) {
  if (system === null || typeof system !== 'object') return ''
  const sampledAt = Number(system.sampledAt)
  if (!Number.isFinite(sampledAt) || sampledAt <= 0) return ''
  if (now - sampledAt > STALE_MS) return ''

  const notes = []
  const percent = Number(system.battery?.percent)
  if (Number.isFinite(percent) && percent <= LOW_BATTERY_PERCENT && system.battery?.charging === false) {
    notes.push(`电脑电量只剩 ${Math.round(percent)}%，还没插电。`)
  }

  const memoryPercent = Number(system.memory?.percent)
  if (Number.isFinite(memoryPercent) && memoryPercent >= HIGH_MEMORY_PERCENT) {
    notes.push(`电脑内存已经用到 ${Math.round(memoryPercent)}%，开着的东西有点多。`)
  }

  return notes.join('')
}

/** 两段拼成一句连续的背景；都没有就返回空串。 */
export function describeEnvironment({ balance = null, system = null, now = Date.now() } = {}) {
  return [describeBalance(balance), describeSystem(system, now)]
    .filter((part) => part !== '')
    .join('')
}
