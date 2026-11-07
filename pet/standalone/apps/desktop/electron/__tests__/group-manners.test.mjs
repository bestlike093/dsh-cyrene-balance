import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUP_MANNERS, createGroupManners } from '../group-manners.mjs'

const SCOPE = 'qq:group:g1'

function clock(start = new Date(2026, 10, 7, 20, 0, 0).getTime()) {
  let current = start
  return {
    now: () => current,
    advance(ms) {
      current += ms
    }
  }
}

describe('群聊接话分寸', () => {
  it('同一条消息重复推送只接一次', () => {
    const clockAt = clock()
    const manners = createGroupManners({ now: clockAt.now })

    expect(manners.duplicate(SCOPE, 'm1')).toBe(false)
    manners.observe({ scope: SCOPE, senderOpenId: 'a', msgId: 'm1' })
    expect(manners.duplicate(SCOPE, 'm1')).toBe(true)
    // 没发过消息 id 时永远不算重复。
    expect(manners.duplicate(SCOPE, '')).toBe(false)
  })

  it('刚说完八秒内不再接下一句', () => {
    const clockAt = clock()
    const manners = createGroupManners({ now: clockAt.now })

    manners.noteSpoken(SCOPE)
    clockAt.advance(3_000)
    expect(manners.judge({ scope: SCOPE }).reason).toBe('just-spoke')

    clockAt.advance(DEFAULT_GROUP_MANNERS.selfCooldownMs)
    expect(manners.judge({ scope: SCOPE }).allow).toBe(true)
  })

  it('一群人在热聊时不插嘴', () => {
    const clockAt = clock()
    const manners = createGroupManners({ now: clockAt.now })

    for (let index = 0; index < 6; index += 1) {
      manners.observe({ scope: SCOPE, senderOpenId: `u${index % 3}`, msgId: `m${index}` })
      clockAt.advance(1_000)
    }

    expect(manners.judge({ scope: SCOPE }).reason).toBe('busy-crowd')
    // 被点名时可以应声。
    expect(manners.judge({ scope: SCOPE, addressed: true }).allow).toBe(true)
  })

  it('两个人对刷不算热闹，不拿它挡人', () => {
    const clockAt = clock()
    const manners = createGroupManners({ now: clockAt.now })

    for (let index = 0; index < 8; index += 1) {
      manners.observe({ scope: SCOPE, senderOpenId: index % 2 === 0 ? 'a' : 'b', msgId: `m${index}` })
      clockAt.advance(500)
    }

    expect(manners.judge({ scope: SCOPE }).allow).toBe(true)
  })

  it('半分钟前的消息不再算作正在热聊', () => {
    const clockAt = clock()
    const manners = createGroupManners({ now: clockAt.now })

    for (let index = 0; index < 6; index += 1) {
      manners.observe({ scope: SCOPE, senderOpenId: `u${index % 3}`, msgId: `m${index}` })
    }
    clockAt.advance(DEFAULT_GROUP_MANNERS.hotWindowMs + 1_000)

    expect(manners.judge({ scope: SCOPE }).allow).toBe(true)
  })

  it('大群里没人叫就不主动接，被叫了照常应声', () => {
    const clockAt = clock()
    const manners = createGroupManners({ now: clockAt.now })

    expect(manners.judge({ scope: SCOPE, memberCount: 80 }).reason).toBe('large-group-quiet')
    expect(manners.judge({ scope: SCOPE, memberCount: 80, addressed: true }).allow).toBe(true)
    // 拿不到人数时不猜，按普通群处理。
    expect(manners.judge({ scope: SCOPE }).allow).toBe(true)
  })

  it('没有 scope 时不挡任何事', () => {
    const manners = createGroupManners()
    expect(manners.judge({ scope: '' }).allow).toBe(true)
  })
})
