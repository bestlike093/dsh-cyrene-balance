/**
 * 每日 token 额度：把 core 的 DailyBudgetGate 接到真实模型调用上。
 *
 * 预检在发请求之前（不扣减），结算在拿到 usage 之后（按真实用量记账）。
 * 额度为 0 表示不限，和设置页的文案保持一致。
 *
 * 记账状态只包含「今天用了多少」，属于低敏计数；默认放内存，跨重启会清零，
 * 由调用方注入 readState / writeState 才会落盘。
 */

import { DailyBudgetGate } from '@pet/core/browser'

const DEFAULT_WARN_RATIO = 0.8

function readBudgetSettings(getSettings, log = () => {}) {
  let settings
  try {
    settings = getSettings()
  } catch (error) {
    // 读配置失败按「额度未启用」放行，但必须留日志可查，不能无声吞掉。
    log('额度配置读取失败，按未启用处理', error)
    settings = null
  }
  const raw = settings?.companion?.care?.dailyTokenBudget
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  const limit = Number.isFinite(Number(value.limit)) ? Math.max(0, Math.floor(Number(value.limit))) : 0
  const warnRatio = Number.isFinite(Number(value.warnRatio))
    ? Math.min(1, Math.max(0, Number(value.warnRatio)))
    : DEFAULT_WARN_RATIO
  // 兼容设置里写成 1 / 'true' / '1' 的真值形态，别只有严格 === true 才认。
  const enabledValue =
    value.enabled === true || value.enabled === 1 || value.enabled === 'true' || value.enabled === '1'
  return {
    enabled: enabledValue && limit > 0,
    limit,
    warnRatio
  }
}

function normalizeAmount(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.round(number)
}

export function createDailyBudget(options = {}) {
  const {
    getSettings = () => ({}),
    now = Date.now,
    readState = null,
    writeState = null,
    log = () => {}
  } = options

  let gate = null
  let signature = ''
  let lastState = null
  /** 读状态失败标记：置位后禁止写盘，避免用归零状态覆盖当天的真实用量。 */
  let degraded = false

  function gateOptions(config) {
    return { dailyLimit: config.limit, warnRatio: config.warnRatio, now }
  }

  function current() {
    const config = readBudgetSettings(getSettings, log)
    const nextSignature = `${config.limit}:${config.warnRatio}`
    // degraded 时每次调用都重试读状态：读成功就解除降级，别一直停在「不落盘」。
    if (gate === null || nextSignature !== signature || degraded) {
      let restored = lastState
      if (typeof readState === 'function') {
        try {
          restored = readState()
          degraded = false
        } catch (error) {
          // 读不出当天的真实用量：不重建归零状态写盘，宁可这轮少记也不覆盖。
          log('额度状态读取失败，本次会话暂停落盘', error)
          degraded = true
          restored = lastState
        }
      }
      try {
        gate =
          restored !== null && typeof restored === 'object' && typeof restored.dayKey === 'string'
            ? DailyBudgetGate.restore(gateOptions(config), {
                dayKey: restored.dayKey,
                used: normalizeAmount(restored.used)
              })
            : new DailyBudgetGate(gateOptions(config))
      } catch (error) {
        log('额度状态恢复失败，从零开始记', error)
        gate = new DailyBudgetGate(gateOptions(config))
      }
      signature = nextSignature
    }
    return { config, gate }
  }

  function persist() {
    // 读状态失败过的会话不落盘：手里只有归零或旧值，写盘会覆盖当天的真实用量。
    if (degraded) return
    if (gate === null || typeof writeState !== 'function') return
    try {
      const state = gate.serialize()
      lastState = state
      writeState(state)
    } catch (error) {
      log('额度状态保存失败', error)
    }
  }

  /** 发请求前问一句：还花得起吗。没开额度时永远放行。 */
  function canSpend(estimated = 0) {
    try {
      const { config, gate: instance } = current()
      if (!config.enabled) return { allowed: true, remaining: Number.POSITIVE_INFINITY }
      return instance.canSpend(normalizeAmount(estimated))
    } catch (error) {
      log('额度预检失败，按放行处理', error)
      return { allowed: true, remaining: Number.POSITIVE_INFINITY }
    }
  }

  /** 拿到真实 usage 后结算。返回结算后的状态，调用方可以顺手记一行日志。 */
  function record(tokens) {
    try {
      const { config, gate: instance } = current()
      if (!config.enabled) return null
      const status = instance.record(normalizeAmount(tokens))
      persist()
      return status
    } catch (error) {
      log('额度记账失败', error)
      return null
    }
  }

  /** 只读状态，给设置页和诊断用。 */
  function status() {
    try {
      const { config, gate: instance } = current()
      // instance.status() 先展开、enabled 后放：设置层的开关优先，不被内部状态覆盖。
      return { ...instance.status(), enabled: config.enabled }
    } catch (error) {
      log('额度状态读取失败', error)
      return null
    }
  }

  return { canSpend, record, status }
}
