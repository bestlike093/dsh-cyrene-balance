import { describe, expect, it, vi } from 'vitest'
import {
  composePromptSlots,
  composeSystemPrompt,
  createChatService,
  SYSTEM_SECTION_BUDGETS,
  withTimeout
} from '../chat.mjs'

const SETTINGS = { companion: { chat: { enabled: true } } }

function makeService(overrides = {}) {
  return createChatService({
    getSettings: () => SETTINGS,
    getApiKey: async () => 'sk-test',
    getPersonaText: () => '',
    getMemoryDigest: () => '',
    fetchImpl: vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'deepseek-chat',
        choices: [{ message: { content: '我在听' } }]
      })
    })),
    log: vi.fn(),
    ...overrides
  })
}

describe('聊天落盘契约', () => {
  /**
   * 锁定当前语义：两条 turn 逐条落盘，互不回滚。
   * 将来若改成事务式写入，这条会先红，逼改动者显式决策。
   */
  it('persistTurn 第二条失败时不回滚第一条，保留有问无答', async () => {
    const saved = []
    const persistTurn = vi.fn((turn) => {
      if (turn.role === 'assistant') throw new Error('disk full')
      saved.push(turn)
    })
    const persistClear = vi.fn()
    const log = vi.fn()
    const service = makeService({ persistTurn, persistClear, log })

    const result = await service.send({ text: '睡不着' })

    // 回复照常返回，落盘错误不向渲染层抛。
    expect(result).toMatchObject({ ok: true, reply: '我在听' })

    // 第一条已在磁盘，第二条不在；没有任何补偿删除。
    expect(persistTurn).toHaveBeenCalledTimes(2)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ role: 'user', content: '睡不着' })
    expect(persistClear).not.toHaveBeenCalled()

    // 错误只走 log 一处。
    expect(log).toHaveBeenCalledWith('聊天历史落盘失败：', 'disk full')
    expect(log).toHaveBeenCalledTimes(1)

    // 模拟重启：从「磁盘」接回后只剩有问无答。
    const restarted = makeService()
    expect(restarted.hydrate(saved)).toBe(1)
    expect(restarted.history()).toEqual([
      { role: 'user', content: '睡不着', at: expect.any(String) }
    ])
  })
})

describe('聊天清空契约', () => {
  const SAVED = [
    { role: 'user', content: '你好', at: '2026-01-01T00:00:00.000Z' },
    { role: 'assistant', content: '在的', at: '2026-01-01T00:00:01.000Z' }
  ]

  it('persistClear 成功后才清 turns，返回 ok:true', async () => {
    const persistClear = vi.fn(async () => ({ ok: true }))
    const service = makeService({ persistClear })
    service.hydrate(SAVED)

    const result = await service.clear()

    expect(result).toEqual({ ok: true })
    expect(persistClear).toHaveBeenCalledTimes(1)
    expect(service.history()).toEqual([])
  })

  it('persistClear 返回失败时 turns 一字不动，返回 persist-failed', async () => {
    const persistClear = vi.fn(async () => ({ ok: false, reason: 'persist-failed' }))
    const service = makeService({ persistClear })
    service.hydrate(SAVED)
    const before = service.history()

    const result = await service.clear()

    expect(result).toEqual({ ok: false, reason: 'persist-failed' })
    expect(service.history()).toEqual(before)
  })

  it('persistClear 抛错时不向渲染层抛，turns 一字不动', async () => {
    const persistClear = vi.fn(async () => {
      throw new Error('disk full')
    })
    const service = makeService({ persistClear })
    service.hydrate(SAVED)
    const before = service.history()

    const result = await service.clear()

    expect(result).toEqual({ ok: false, reason: 'persist-failed' })
    expect(service.history()).toEqual(before)
  })
})

describe('提示词分槽：稳定的和这一轮的', () => {
  it('人格、场合、语感留在稳定段', () => {
    const slots = composePromptSlots({
      personaText: '人格',
      sourceNoteText: '现在在群里说话',
      socialNote: '这群人说话很短',
      memoryText: '上周聊过的事',
      factNote: '结构化事实'
    })

    expect(slots.stable).toContain('人格')
    expect(slots.stable).toContain('现在在群里说话')
    expect(slots.stable).toContain('这群人说话很短')
    expect(slots.stable).not.toContain('上周聊过的事')
    expect(slots.stable).not.toContain('结构化事实')
  })

  it('记忆、事实、心情这些都算这一轮的背景', () => {
    const slots = composePromptSlots({
      personaText: '人格',
      memoryText: '上周聊过的事',
      factNote: '结构化事实',
      affinityNote: '关系很近',
      bodyNote: '有点困'
    })

    expect(slots.turn).toContain('上周聊过的事')
    expect(slots.turn).toContain('结构化事实')
    expect(slots.turn).toContain('关系很近')
    expect(slots.turn).toContain('有点困')
  })

  it('拼回整份 system 时稳定段在前、背景在后', () => {
    const slots = composePromptSlots({ personaText: '人格', memoryText: '记得的事' })
    const full = composeSystemPrompt('人格', '记得的事')

    expect(full.startsWith(slots.stable)).toBe(true)
    expect(full).toContain(slots.turn)
  })

  it('没有当轮背景时，turn 是空的，稳定段不多出空行', () => {
    expect(composePromptSlots({ personaText: '人格' })).toEqual({ stable: '人格', turn: '' })
  })
})

describe('system 提示词预算', () => {
  it('记忆段超长时按预算裁剪，并留省略号', () => {
    const memory = '记'.repeat(SYSTEM_SECTION_BUDGETS.memory + 50)
    const prompt = composeSystemPrompt('人格', memory)

    expect(prompt).toContain('记'.repeat(SYSTEM_SECTION_BUDGETS.memory))
    expect(prompt).not.toContain('记'.repeat(SYSTEM_SECTION_BUDGETS.memory + 1))
    expect(prompt.endsWith('…')).toBe(true)
  })

  it('人格段永远不裁：5000 字原样保留', () => {
    const persona = '我'.repeat(5000)
    const prompt = composeSystemPrompt(persona, '')

    expect(prompt).toContain(persona)
    expect(prompt.length).toBeGreaterThanOrEqual(5000)
  })

  it('多段同时超预算时各段独立裁剪，不挤掉人格', () => {
    const prompt = composeSystemPrompt(
      '人格',
      '甲'.repeat(1000),
      '乙'.repeat(1000),
      '丙'.repeat(1000),
      '丁'.repeat(1000),
      '戊'.repeat(1000),
      '己'.repeat(1000),
      '庚'.repeat(1000),
      '辛'.repeat(1000),
      '壬'.repeat(1000)
    )

    expect(prompt.length).toBeLessThan(5000)
    expect(prompt).toContain('人格')
  })

  it('空片段不产生空段落', () => {
    expect(composeSystemPrompt('人格', '', '', '', '', '', '', '', '', '')).toBe('人格')
  })

  it('身体感觉只写一句，且不出现数字', () => {
    const prompt = composeSystemPrompt(
      '人格',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '有点困，眼皮沉'
    )

    expect(prompt).toContain('你此刻的身体感觉：有点困，眼皮沉。')
    expect(prompt).not.toMatch(/\d/)
  })
})

describe('注入项超时兜底', () => {
  it('超时返回 fallback，不抛错', async () => {
    const result = await withTimeout(() => new Promise(() => {}), 'fallback', 20)

    expect(result).toBe('fallback')
  })

  it('正常完成时返回原值', async () => {
    const result = await withTimeout(async () => 'ok', 'fallback', 1000)

    expect(result).toBe('ok')
  })

  it('任务抛错时返回 fallback，不冒未处理错误', async () => {
    const result = await withTimeout(
      () => {
        throw new Error('boom')
      },
      'fallback',
      1000
    )

    expect(result).toBe('fallback')
  })
})

describe('会话历史分桶', () => {
  const GROUP = {
    channel: 'qq',
    chatType: 'group',
    openId: 'group-1',
    senderOpenId: 'user-9'
  }

  function recordingService() {
    const requests = []
    const service = makeService({
      fetchImpl: vi.fn(async (_url, init) => {
        requests.push(JSON.parse(init.body).messages)
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '收到' } }] })
        }
      })
    })
    return { service, requests }
  }

  function userTexts(messages) {
    return messages.filter((message) => message.role === 'user').map((message) => message.content)
  }

  it('桌面与 QQ 群交替说话时，各自只带自己的历史', async () => {
    const { service, requests } = recordingService()
    await service.send({ text: '桌面第一句' })
    await service.send({ text: '群里第一句', source: GROUP })
    await service.send({ text: '桌面第二句' })

    // 群里那一轮看不到桌面说过什么；桌面那一轮也看不到群里说过什么。
    expect(userTexts(requests[1]).join('|')).not.toContain('桌面第一句')
    expect(userTexts(requests[1]).join('|')).toContain('群里第一句')
    expect(userTexts(requests[2])).toEqual(['桌面第一句', '桌面第二句'])
  })

  it('重启后按 source 接回各自会话，无来源的旧记录归桌面', () => {
    const service = makeService()
    const restored = service.hydrate([
      { role: 'user', content: '旧的桌面', at: 't1' },
      { role: 'assistant', content: '嗯', at: 't2' },
      { role: 'user', content: '群里的', at: 't3', source: GROUP, scope: 'qq:group:group-1' },
      // assistant 没有 source，靠落盘时的 scope 跟着这一轮走。
      { role: 'assistant', content: '在', at: 't4', scope: 'qq:group:group-1' }
    ])

    expect(restored).toBe(4)
    expect(service.history().map((item) => item.content)).toEqual(['旧的桌面', '嗯'])
    expect(service.history('qq:group:group-1').map((item) => item.content)).toEqual([
      '群里的',
      '在'
    ])
  })

  it('清空会一起清掉所有会话的桶', async () => {
    const { service } = recordingService()
    await service.send({ text: '桌面的话' })
    await service.send({ text: '群里的话', source: GROUP })

    expect(await service.clear()).toEqual({ ok: true })
    expect(service.history()).toEqual([])
    expect(service.history('qq:group:group-1')).toEqual([])
  })

  it('记忆摘要取的是当前这一轮的 scope', async () => {
    const scopes = []
    const service = makeService({
      getMemoryDigest: (_text, scope) => {
        scopes.push(scope)
        return ''
      }
    })

    await service.send({ text: '桌面' })
    await service.send({ text: '群里', source: GROUP })

    expect(scopes).toEqual(['desktop', 'qq:group:group-1'])
  })

  it('历史按字符预算裁剪，最近一轮保持完整', async () => {
    const { service, requests } = recordingService()
    // 每条消息顶到单条上限 4000 字符，三轮就会超过 12000 字符的预算。
    const long = '长'.repeat(3999)
    for (let i = 0; i < 4; i += 1) await service.send({ text: `${i}${long}` })

    const history = requests[3].filter((message) => message.role !== 'system')
    // 4 条历史（两整轮）+ 当前这一条。
    expect(history).toHaveLength(5)
    expect(history.at(-2).content).toBe('收到')
    expect(history.at(-1).content).toContain('3')
  })

  it('换窗口只通知一次，并把上一段最近的对话交出去', async () => {
    const onScopeSwitch = vi.fn(async () => {})
    const { service } = recordingService()
    const switched = makeService({ onScopeSwitch })

    await switched.send({ text: '桌面第一句' })
    await switched.send({ text: '群里第一句', source: GROUP })
    // 同一个窗口继续说话，不该反复触发。
    await switched.send({ text: '群里第二句', source: GROUP })

    expect(onScopeSwitch).toHaveBeenCalledTimes(1)
    expect(onScopeSwitch).toHaveBeenCalledWith({
      from: 'desktop',
      to: 'qq:group:group-1',
      history: [
        { role: 'user', content: '桌面第一句' },
        { role: 'assistant', content: '我在听' }
      ]
    })

    // 另一个服务仍按自己的历史走，互不影响。
    expect(service.history()).toEqual([])
  })
})

describe('用户开口与额外陪伴提示', () => {
  it('普通消息触发 onUserMessage，主动开口不触发', async () => {
    const seen = []
    const service = makeService({
      onUserMessage: (payload) => {
        seen.push(payload)
      }
    })

    await service.send({ text: '在吗' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ text: '在吗', scope: 'desktop' })

    await service.send({
      text: '她主动说一句',
      proactive: { speaker: '群友', note: '自己走进来' }
    })
    expect(seen).toHaveLength(1)
  })

  it('额外陪伴提示进入用户开口这一轮的提示词，主动开口不带', async () => {
    const requests = []
    const service = makeService({
      getCompanionExtra: () => '你本来在看书，现在先陪对方聊一会儿。',
      fetchImpl: vi.fn(async (_url, init) => {
        requests.push(JSON.parse(init.body).messages)
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '收到' } }] })
        }
      })
    })

    await service.send({ text: '在吗' })
    const first = requests[0].map((message) => message.content).join('\n')
    expect(first).toContain('你本来在看书，现在先陪对方聊一会儿。')

    await service.send({
      text: '她主动说一句',
      proactive: { speaker: '群友', note: '自己走进来' }
    })
    const second = requests[1].map((message) => message.content).join('\n')
    expect(second).not.toContain('你本来在看书，现在先陪对方聊一会儿。')
  })
})
