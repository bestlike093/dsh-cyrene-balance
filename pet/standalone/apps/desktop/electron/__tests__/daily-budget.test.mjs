import { describe, expect, it } from 'vitest'
import { createDailyBudget } from '../daily-budget.mjs'

const NOON = new Date(2026, 10, 6, 12, 0, 0).getTime()
const NEXT_DAY = new Date(2026, 10, 7, 12, 0, 0).getTime()

function settings(overrides = {}) {
  return {
    companion: {
      care: {
        dailyTokenBudget: { enabled: true, limit: 1000, ...overrides }
      }
    }
  }
}

describe('每日额度', () => {
  it('没打开时永远放行，也不记账', () => {
    const budget = createDailyBudget({ getSettings: () => settings({ enabled: false }), now: () => NOON })

    expect(budget.canSpend(99999)).toMatchObject({ allowed: true, remaining: Number.POSITIVE_INFINITY })
    expect(budget.record(5000)).toBeNull()
    expect(budget.status()).toMatchObject({ enabled: false, used: 0 })
  })

  it('上限为 0 时等同于不限', () => {
    const budget = createDailyBudget({ getSettings: () => settings({ limit: 0 }), now: () => NOON })

    expect(budget.canSpend(0).allowed).toBe(true)
    expect(budget.record(5000)).toBeNull()
  })

  it('预检不扣减，结算按真实用量累加', () => {
    const budget = createDailyBudget({ getSettings: () => settings(), now: () => NOON })

    expect(budget.canSpend(0)).toMatchObject({ allowed: true, remaining: 1000 })
    expect(budget.canSpend(0).allowed).toBe(true)
    expect(budget.status().used).toBe(0)

    expect(budget.record(600)).toMatchObject({ used: 600, level: 'ok', remaining: 400 })
    expect(budget.record(300)).toMatchObject({ used: 900, level: 'warn', remaining: 100 })
  })

  it('用完后再预检会被拦住，超额照实记账', () => {
    const budget = createDailyBudget({ getSettings: () => settings(), now: () => NOON })

    budget.record(1000)
    const verdict = budget.canSpend(0)
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('limit-reached')

    expect(budget.record(200)).toMatchObject({ used: 1200, level: 'exhausted', remaining: 0 })
  })

  it('估算值也会参与预检', () => {
    const budget = createDailyBudget({ getSettings: () => settings(), now: () => NOON })

    budget.record(900)
    expect(budget.canSpend(200).allowed).toBe(false)
    expect(budget.canSpend(100).allowed).toBe(true)
  })

  it('记账会写回注入的存储，并能从同一天的状态恢复', () => {
    let saved = null
    const first = createDailyBudget({
      getSettings: () => settings(),
      now: () => NOON,
      writeState: (state) => {
        saved = state
      }
    })

    first.record(400)
    expect(saved).toMatchObject({ used: 400 })

    const second = createDailyBudget({
      getSettings: () => settings(),
      now: () => NOON,
      readState: () => saved
    })
    expect(second.status()).toMatchObject({ used: 400, remaining: 600 })
  })

  it('跨过本地日期后从零开始', () => {
    let clock = NOON
    const budget = createDailyBudget({ getSettings: () => settings(), now: () => clock })

    budget.record(800)
    expect(budget.status().used).toBe(800)

    clock = NEXT_DAY
    expect(budget.status().used).toBe(0)
    expect(budget.canSpend(0).allowed).toBe(true)
  })

  it('读设置或恢复状态出错时不阻塞聊天', () => {
    const budget = createDailyBudget({
      getSettings: () => {
        throw new Error('settings unavailable')
      },
      now: () => NOON
    })

    expect(budget.canSpend(0).allowed).toBe(true)
    expect(budget.record(100)).toBeNull()

    const broken = createDailyBudget({
      getSettings: () => settings(),
      now: () => NOON,
      readState: () => {
        throw new Error('state corrupted')
      }
    })
    expect(broken.status()).toMatchObject({ used: 0 })
  })
})
