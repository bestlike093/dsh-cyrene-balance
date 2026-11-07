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

function readBudgetSettings(getSettings) {
  let settings
  try {
    settings = getSettings()
  } catch {
    settings = null
  }
  const raw = settings?.companion?.care?.dailyTokenBudget
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  const limit = Number.isFinite(Number(value.limit)) ? Math.max(0, Math.floor(Number(value.limit))) : 0
  const warnRatio = Number.isFinite(Number(value.warnRatio))
    ? Math.min(1, Math.max(0, Number(value.warnRatio)))
    : DEFAULT_WARN_RATIO
  return {
    enabled: value.enabled === true && limit > 0,
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

  function gateOptions(config) {
    return { dailyLimit: config.limit, warnRatio: config.warnRatio, now }
  }

  function current() {
    const config = readBudgetSettings(getSettings)
    const nextSignature = `${config.limit}:${config.warnRatio}`
    if (gate === null || nextSignature !== signature) {
      let restored = lastState
      try {
        if (typeof readState === 'function') restored = readState()
      } catch (error) {
        log('额度状态读取失败，从零开始记', error)
        restored = null
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
      return { enabled: config.enabled, ...instance.status() }
    } catch (error) {
      log('额度状态读取失败', error)
      return null
    }
  }

  return { canSpend, record, status }
}
