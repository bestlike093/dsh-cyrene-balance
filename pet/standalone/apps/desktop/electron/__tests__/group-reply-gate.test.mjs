import { describe, expect, it } from 'vitest'
import { createGroupReplyGate, DEFAULT_GROUP_REPLY_LIMITS } from '../group-reply-gate.mjs'

describe('createGroupReplyGate', () => {
  it('同一个群一分钟内最多三条，换群不受影响', () => {
    let now = 1_000_000
    const gate = createGroupReplyGate({ now: () => now })

    expect(gate.allow({ scope: 'g1', senderOpenId: 'a' }).ok).toBe(true)
    now += 1000
    expect(gate.allow({ scope: 'g1', senderOpenId: 'b' }).ok).toBe(true)
    now += 1000
    expect(gate.allow({ scope: 'g1', senderOpenId: 'c' }).ok).toBe(true)
    now += 1000
    expect(gate.allow({ scope: 'g1', senderOpenId: 'd' })).toMatchObject({
      ok: false,
      reason: 'group-window'
    })
    expect(gate.allow({ scope: 'g2', senderOpenId: 'd' }).ok).toBe(true)
  })

  it('同一个人冷却期内不重复回，过了冷却才放行', () => {
    let now = 2_000_000
    const gate = createGroupReplyGate({ now: () => now })

    expect(gate.allow({ scope: 'g1', senderOpenId: 'a' }).ok).toBe(true)
    now += 1000
    expect(gate.allow({ scope: 'g1', senderOpenId: 'a' })).toMatchObject({
      ok: false,
      reason: 'sender-cooldown'
    })
    now += DEFAULT_GROUP_REPLY_LIMITS.senderCooldownMs
    expect(gate.allow({ scope: 'g1', senderOpenId: 'a' }).ok).toBe(true)
  })

  it('窗口滑过去之后恢复', () => {
    let now = 3_000_000
    const gate = createGroupReplyGate({ now: () => now })

    for (const sender of ['a', 'b', 'c']) {
      expect(gate.allow({ scope: 'g1', senderOpenId: sender }).ok).toBe(true)
      now += 1000
    }
    expect(gate.allow({ scope: 'g1', senderOpenId: 'd' }).ok).toBe(false)

    now = 3_000_000 + DEFAULT_GROUP_REPLY_LIMITS.windowMs + 1
    expect(gate.allow({ scope: 'g1', senderOpenId: 'd' }).ok).toBe(true)
  })

  it('每天上限之后拒绝，隔天重置', () => {
    let now = 4_000_000
    const gate = createGroupReplyGate({
      now: () => now,
      windowMs: 1000,
      groupLimit: 10,
      senderCooldownMs: 0,
      dailyLimit: 2
    })

    expect(gate.allow({ scope: 'g1', senderOpenId: 'a' }).ok).toBe(true)
    expect(gate.allow({ scope: 'g1', senderOpenId: 'b' }).ok).toBe(true)
    expect(gate.allow({ scope: 'g1', senderOpenId: 'c' })).toMatchObject({
      ok: false,
      reason: 'group-daily'
    })

    now += 24 * 60 * 60 * 1000
    expect(gate.allow({ scope: 'g1', senderOpenId: 'c' }).ok).toBe(true)
  })

  it('缺少 scope 时不拦截', () => {
    const gate = createGroupReplyGate()
    expect(gate.allow({}).ok).toBe(true)
    expect(gate.allow({ senderOpenId: 'a' }).ok).toBe(true)
  })

  it('stats 给出现窗口与当日计数', () => {
    let now = 5_000_000
    const gate = createGroupReplyGate({ now: () => now })
    expect(gate.stats('g1')).toEqual({ window: 0, daily: 0 })

    gate.allow({ scope: 'g1', senderOpenId: 'a' })
    now += 1000
    gate.allow({ scope: 'g1', senderOpenId: 'b' })
    expect(gate.stats('g1')).toEqual({ window: 2, daily: 2 })
  })
})
