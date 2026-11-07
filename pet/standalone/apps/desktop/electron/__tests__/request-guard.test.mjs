import { describe, expect, it } from 'vitest'
import { createOfflineReply, createRequestGate } from '../request-guard.mjs'

function settings({ guard = {}, offline = {} } = {}) {
  return {
    companion: {
      care: {
        requestGuard: { enabled: true, perMinute: 20, ...guard },
        offlineReply: { enabled: true, ...offline }
      }
    }
  }
}

describe('请求守门', () => {
  it('关掉时永远放行', () => {
    const gate = createRequestGate({ getSettings: () => settings({ guard: { enabled: false } }) })

    for (let index = 0; index < 50; index += 1) {
      expect(gate.allow().allowed).toBe(true)
    }
  })

  it('超过每分钟上限后被拦住，并给出等待时间', () => {
    let clock = 0
    const gate = createRequestGate({
      getSettings: () => settings({ guard: { perMinute: 2 } }),
      now: () => clock
    })

    expect(gate.allow().allowed).toBe(true)
    expect(gate.allow().allowed).toBe(true)

    const third = gate.allow()
    expect(third.allowed).toBe(false)
    expect(third.waitMs).toBeGreaterThan(0)
  })

  it('过一会儿桶会自己补回来', () => {
    let clock = 0
    const gate = createRequestGate({
      getSettings: () => settings({ guard: { perMinute: 2 } }),
      now: () => clock
    })

    gate.allow()
    gate.allow()
    expect(gate.allow().allowed).toBe(false)

    // 每分钟 2 个，补 1 个大约 30 秒。
    clock += 30_000
    expect(gate.allow().allowed).toBe(true)
  })

  it('上限被夹在 1 到 120 之间', () => {
    const low = createRequestGate({ getSettings: () => settings({ guard: { perMinute: 0 } }) })
    expect(low.status()).toMatchObject({ enabled: true, perMinute: 1 })

    const high = createRequestGate({ getSettings: () => settings({ guard: { perMinute: 999 } }) })
    expect(high.status()).toMatchObject({ perMinute: 120 })
  })

  it('读设置出错时按放行处理', () => {
    const gate = createRequestGate({
      getSettings: () => {
        throw new Error('settings unavailable')
      }
    })

    expect(gate.allow()).toMatchObject({ allowed: true, waitMs: 0 })
  })
})

describe('离线兜底', () => {
  it('开着时按情绪挑一句本地台词', async () => {
    const offline = createOfflineReply({ getSettings: () => settings() })

    const line = await offline.replyTo('今天有点难过')
    expect(line).not.toBeNull()
    expect(line.source).toBe('local-rule')
    expect(line.text).toBe('难过的时候，人家陪你待一会儿。')
  })

  it('同一情绪连续两次不会说同一句', async () => {
    const offline = createOfflineReply({ getSettings: () => settings() })

    // 这句不命中任何情绪规则，会落到 neutral 的预置池里轮转。
    const first = await offline.replyTo('今天天气不错')
    const second = await offline.replyTo('今天天气不错')
    expect(first.source).toBe('preset-pool')
    expect(first.text).not.toBe(second.text)
  })

  it('关掉后不接话', async () => {
    const offline = createOfflineReply({
      getSettings: () => settings({ offline: { enabled: false } })
    })

    expect(await offline.replyTo('在吗')).toBeNull()
    expect(offline.enabled()).toBe(false)
  })

  it('空文本不产出兜底', async () => {
    const offline = createOfflineReply({ getSettings: () => settings() })

    expect(await offline.replyTo('')).toBeNull()
    expect(await offline.replyTo('   ')).toBeNull()
  })
})
