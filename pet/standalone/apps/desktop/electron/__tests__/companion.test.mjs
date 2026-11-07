import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCompanionNote,
  createCompanionService,
  parseEmojiTag
} from '../companion.mjs'

const ENABLED = { companion: { companionLayer: { enabled: true } } }
const DISABLED = { companion: { companionLayer: { enabled: false } } }

function turn(overrides = {}) {
  return {
    mood: { valence: 0.4, arousal: 0.3, tension: 0.1, updatedAt: 1 },
    emotion: 'happy',
    moodNote: '心情不错，很放松',
    memories: [],
    memoryNote: '',
    emoji: [{ entry: { id: 'hugtight', file: 'hugtight.png', emotions: ['gentle'], scenes: ['comfort'] }, score: 0.9, breakdown: { emotion: 1, register: 1, freshness: 1, scene: 1, penalty: 0 } }],
    openLoops: [],
    reflection: null,
    ...overrides
  }
}

describe('表情标记', () => {
  it('三种写法都能摘出来，并从正文里抹掉', () => {
    expect(parseEmojiTag('我在呀 [图:hugtight]', ['hugtight'])).toEqual({
      text: '我在呀',
      emojiId: 'hugtight'
    })
    expect(parseEmojiTag('我在呀【图：hugtight】', ['hugtight']).emojiId).toBe('hugtight')
    expect(parseEmojiTag('我在呀(图: hugtight)', ['hugtight']).emojiId).toBe('hugtight')
  })

  it('模型编的 id 会被丢掉，标记也不会漏进正文', () => {
    const result = parseEmojiTag('给你看 [图:../../etc/passwd]', ['hugtight'])
    expect(result.emojiId).toBeNull()
    expect(result.text).toBe('给你看')
  })

  it('没有候选时任何标记都清掉，避免句末残留', () => {
    expect(parseEmojiTag('晚安 [图:goodnight]', [])).toEqual({ text: '晚安', emojiId: null })
  })

  it('两个标记只保留第一个合法 id，正文不残留', () => {
    expect(parseEmojiTag('给你看 [图:hugtight] 还有 [图:goodnight]', ['hugtight'])).toEqual({
      text: '给你看  还有',
      emojiId: 'hugtight'
    })
  })

  it('第一个非法、第二个合法时，仍认第二个', () => {
    expect(parseEmojiTag('[图:nope] [图:hugtight]', ['hugtight'])).toEqual({
      text: '',
      emojiId: 'hugtight'
    })
  })
})

describe('提示词片段', () => {
  it('没有内容时给空串，不生成空段落', () => {
    expect(buildCompanionNote(null)).toBe('')
    expect(buildCompanionNote(turn({ moodNote: '', memoryNote: '', emoji: [], openLoops: [] }))).toBe('')
  })

  it('心情、记忆、话头、表情按固定顺序出现', () => {
    const note = buildCompanionNote(
      turn({
        memoryNote: '可以直接说起的：偏好=晚上写代码',
        openLoops: [{ id: 'l1', text: '上次聊到推送还没说完', createdAt: 1, status: 'open' }]
      })
    )
    expect(note).toContain('你此刻的心情：心情不错，很放松。')
    expect(note).toContain('偏好=晚上写代码')
    expect(note).toContain('上次聊到推送还没说完')
    expect(note).toContain('[图:id]')
    expect(note).toContain('hugtight（抱紧）')
    expect(note.indexOf('心情')).toBeLessThan(note.indexOf('偏好=晚上写代码'))
  })

  it('话头最多给三条，避免每句话都变成追问', () => {
    const loops = [1, 2, 3, 4, 5].map((n) => ({
      id: `l${n}`,
      text: `话头${n}`,
      createdAt: n,
      status: 'open'
    }))
    const note = buildCompanionNote(turn({ moodNote: '', memoryNote: '', emoji: [], openLoops: loops }))
    expect(note).toContain('话头3')
    expect(note).toContain('话头5')
    expect(note).not.toContain('话头2')
  })
})

describe('陪伴服务', () => {
  let save
  let load

  beforeEach(() => {
    save = vi.fn(async () => {})
    load = vi.fn(async () => null)
  })

  function makeService(overrides = {}) {
    return createCompanionService({
      load,
      save,
      getSettings: () => ENABLED,
      saveDelayMs: 1,
      log: vi.fn(),
      ...overrides
    })
  }

  it('关掉总开关时不处理消息，也不落盘', async () => {
    const service = makeService({ getSettings: () => DISABLED })
    expect(await service.beginTurn('今天好累')).toBeNull()
    service.endTurn('辛苦啦')
    await service.flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('一轮对话会返回心情与记忆上下文', async () => {
    const service = makeService()
    const context = await service.beginTurn('我喜欢晚上写代码')
    expect(context).not.toBeNull()
    expect(typeof context.moodNote).toBe('string')
    expect(context.moodNote.length).toBeGreaterThan(0)
  })

  it('收尾后落盘，重开能从同一份状态接回', async () => {
    const first = makeService()
    await first.beginTurn('我最近睡不好，有点焦虑')
    first.endTurn('那今晚早点睡，我陪你。')
    await first.flush()

    const saved = save.mock.calls[0][0]
    expect(saved.version).toBe(1)

    load.mockResolvedValue(saved)
    const second = makeService()
    const snapshot = await second.snapshot()
    expect(snapshot).not.toBeNull()
    expect(snapshot.assertions).toEqual(saved.assertions)
  })

  it('节目单会进提示词，只写此刻和接下来', async () => {
    const fixed = new Date(2026, 10, 5, 10, 0, 0, 0).getTime()
    const service = makeService({ now: () => fixed })
    const plan = {
      date: '2026-11-05',
      generatedAt: fixed,
      source: 'model',
      segments: [
        { id: 'work', startMinute: 540, endMinute: 720, title: '写东西', kind: 'work' },
        { id: 'walk', startMinute: 780, endMinute: 840, title: '散步', kind: 'leisure' }
      ]
    }

    expect(await service.setAgenda(plan)).toBe(true)
    const context = await service.beginTurn('在忙吗')
    expect(context.agendaNote).toContain('写东西')
    expect(context.agendaNote).toContain('散步')

    const note = await service.presenceNote()
    expect(note).toContain('你现在正在过的这一天')
    expect(note).toContain('写东西')
  })

  it('同一段一天只允许主动开口一次', async () => {
    const fixed = new Date(2026, 10, 5, 10, 0, 0, 0).getTime()
    const service = makeService({ now: () => fixed })
    await service.setAgenda({
      date: '2026-11-05',
      generatedAt: fixed,
      source: 'model',
      segments: [{ id: 'work', startMinute: 540, endMinute: 720, title: '写东西', kind: 'work' }]
    })

    expect((await service.claimAgenda())?.id).toBe('work')
    expect(await service.claimAgenda()).toBeNull()
  })

  it('身体很累时不再挑日常话题，睡着就完全不开口', async () => {
    const fixed = new Date(2026, 10, 5, 9, 10, 0, 0).getTime()
    const service = makeService({ now: () => fixed })
    await service.setAgenda({
      date: '2026-11-05',
      generatedAt: fixed,
      source: 'model',
      segments: [{ id: 'work', startMinute: 540, endMinute: 720, title: '写东西', kind: 'work' }]
    })

    // 平常刚进入这一段，会顺势聊一句。
    expect(await service.pickOpening()).not.toBeNull()

    // 只是累了：日常话题先收起来。
    expect(await service.pickOpening({ body: { flags: { lowEnergy: true } } })).toBeNull()
    // 困到睁不开眼：这一拍彻底安静。
    expect(await service.pickOpening({ body: { flags: { exhausted: true } } })).toBeNull()
    // 社交力气见底：也不主动开口。
    expect(await service.pickOpening({ body: { flags: { drained: true } } })).toBeNull()
  })

  it('关掉总开关时不给节目单，也不认领', async () => {
    const fixed = new Date(2026, 10, 5, 10, 0, 0, 0).getTime()
    const service = makeService({ now: () => fixed, getSettings: () => DISABLED })
    expect(await service.currentAgenda()).toBeNull()
    expect(await service.claimAgenda()).toBeNull()
  })

  it('落盘失败不会把已经回复的那句话带崩', async () => {
    const service = makeService({
      save: vi.fn(async () => {
        throw new Error('disk full')
      })
    })
    await service.beginTurn('在吗')
    expect(() => service.endTurn('在的')).not.toThrow()
    await expect(service.flush()).resolves.toBe(false)
  })

  it('主动说话只读心情，不推进对话轮次', async () => {
    const service = makeService()
    const before = await service.snapshot()
    const note = await service.presenceNote()
    const after = await service.snapshot()
    expect(note).toContain('你此刻的心情')
    expect(after.reflection).toEqual(before.reflection)
  })

  it('话头放置够久才会被回访，提过一次就不再重复', async () => {
    let clock = 1_700_000_000_000
    const service = makeService({ now: () => clock })

    await service.beginTurn('明天要去面试')
    // 刚说完就问「面试怎么样了」会显得没在听人说话。
    expect(await service.pendingLoop()).toBeNull()

    // 说到「明天」，就等到第二天上午，而不是两个小时后就催。
    clock += 27 * 60 * 60_000
    const loop = await service.pendingLoop()
    expect(loop?.text).toContain('面试')

    service.markLoopNudged(loop.id)
    expect(await service.pendingLoop()).toBeNull()
  })

  it('「明天」的事当晚不催，第二天上午才回访', async () => {
    let clock = new Date(2026, 10, 6, 21, 0, 0).getTime()
    const service = makeService({ now: () => clock })

    await service.beginTurn('明天要去面试，有点紧张')
    clock += 2 * 60 * 60_000
    expect(await service.pendingLoop()).toBeNull()

    clock = new Date(2026, 10, 7, 9, 30, 0).getTime()
    const loop = await service.pendingLoop()
    expect(loop?.text).toContain('面试')
    expect(loop?.dueAt).toBe(new Date(2026, 10, 7, 9, 0, 0).getTime())
  })
})
