import { describe, expect, it } from 'vitest'
import {
  CLOSER_LINES,
  DEFAULT_PROACTIVE_LIMITS,
  DEFAULT_SILENCE_LIMITS,
  buildCloserNote,
  buildProactiveNote,
  buildReviewNote,
  createProactiveGate,
  decideCloser,
  decideByCue,
  decideProactive,
  evaluateSilence,
  findTopicHits,
  isNameOnly,
  isQuietHour,
  lineSimilarity,
  pendingOpenLoopReviews,
  pickCloserLine,
  proactiveLimitsFromPresence,
  resolveOpeningCue
} from '../proactive.mjs'

/** 用本地时间构造时间戳，避免测试机时区不同导致小时数漂移。 */
function at(hour, minute = 0, day = 6) {
  return new Date(2026, 10, day, hour, minute, 0, 0).getTime()
}

describe('proactiveLimitsFromPresence', () => {
  it('把「多久说一次」读成最小间隔', () => {
    expect(proactiveLimitsFromPresence({ intervalMinutes: 45 }).minGapMs).toBe(45 * 60_000)
  })

  it('间隔只往保守方向调，群里不比默认更密', () => {
    expect(proactiveLimitsFromPresence({ intervalMinutes: 5 }).minGapMs).toBe(
      DEFAULT_PROACTIVE_LIMITS.minGapMs
    )
  })

  it('把夜间时段读成小时', () => {
    const limits = proactiveLimitsFromPresence({
      quiet: { enabled: true, from: '23:00', to: '08:00' }
    })
    expect(limits.quietStartHour).toBe(23)
    expect(limits.quietEndHour).toBe(8)
  })

  it('关掉夜间不扰时视为不静默', () => {
    const limits = proactiveLimitsFromPresence({
      quiet: { enabled: false, from: '23:00', to: '08:00' }
    })
    expect(limits.quietStartHour).toBe(0)
    expect(limits.quietEndHour).toBe(0)
  })

  it('字段缺失时不动默认', () => {
    expect(proactiveLimitsFromPresence({})).toEqual({})
    expect(proactiveLimitsFromPresence(undefined)).toEqual({})
  })
})

describe('createProactiveGate 读设置', () => {
  it('改完间隔，下一句就按新的来', () => {
    let now = at(15)
    let limitMinutes = 30
    const gate = createProactiveGate({
      now: () => now,
      getLimits: () => ({ minGapMs: limitMinutes * 60_000 })
    })

    gate.markSpoke('g')
    now = at(15, 20)
    expect(gate.decide('g', { text: '昔涟' }).reason).toBe('cooldown')

    limitMinutes = 10
    expect(gate.decide('g', { text: '昔涟' }).reason).toBe('name_only')
  })

  it('静默时段跟着设置走', () => {
    const gate = createProactiveGate({
      now: () => at(22, 30),
      getLimits: () =>
        proactiveLimitsFromPresence({ quiet: { enabled: true, from: '22:00', to: '08:00' } })
    })
    expect(gate.decide('g', { text: '昔涟' }).reason).toBe('quiet_hours')
  })
})

describe('isQuietHour', () => {
  it('深夜到清晨算静默', () => {
    expect(isQuietHour(at(23, 30))).toBe(true)
    expect(isQuietHour(at(3))).toBe(true)
    expect(isQuietHour(at(7, 59))).toBe(true)
  })

  it('白天不算静默', () => {
    expect(isQuietHour(at(8))).toBe(false)
    expect(isQuietHour(at(12))).toBe(false)
    expect(isQuietHour(at(22, 59))).toBe(false)
  })

  it('起止相同视为不启用', () => {
    expect(isQuietHour(at(3), 8, 8)).toBe(false)
  })
})

describe('isNameOnly', () => {
  it('只叫名字算', () => {
    expect(isNameOnly('昔涟')).toBe(true)
    expect(isNameOnly('@昔涟')).toBe(true)
    expect(isNameOnly('昔涟，在吗')).toBe(true)
    expect(isNameOnly('小涟？')).toBe(true)
  })

  it('带正文就不算', () => {
    expect(isNameOnly('昔涟你觉得这个怎么样')).toBe(false)
    expect(isNameOnly('@昔涟 帮我看下这个报错')).toBe(false)
  })

  it('没叫名字不算', () => {
    expect(isNameOnly('今天天气不错')).toBe(false)
    expect(isNameOnly('')).toBe(false)
  })

  it('自定义唤醒词生效', () => {
    expect(isNameOnly('迷迷在不在', { words: ['迷迷'] })).toBe(true)
    expect(isNameOnly('昔涟在吗', { words: ['迷迷'] })).toBe(false)
  })
})

describe('findTopicHits', () => {
  it('原样出现的片段才算命中', () => {
    const hits = findTopicHits('Rust 的借用检查真难', ['最近在学 Rust'])
    expect(hits).toHaveLength(1)
    expect(hits[0].fragment).toBe('Rust')
  })

  it('只是聊到同一个高频词不算', () => {
    expect(findTopicHits('今天天气不错', ['今天在学 Rust'])).toEqual([])
  })

  it('没有事实时返回空数组', () => {
    expect(findTopicHits('随便说点什么', [])).toEqual([])
    expect(findTopicHits('随便说点什么', null)).toEqual([])
  })

  it('最多只返回一条，避免一口气接三个话题', () => {
    const hits = findTopicHits('明天要交 Rust 和 Python 的作业', [
      '在学 Rust',
      '在学 Python'
    ])
    expect(hits).toHaveLength(DEFAULT_PROACTIVE_LIMITS.maxHits)
  })
})

describe('decideProactive', () => {
  const base = { now: at(15), wakeWords: ['昔涟'], facts: ['最近在学 Rust'] }

  it('空消息不开口', () => {
    expect(decideProactive({ ...base, text: '' }).reason).toBe('empty')
  })

  it('自己说的话不回应自己', () => {
    const result = decideProactive({ ...base, text: '昔涟', speaker: 'self' })
    expect(result.speak).toBe(false)
    expect(result.reason).toBe('from_self')
  })

  it('深夜即使被点名也不开口', () => {
    const result = decideProactive({ ...base, now: at(2), text: '昔涟' })
    expect(result.speak).toBe(false)
    expect(result.reason).toBe('quiet_hours')
  })

  it('冷却期内不重复', () => {
    const result = decideProactive({
      ...base,
      text: '昔涟',
      lastSpokeAt: at(15) - 60_000
    })
    expect(result.reason).toBe('cooldown')
  })

  it('超过每日上限就不再说', () => {
    const result = decideProactive({ ...base, text: '昔涟', todayCount: 3 })
    expect(result.reason).toBe('daily_limit')
  })

  it('只叫名字时开口', () => {
    const result = decideProactive({ ...base, text: '昔涟？' })
    expect(result.speak).toBe(true)
    expect(result.reason).toBe('name_only')
  })

  it('话题命中记忆时开口', () => {
    const result = decideProactive({ ...base, text: 'Rust 的借用检查又报错了' })
    expect(result.speak).toBe(true)
    expect(result.reason).toBe('topic_match')
    expect(result.hits[0].fragment).toBe('Rust')
  })

  it('被 @ 时哪怕话题无关也接住', () => {
    const result = decideProactive({ ...base, text: '今天中午吃什么', addressed: true })
    expect(result.speak).toBe(true)
    expect(result.reason).toBe('addressed')
  })

  it('被 @ 也挡不住深夜与止损', () => {
    expect(decideProactive({ ...base, now: at(2), text: '吃什么', addressed: true }).reason).toBe(
      'quiet_hours'
    )
    const silenced = decideProactive({
      ...base,
      text: '吃什么',
      addressed: true,
      lastUserSpokeAt: at(15, 0, 2),
      unansweredSentAt: [at(10, 0, 5), at(10, 0, 6)]
    })
    expect(silenced.speak).toBe(false)
  })

  it('没有理由就沉默', () => {
    const result = decideProactive({ ...base, text: '今天中午吃什么' })
    expect(result.speak).toBe(false)
    expect(result.reason).toBe('no_reason')
  })
})

describe('createProactiveGate', () => {
  it('发出后进入冷却，并记进当天次数', () => {
    let now = at(15)
    const gate = createProactiveGate({ now: () => now })
    expect(gate.decide('qq:group:1', { text: '昔涟', wakeWords: ['昔涟'] }).speak).toBe(true)

    gate.markSpoke('qq:group:1')
    expect(gate.snapshot('qq:group:1').count).toBe(1)

    now += 60_000
    expect(gate.decide('qq:group:1', { text: '昔涟', wakeWords: ['昔涟'] }).reason).toBe('cooldown')

    now += DEFAULT_PROACTIVE_LIMITS.minGapMs
    expect(gate.decide('qq:group:1', { text: '昔涟', wakeWords: ['昔涟'] }).speak).toBe(true)
  })

  it('不同群各记各的', () => {
    const gate = createProactiveGate({ now: () => at(15) })
    gate.markSpoke('qq:group:1')
    expect(gate.snapshot('qq:group:2').count).toBe(0)
  })

  it('跨天重置次数', () => {
    let now = at(15, 0, 6)
    const gate = createProactiveGate({ now: () => now })
    gate.markSpoke('qq:group:1')
    now = at(15, 0, 7)
    expect(gate.snapshot('qq:group:1').count).toBe(0)
  })
})

describe('buildProactiveNote', () => {
  it('不开口时没有提示', () => {
    expect(buildProactiveNote({ speak: false, reason: 'no_reason' })).toBe('')
  })

  it('点名和话题分别给不同的分寸', () => {
    expect(buildProactiveNote({ speak: true, reason: 'name_only' })).toContain('叫了你的名字')
    const note = buildProactiveNote({
      speak: true,
      reason: 'topic_match',
      hits: [{ fragment: 'Rust' }]
    })
    expect(note).toContain('「Rust」')
    expect(note).toContain('别把记忆原样背出来')
  })
})

describe('evaluateSilence', () => {
  const base = { now: at(15, 0, 6) }

  it('没发过就不算冷场', () => {
    expect(evaluateSilence({ ...base, lastUserSpokeAt: at(15, 0, 5) })).toBe(null)
  })

  it('对方昨天说过话、今天发过，还不够久', () => {
    const result = evaluateSilence({
      ...base,
      lastUserSpokeAt: at(15, 0, 5),
      unansweredSentAt: [at(10, 0, 6)]
    })
    expect(result).toBe(null)
  })

  it('对方三天没开口、期间还主动发过，就止损', () => {
    const result = evaluateSilence({
      ...base,
      lastUserSpokeAt: at(15, 0, 2),
      unansweredSentAt: [at(10, 0, 5), at(10, 0, 6)]
    })
    expect(result?.silenced).toBe(true)
    expect(result?.sentCount).toBe(2)
    expect(result?.cold).toBe(false)
  })

  it('对方刚说过话，之前的账立刻作废', () => {
    const result = evaluateSilence({
      ...base,
      lastUserSpokeAt: at(14, 0, 6),
      unansweredSentAt: [at(10, 0, 6)]
    })
    expect(result).toBe(null)
  })

  it('从没对过话的新会话给更宽的窗口', () => {
    expect(
      evaluateSilence({ ...base, lastUserSpokeAt: 0, unansweredSentAt: [at(15, 0, 2)] })
    ).toBe(null)
    const cold = evaluateSilence({
      now: at(15, 0, 10),
      lastUserSpokeAt: 0,
      unansweredSentAt: [at(15, 0, 2)]
    })
    expect(cold?.cold).toBe(true)
  })
})

describe('decideProactive 的止损', () => {
  it('止损时连点名也不回', () => {
    const result = decideProactive({
      now: at(15),
      text: '昔涟？',
      wakeWords: ['昔涟'],
      lastUserSpokeAt: at(15, 0, 2),
      unansweredSentAt: [at(10, 0, 5), at(10, 0, 6)]
    })
    expect(result.speak).toBe(false)
    expect(result.reason).toBe('silent_giveup')
    expect(result.silence?.silenced).toBe(true)
  })
})

describe('decideCloser', () => {
  const soon = { silenceLimits: { closerAfterMs: 60 * 60 * 1000 } }

  it('没有未回应的话就不收场', () => {
    expect(decideCloser({ now: at(15), unansweredSentAt: [] }).reason).toBe('nothing_pending')
  })

  it('还没到时间就不收场', () => {
    const result = decideCloser({
      now: at(15),
      unansweredSentAt: [at(14, 30)],
      ...soon
    })
    expect(result.speak).toBe(false)
    expect(result.reason).toBe('not_yet')
  })

  it('够久了允许收场', () => {
    const result = decideCloser({
      now: at(15),
      unansweredSentAt: [at(13)],
      ...soon
    })
    expect(result.speak).toBe(true)
    expect(result.reason).toBe('closing')
    expect(result.index).toBe(1)
  })

  it('收场次数用完就停', () => {
    const result = decideCloser({
      now: at(15),
      unansweredSentAt: [at(13)],
      closerCount: DEFAULT_SILENCE_LIMITS.maxClosers,
      ...soon
    })
    expect(result.reason).toBe('closer_exhausted')
  })

  it('静默时段不收场', () => {
    const result = decideCloser({
      now: at(2),
      unansweredSentAt: [at(1)],
      ...soon
    })
    expect(result.reason).toBe('quiet_hours')
  })

  it('止损优先于收场', () => {
    const result = decideCloser({
      now: at(15, 0, 6),
      lastUserSpokeAt: at(15, 0, 2),
      unansweredSentAt: [at(10, 0, 5)],
      ...soon
    })
    expect(result.reason).toBe('silent_giveup')
  })
})

describe('pendingOpenLoopReviews', () => {
  const base = { now: at(15) }

  it('窗口内未结的话头要被复核', () => {
    const list = pendingOpenLoopReviews({
      ...base,
      openLoops: [{ id: 'a', question: '面试怎么样', at: at(10) }]
    })
    expect(list).toHaveLength(1)
    expect(list[0].question).toBe('面试怎么样')
  })

  it('结掉的、过期的、未来的都不算', () => {
    const list = pendingOpenLoopReviews({
      ...base,
      openLoops: [
        { id: 'a', question: '已结', at: at(10), resolved: true },
        { id: 'b', question: '过期', at: at(10, 0, 1) },
        { id: 'c', question: '未来', at: at(16) }
      ]
    })
    expect(list).toHaveLength(0)
  })
})

describe('收场与复核的提示', () => {
  it('收场不许追问', () => {
    const note = buildCloserNote({ speak: true, reason: 'closing', index: 1 })
    expect(note).toContain('一句话')
    expect(note).toContain('不要追问')
    expect(note).toContain('翻篇')
  })

  it('不收场时没有提示', () => {
    expect(buildCloserNote({ speak: false, reason: 'not_yet' })).toBe('')
  })

  it('复核提示带上原话，并要求不要重问', () => {
    const note = buildReviewNote([{ question: '面试怎么样' }])
    expect(note).toContain('面试怎么样')
    expect(note).toContain('不要再问一遍')
    expect(buildReviewNote([])).toBe('')
  })
})

describe('createProactiveGate 的未回应账本', () => {
  it('对方开口就清账', () => {
    let now = at(15, 0, 2)
    const gate = createProactiveGate({ now: () => now })
    gate.markSpoke('g')
    now += 60_000
    expect(gate.snapshot('g').unansweredCount).toBe(1)

    gate.noteUserSpoke('g')
    expect(gate.snapshot('g').unansweredCount).toBe(0)
    expect(gate.snapshot('g').silenced).toBe(false)
  })

  it('跨天只重置次数，不丢未回应账本', () => {
    let now = at(15, 0, 2)
    const gate = createProactiveGate({ now: () => now })
    gate.markSpoke('g')
    now = at(15, 0, 3)
    expect(gate.snapshot('g').count).toBe(0)
    expect(gate.snapshot('g').unansweredCount).toBe(1)
  })

  it('连续几天没人应就静默', () => {
    let now = at(15, 0, 2)
    const gate = createProactiveGate({ now: () => now })
    gate.noteUserSpoke('g')
    now = at(15, 0, 3)
    gate.markSpoke('g')
    now = at(15, 0, 6)
    expect(gate.decide('g', { text: '昔涟', wakeWords: ['昔涟'] }).reason).toBe('silent_giveup')
    expect(gate.snapshot('g').silenced).toBe(true)
  })

  it('说了一句后对方回来，又能正常开口', () => {
    let now = at(15, 0, 2)
    const gate = createProactiveGate({ now: () => now })
    gate.markSpoke('g')
    now = at(15, 0, 6)
    gate.noteUserSpoke('g')
    expect(gate.decide('g', { text: '昔涟', wakeWords: ['昔涟'] }).speak).toBe(true)
  })

  it('话头记下来、能复核、能结掉', () => {
    let now = at(15)
    const gate = createProactiveGate({ now: () => now })
    const id = gate.noteOpened('g', { question: '后来的面试怎么样了' })
    expect(id).not.toBe('')
    expect(gate.pendingReviews('g')).toHaveLength(1)

    now += 60 * 60 * 1000
    expect(gate.pendingReviews('g')[0].question).toBe('后来的面试怎么样了')
    expect(gate.resolveOpenLoop('g', id, 'done')).toBe(true)
    expect(gate.pendingReviews('g')).toHaveLength(0)
    expect(gate.snapshot('g').openLoopCount).toBe(0)
  })

  it('收场记账后进入冷却，并记进当天次数', () => {
    let now = at(15)
    const gate = createProactiveGate({
      now: () => now,
      silenceLimits: { closerAfterMs: 60 * 60 * 1000 }
    })
    gate.markSpoke('g')
    now += 2 * 60 * 60 * 1000
    expect(gate.decideCloser('g').speak).toBe(true)

    gate.markClosed('g')
    expect(gate.snapshot('g').closerCount).toBe(1)
    expect(gate.snapshot('g').count).toBe(2)
    expect(gate.decideCloser('g').reason).toBe('not_yet')
  })

  it('收场不受当天开口额度拦住', () => {
    let now = at(15)
    const gate = createProactiveGate({
      now: () => now,
      silenceLimits: { closerAfterMs: 60 * 60 * 1000 }
    })
    // 先把三次主动额度用掉：收场是善后，不该因为没有额度就永远挂着。
    gate.markSpoke('g')
    now += 31 * 60 * 1000
    gate.markSpoke('g')
    now += 31 * 60 * 1000
    gate.markSpoke('g')

    now += 2 * 60 * 60 * 1000
    expect(gate.snapshot('g').count).toBe(3)
    expect(gate.decideCloser('g').speak).toBe(true)
  })

  it('只列出真的出现过的会话，遍历不会创建新条目', () => {
    const gate = createProactiveGate({ now: () => at(15) })
    expect(gate.scopes()).toEqual([])

    gate.markSpoke('qq:private:a')
    gate.markSpoke('qq:group:2')
    expect(gate.scopes().sort()).toEqual(['qq:group:2', 'qq:private:a'])
  })
})

describe('pickCloserLine', () => {
  it('按收场次数轮换', () => {
    expect(pickCloserLine(1)).toBe(CLOSER_LINES[0])
    expect(pickCloserLine(2)).toBe(CLOSER_LINES[1])
    expect(pickCloserLine(3)).toBe(CLOSER_LINES[2])
    expect(pickCloserLine(4)).toBe(CLOSER_LINES[0])
  })

  it('异常输入退回第一句，不抛错', () => {
    expect(pickCloserLine(0)).toBe(CLOSER_LINES[0])
    expect(pickCloserLine(-5)).toBe(CLOSER_LINES[0])
    expect(pickCloserLine(Number.NaN)).toBe(CLOSER_LINES[0])
  })

  it('每一句都不追问、不要回应', () => {
    for (const line of CLOSER_LINES) {
      expect(line).not.toMatch(/[？?]/)
      expect(line).not.toContain('不理我')
      expect(line).not.toContain('为什么不')
    }
  })
})

describe('跨会话撞车', () => {
  it('同一句话在另一个会话刚说过就判重', () => {
    const gate = createProactiveGate({ now: () => at(15) })
    gate.markSpoke('qq:group:1', '今天降温了，记得加件衣服')
    const hit = gate.findDuplicate('qq:group:2', '今天降温了，记得加件衣服')
    expect(hit.duplicate).toBe(true)
    expect(hit.scope).toBe('qq:group:1')
    expect(hit.similarity).toBe(1)
  })

  it('同一个会话自己重复不算撞车', () => {
    const gate = createProactiveGate({ now: () => at(15) })
    gate.markSpoke('qq:group:1', '今天降温了，记得加件衣服')
    expect(gate.findDuplicate('qq:group:1', '今天降温了，记得加件衣服').duplicate).toBe(false)
  })

  it('换了说法但意思一样，仍然判重', () => {
    const gate = createProactiveGate({ now: () => at(15) })
    gate.markSpoke('qq:group:1', '今天降温了，记得加件衣服')
    expect(gate.findDuplicate('qq:group:2', '今天降温了，记得加衣服').duplicate).toBe(true)
  })

  it('完全无关的句子放行', () => {
    const gate = createProactiveGate({ now: () => at(15) })
    gate.markSpoke('qq:group:1', '今天降温了，记得加件衣服')
    expect(gate.findDuplicate('qq:group:2', '你那边的项目进度怎么样了').duplicate).toBe(false)
  })

  it('过了时间窗就不再算撞车', () => {
    let now = at(15)
    const gate = createProactiveGate({ now: () => now, dedupe: { windowMs: 60 * 60 * 1000 } })
    gate.markSpoke('qq:group:1', '今天降温了，记得加件衣服')
    now += 61 * 60 * 1000
    expect(gate.findDuplicate('qq:group:2', '今天降温了，记得加件衣服').duplicate).toBe(false)
  })

  it('空句和单字不参与判重', () => {
    const gate = createProactiveGate({ now: () => at(15) })
    gate.markSpoke('qq:group:1', '好')
    expect(gate.findDuplicate('qq:group:2', '好').duplicate).toBe(false)
    expect(gate.findDuplicate('qq:group:2', '').duplicate).toBe(false)
  })

  it('表情标记和标点不影响判断', () => {
    const gate = createProactiveGate({ now: () => at(15) })
    gate.markSpoke('qq:group:1', '[[表情:开心]] 今天降温了，记得加件衣服！')
    expect(gate.findDuplicate('qq:group:2', '今天降温了 记得加件衣服').duplicate).toBe(true)
  })

  it('lineSimilarity 的边界', () => {
    expect(lineSimilarity('今天降温了', '今天降温了')).toBe(1)
    expect(lineSimilarity('今天降温了', '明天升温了')).toBeLessThan(0.5)
    expect(lineSimilarity('', '今天')).toBe(0)
    expect(lineSimilarity('好', '好')).toBe(0)
  })
})

describe('由头化开口', () => {
  it('具体的事优先：日程比没聊完的话头更靠前', () => {
    const cue = resolveOpeningCue({
      opening: { kind: 'agenda', reason: 'agenda', note: '下午要去一趟超市' },
      loop: { text: '上次那个项目怎么样了' },
      now: at(15),
      lastSpokeAt: at(14)
    })
    expect(cue.kind).toBe('agenda')
    expect(cue.strength).toBe('strong')
    expect(cue.note).toContain('超市')
  })

  it('没有日程时，没聊完的话头就是由头', () => {
    const cue = resolveOpeningCue({
      opening: null,
      loop: { text: '你昨天说的那件事后来怎么样了' },
      now: at(15),
      lastSpokeAt: at(14)
    })
    expect(cue.kind).toBe('loop')
    expect(cue.strength).toBe('strong')
  })

  it('什么都没发生、也才刚说过话，就没有由头', () => {
    expect(
      resolveOpeningCue({ opening: null, loop: null, now: at(15), lastSpokeAt: at(14, 30) })
    ).toBe(null)
  })

  it('隔得够久，「想说话」本身才算一个弱由头', () => {
    const cue = resolveOpeningCue({
      opening: null,
      loop: null,
      now: at(18),
      lastSpokeAt: at(15)
    })
    expect(cue.kind).toBe('social')
    expect(cue.strength).toBe('weak')
  })

  it('没有由头时不开口', () => {
    expect(decideByCue({ cue: null, now: at(15) })).toEqual({
      speak: false,
      reason: 'no_cue'
    })
  })

  it('有由头也要过冷却与静默时段', () => {
    const decided = decideByCue({
      cue: { kind: 'loop', note: '那个事', strength: 'strong' },
      now: at(15),
      lastSpokeAt: at(14, 50),
      limits: { minGapMs: 30 * 60_000 }
    })
    expect(decided.speak).toBe(false)
    expect(decided.reason).toBe('cooldown')

    const quiet = decideByCue({
      cue: { kind: 'loop', note: '那个事', strength: 'strong' },
      now: at(2)
    })
    expect(quiet.speak).toBe(false)
    expect(quiet.reason).toBe('quiet_hours')
  })

  it('由头通过时带上来源与分量', () => {
    const decided = decideByCue({
      cue: { kind: 'loop', note: '那个事', strength: 'strong', reason: 'open_loop' },
      now: at(15)
    })
    expect(decided.speak).toBe(true)
    expect(decided.reason).toBe('open_loop')
    expect(decided.score).toBe(3)
  })

  it('闸门记账后才进入冷却', () => {
    let now = at(15)
    const gate = createProactiveGate({ now: () => now })
    const cue = { kind: 'agenda', note: '下午去超市', strength: 'strong' }
    expect(gate.decideByCue('desktop', cue).speak).toBe(true)
    gate.markSpoke('desktop', '下午要去超市啦')
    now += 10 * 60_000
    expect(gate.decideByCue('desktop', cue).reason).toBe('cooldown')
  })
})
