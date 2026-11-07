import { describe, expect, it, vi } from 'vitest'
import {
  ENERGY_COST,
  INITIATIVE_MIN,
  SAFE_LINES,
  capByAffection,
  capTone,
  createIntimacyGate,
  initiativeOf,
  levelOf
} from '../intimacy.mjs'

const HOUR = 60 * 60 * 1000

function onSettings(extra = {}) {
  return { companion: { intimacy: { enabled: true, perDay: 2, cooldownHours: 6, ...extra } } }
}

/** 用本地时间构造，跨时区跑测试也不会在日期边界上翻车。 */
function at(hour, minute = 0) {
  return new Date(2026, 10, 7, hour, minute).getTime()
}

describe('贴近时刻', () => {
  it('默认关闭：开关没开就一次也不出现', () => {
    const gate = createIntimacyGate({ now: () => at(2) })
    const verdict = gate.check({ settings: {}, scope: 'desktop', userText: '抱抱' })
    expect(verdict).toMatchObject({ open: false, reason: 'disabled' })
  })

  it('群聊与 QQ 私聊都不触发', () => {
    const gate = createIntimacyGate({ now: () => at(2) })
    expect(gate.check({ settings: onSettings(), scope: 'qq:group:123', userText: '抱抱' }).reason).toBe(
      'scenario'
    )
    expect(gate.check({ settings: onSettings(), scope: 'qq:private:456', userText: '抱抱' }).reason).toBe(
      'scenario'
    )
  })

  it('对方主动要，桌面本机才打开', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱我' })).toMatchObject({
      open: true,
      cue: 'invited'
    })
  })

  it('白天随口一句没有由头，不主动贴近', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '今天吃什么' }).reason).toBe(
      'no-cue'
    )
  })

  it('夜色与疲惫都算由头', () => {
    const late = createIntimacyGate({ now: () => at(23, 30) })
    expect(late.check({ settings: onSettings(), scope: 'desktop', userText: '在吗' }).cue).toBe('late')
    const tired = createIntimacyGate({ now: () => at(15) })
    expect(tired.check({ settings: onSettings(), scope: 'desktop', userText: '好累' }).cue).toBe('tired')
  })

  it('一天两次、中间冷却六小时', () => {
    // 从凌晨一点起算，后面几个时间点都落在同一天里。
    const first = at(1)
    let current = first
    const gate = createIntimacyGate({ now: () => current })

    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).open).toBe(true)
    gate.noteOpen(first)
    // 场景进行中不受冷却约束；先收场，冷却才开始算。
    gate.noteExit(first)

    current = first + HOUR
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).reason).toBe(
      'cooldown'
    )

    current = first + 7 * HOUR
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).open).toBe(true)
    gate.noteOpen(current)
    gate.noteExit(current)

    current = first + 15 * HOUR
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).reason).toBe(
      'daily-cap'
    )
  })

  it('过了零点重新计数', () => {
    const first = at(23, 30)
    let current = first
    const gate = createIntimacyGate({ now: () => current })
    gate.noteOpen(first)
    gate.noteOpen(first + HOUR)
    // 同一场跨过零点，仍算前一天那一次；一场只计一次。
    expect(gate.snapshot().count).toBe(1)

    current = first + 24 * HOUR
    // 跨天一天没说话，亲近欲已经回落；这里显式给足，只验证「计数归零」。
    expect(
      gate.check({
        settings: onSettings(),
        scope: 'desktop',
        userText: '抱抱',
        desire: 44,
        desireBase: 34
      }).open
    ).toBe(true)
    // 新的一天从头计数：判断本身不记账，真正说出口才计。
    expect(gate.snapshot().count).toBe(0)
  })

  it('阶段按轮数推进：靠近→依偎→临界→爆发→余韵', () => {
    const current = at(15)
    const gate = createIntimacyGate({ now: () => current })
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).tone).toBe('soft')

    gate.noteTurn(current)
    gate.noteTurn(current)
    expect(gate.check({ settings: onSettings(), scope: 'desktop' })).toMatchObject({
      stage: 'lean',
      tone: 'close'
    })

    gate.noteTurn(current)
    gate.noteTurn(current)
    gate.noteTurn(current)
    expect(gate.check({ settings: onSettings(), scope: 'desktop' })).toMatchObject({
      stage: 'edge',
      tone: 'edge'
    })

    gate.noteTurn(current)
    gate.noteTurn(current)
    gate.noteTurn(current)
    expect(gate.check({ settings: onSettings(), scope: 'desktop' })).toMatchObject({
      stage: 'peak',
      tone: 'peak'
    })

    gate.noteTurn(current)
    gate.noteTurn(current)
    const after = gate.check({ settings: onSettings(), scope: 'desktop' })
    expect(after.reason).toBe('afterglow')
    expect(after.tone).toBe('warm')
  })

  it('亲近欲到 38 且比基线涨够 4 点才开', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    const base = gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      desire: 30,
      desireBase: 20
    })
    expect(base.reason).toBe('desire-low')

    const flat = gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      desire: 40,
      desireBase: 38
    })
    expect(flat.reason).toBe('desire-flat')

    const ok = gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      desire: 40,
      desireBase: 34
    })
    expect(ok.open).toBe(true)
  })

  it('三档按当天涨幅分：收着 / 擦边 / 深入', () => {
    expect(levelOf(0)).toBe('repress')
    expect(levelOf(3)).toBe('repress')
    expect(levelOf(4)).toBe('flirt')
    expect(levelOf(11)).toBe('flirt')
    expect(levelOf(12)).toBe('deep')
    expect(levelOf(30)).toBe('deep')
  })

  it('超出档位的语气会被截回去', () => {
    expect(capTone('peak', 'flirt')).toBe('edge')
    expect(capTone('close', 'repress')).toBe('soft')
    expect(capTone('edge', 'deep')).toBe('edge')
    expect(capTone('soft', 'repress')).toBe('soft')
  })

  it('场景里越聊越深，档位跟着涨幅走', () => {
    const current = at(15)
    const gate = createIntimacyGate({ now: () => current })
    const opened = gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' })
    expect(opened).toMatchObject({ open: true, level: 'flirt' })

    gate.noteTurn(current)
    gate.noteTurn(current)
    // 两轮之后涨幅到 12，进深入档。
    expect(gate.check({ settings: onSettings(), scope: 'desktop' }).level).toBe('deep')
  })

  it('人设未成年或血缘时整条关闭', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    const minor = gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      personaText: '她今年14岁。'
    })
    expect(minor.reason).toBe('safety')
    const incest = gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      personaText: '他们是亲兄妹。'
    })
    expect(incest.reason).toBe('safety')
  })

  it('三百岁的设定不会被年龄闸误伤', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    const verdict = gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      personaText: '她是活了300岁的神。'
    })
    expect(verdict.open).toBe(true)
  })

  it('精力见底就不硬来', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    expect(
      gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱', energy: 12 }).reason
    ).toBe('spent')
  })

  it('公开版：红线更严、提示词更克制', async () => {
    const { promptsFor, redlineFor } = await import('../intimacy.mjs')
    expect(promptsFor('public').close).toContain('不写身体部位的细节')
    expect(promptsFor('qiqi').close).toContain('不必回避身体')
    expect(promptsFor('public').edge).toContain('不写器官')
    expect(promptsFor('qiqi').edge).not.toContain('不写器官')

    const publicRules = redlineFor('public')
    const qiqiRules = redlineFor('qiqi')
    expect(publicRules.some((re) => re.test('她解开衣扣'))).toBe(true)
    expect(qiqiRules.some((re) => re.test('她解开衣扣'))).toBe(false)
  })

  it('公开版：即使开关打开也整条不生效', async () => {
    vi.resetModules()
    process.env.CYRENE_INTIMACY_EDITION = 'public'
    try {
      const mod = await import('../intimacy.mjs?edition=public')
      const gate = mod.createIntimacyGate({ now: () => at(15) })
      const verdict = gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' })
      expect(verdict).toMatchObject({ open: false, reason: 'edition' })
    } finally {
      delete process.env.CYRENE_INTIMACY_EDITION
      vi.resetModules()
    }
  })

  it('红线命中就整句退回安全台词', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    const filtered = gate.filterReply('她还是未成年，这样不行。')
    expect(filtered.ok).toBe(false)
    expect(SAFE_LINES).toContain(filtered.text)
  })

  it('日常句子不会被误伤', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    expect(gate.filterReply('靠一会儿就好，胸口有点闷。')).toMatchObject({ ok: true })
  })

  it('只记次数，不记说了什么', () => {
    const written = []
    const gate = createIntimacyGate({
      file: 'intimacy.json',
      fs: {
        readFileSync: () => {
          throw new Error('missing')
        },
        writeFileSync: (_path, data) => written.push(String(data))
      },
      now: () => at(15)
    })
    gate.noteOpen(at(15))
    gate.flush()

    expect(written).toHaveLength(1)
    const saved = JSON.parse(written[0])
    expect(saved.count).toBe(1)
    expect(written[0]).not.toContain('抱抱')
  })

  it('被推开之后安静三十分钟，不追着哄', () => {
    const first = at(15)
    let current = first
    const gate = createIntimacyGate({ now: () => current })
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).open).toBe(true)
    gate.noteExit(first)

    current = first + 20 * 60 * 1000
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).reason).toBe(
      'refused'
    )

    current = first + 40 * 60 * 1000
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).open).toBe(true)
  })

  it('亲近欲顶到满值时，不再要求涨幅', () => {
    const gate = createIntimacyGate({ now: () => at(15) })
    const verdict = gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      desire: 50,
      desireBase: 50
    })
    expect(verdict.open).toBe(true)
  })

  it('被冷却挡住时，不在背后继续攒亲近欲', () => {
    const first = at(1)
    let current = first
    const gate = createIntimacyGate({ now: () => current })
    gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' })
    gate.noteOpen(first)
    gate.noteExit(first)

    const before = gate.snapshot().desire
    current = first + HOUR
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' }).reason).toBe(
      'cooldown'
    )
    expect(gate.snapshot().desire).toBe(before)
  })

  it('深入档 + 亲近关系 + 有精神，才由她先动', () => {
    expect(
      initiativeOf({ desire: 48, desireBase: 36, energy: 80, tier: 'close' })
    ).toBeGreaterThanOrEqual(INITIATIVE_MIN)
    expect(initiativeOf({ desire: 48, desireBase: 36, energy: 32, tier: 'close' })).toBeLessThan(
      INITIATIVE_MIN
    )

    const current = at(15)
    const gate = createIntimacyGate({ now: () => current })
    gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      relationTier: 'close',
      energy: 80
    })
    gate.noteTurn(current)
    gate.noteTurn(current)

    const deep = gate.check({
      settings: onSettings(),
      scope: 'desktop',
      relationTier: 'close',
      energy: 80
    })
    expect(deep).toMatchObject({ level: 'deep', proactive: true })
    expect(gate.promptFor(deep.tone, deep.proactive)).toContain('她先动')
    // 只换措辞，档位本身没有被抬高。
    expect(deep.tone).toBe(gate.check({ settings: onSettings(), scope: 'desktop' }).tone)
  })

  it('精神不足时不会由她先动', () => {
    const current = at(15)
    const gate = createIntimacyGate({ now: () => current })
    gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      relationTier: 'close',
      energy: 32
    })
    gate.noteTurn(current)
    gate.noteTurn(current)
    expect(
      gate.check({ settings: onSettings(), scope: 'desktop', relationTier: 'close', energy: 32 })
    ).toMatchObject({ level: 'deep', proactive: false })
  })

  it('走完最后一段会回报收场与消耗', () => {
    const current = at(15)
    const gate = createIntimacyGate({ now: () => current })
    gate.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱' })
    for (let i = 0; i < 9; i += 1) gate.noteTurn(current)
    expect(gate.noteTurn(current)).toMatchObject({ ended: true, energyCost: ENERGY_COST })
  })

  it('隔了几个小时再说话，会当作久别', () => {
    const first = at(15)
    let current = first
    const gate = createIntimacyGate({ now: () => current })
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '在吗' }).reason).toBe(
      'no-cue'
    )

    current = first + 5 * HOUR
    expect(gate.check({ settings: onSettings(), scope: 'desktop', userText: '在吗' }).cue).toBe(
      'return'
    )
  })

  it('关系档决定最深到哪：生疏只并肩，眼熟只擦边', () => {
    const cold = createIntimacyGate({ now: () => at(15) })
    expect(
      cold.check({ settings: onSettings(), scope: 'desktop', userText: '抱抱', relationTier: 'distant' })
    ).toMatchObject({ open: true, level: 'repress', tone: 'soft' })

    const current = at(15)
    const familiar = createIntimacyGate({ now: () => current })
    familiar.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      relationTier: 'familiar'
    })
    familiar.noteTurn(current)
    familiar.noteTurn(current)
    expect(
      familiar.check({ settings: onSettings(), scope: 'desktop', relationTier: 'familiar' }).level
    ).toBe('flirt')
  })

  it('好感数值按上游的 50 / 75 两道门槛压档', () => {
    expect(capByAffection(30)).toBe('repress')
    expect(capByAffection(50)).toBe('flirt')
    expect(capByAffection(74)).toBe('flirt')
    expect(capByAffection(75)).toBe('deep')
    expect(capByAffection(Number.NaN)).toBe('deep')

    const current = at(15)
    const gate = createIntimacyGate({ now: () => current })
    gate.check({
      settings: onSettings(),
      scope: 'desktop',
      userText: '抱抱',
      relationTier: 'close',
      relationFavor: 60
    })
    gate.noteTurn(current)
    gate.noteTurn(current)
    // 关系名义上很近，但好感只有 60，压回擦边。
    expect(
      gate.check({ settings: onSettings(), scope: 'desktop', relationTier: 'close', relationFavor: 60 })
        .level
    ).toBe('flirt')
  })

  it('散场时长跟着设置走：调成 1 小时，就 1 小时散场', () => {
    const first = at(15)
    let current = first
    const gate = createIntimacyGate({ now: () => current })
    const tight = onSettings({ idleHours: 1 })
    gate.noteOpen(first)
    gate.noteTurn(first)
    gate.noteTurn(first)

    current = first + 30 * 60 * 1000
    expect(gate.check({ settings: tight, scope: 'desktop' }).reason).toBe('continuing')

    current = first + 61 * 60 * 1000
    const gone = gate.check({ settings: tight, scope: 'desktop' })
    expect(gone.reason).not.toBe('continuing')
    expect(gone.stage).not.toBe('lean')
  })

  it('默认散场是 6 小时：5 小时的时候还留着', () => {
    const first = at(15)
    let current = first
    const gate = createIntimacyGate({ now: () => current })
    gate.noteOpen(first)
    gate.noteTurn(first)
    gate.noteTurn(first)

    current = first + 5 * HOUR
    expect(gate.check({ settings: onSettings(), scope: 'desktop' }).reason).toBe('continuing')
  })

  it('余韵时长跟着设置走：调成 5 分钟，5 分钟后就凉了', () => {
    const first = at(15)
    let current = first
    const gate = createIntimacyGate({ now: () => current })
    const short = onSettings({ aftercareMinutes: 5 })
    gate.noteOpen(first)
    for (let i = 0; i < 10; i += 1) gate.noteTurn(first)
    expect(gate.check({ settings: short, scope: 'desktop' }).reason).toBe('afterglow')

    current = first + 4 * 60 * 1000
    expect(gate.check({ settings: short, scope: 'desktop' }).reason).toBe('afterglow')

    current = first + 6 * 60 * 1000
    expect(gate.check({ settings: short, scope: 'desktop' }).reason).not.toBe('afterglow')
  })
})
