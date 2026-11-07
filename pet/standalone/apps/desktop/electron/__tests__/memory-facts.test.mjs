import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFactStore } from '../memory-facts.mjs'

const tempDirs = []
const DAY = 86_400_000

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-facts-'))
  tempDirs.push(dir)
  return path.join(dir, 'facts.bin')
}

function makeStore(filePath, overrides = {}) {
  return createFactStore({
    filePath,
    seal: async (value) => value,
    open: async (sealed) => new TextEncoder().encode(JSON.stringify(sealed)),
    log: vi.fn(),
    ...overrides
  })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('结构化记忆的来源与置信度', () => {
  it('新事实保留来源与模型给的置信度', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert(
      [{ kind: 'preference', text: '喜欢冰美式', confidence: 0.4, source: 'qq:private:u1' }],
      1_000,
      'desktop'
    )

    const [fact] = store.snapshot().facts
    expect(fact.confidence).toBeCloseTo(0.4)
    expect(fact.source).toBe('qq:private:u1')
  })

  it('模型没给置信度时按 0.7 起步', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert([{ kind: 'preference', text: '喜欢冰美式' }], 1_000, 'desktop')

    expect(store.snapshot().facts[0].confidence).toBeCloseTo(0.7)
  })

  it('同一件事再次出现时取更高的置信度，来源不被空值覆盖', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert(
      [{ kind: 'preference', text: '喜欢冰美式', confidence: 0.4, source: 'desktop' }],
      1_000,
      'desktop'
    )
    store.upsert([{ kind: 'preference', text: '喜欢冰美式', confidence: 0.9 }], 1_100, 'desktop')

    const facts = store.snapshot().facts
    expect(facts).toHaveLength(1)
    expect(facts[0].confidence).toBeCloseTo(0.9)
    expect(facts[0].source).toBe('desktop')
  })

  it('低置信度且 30 天没再被确认，会归档', async () => {
    const store = makeStore(await tempFile(), { now: () => 0 })
    store.upsert([{ kind: 'preference', text: '猜测的偏好', confidence: 0.2 }], 0, 'desktop')

    store.decay(31 * DAY)

    expect(store.snapshot().archived).toBe(1)
    expect(store.snapshot().active).toBe(0)
  })

  it('高置信度的事实 30 天时仍在，不提前归档', async () => {
    const store = makeStore(await tempFile(), { now: () => 0 })
    store.upsert([{ kind: 'preference', text: '确定的偏好', confidence: 0.9 }], 0, 'desktop')

    store.decay(31 * DAY)

    expect(store.snapshot().archived).toBe(0)
    expect(store.snapshot().active).toBe(1)
  })

  it('lesson 是合法分类，并会在提示词里单独成组', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert([{ kind: 'lesson', text: '对方纠正过：不是周六，是周日' }], 1_000, 'desktop')
    const digest = store.digest({ scope: 'desktop' })
    expect(digest).toContain('对方纠正过你的')
    expect(digest).toContain('不是周六，是周日')
  })
})

describe('结构化记忆：改口', () => {
  it('带 supersedes 时归档旧说法，只留下新的那条', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert([{ kind: 'preference', text: '喜欢喝咖啡' }], 1_000, 'desktop')
    const result = store.upsert(
      [
        {
          kind: 'preference',
          text: '现在改喝无糖茶了',
          supersedes: '喜欢喝咖啡'
        }
      ],
      2_000,
      'desktop'
    )

    expect(result.superseded).toBe(1)
    const snapshot = store.snapshot('desktop')
    expect(snapshot.active).toBe(1)
    expect(snapshot.archived).toBe(1)
    expect(snapshot.facts.find((fact) => !fact.archived).text).toBe('现在改喝无糖茶了')
  })

  it('没有 supersedes 时照旧合并，不会误伤其他偏好', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert([{ kind: 'preference', text: '喜欢喝咖啡' }], 1_000, 'desktop')
    store.upsert([{ kind: 'preference', text: '喜欢喝冰美式' }], 1_100, 'desktop')

    expect(store.snapshot('desktop').archived).toBe(0)
    expect(store.snapshot('desktop').active).toBe(2)
  })

  it('改口只影响同一个作用域，别的渠道记得的事不动', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert([{ kind: 'preference', text: '喜欢喝咖啡' }], 1_000, 'desktop')
    store.upsert(
      [{ kind: 'preference', text: '不喜欢喝咖啡了', supersedes: '喜欢喝咖啡' }],
      2_000,
      'qq:private:u1'
    )

    expect(store.snapshot('desktop').archived).toBe(0)
    expect(store.snapshot('desktop').active).toBe(1)
  })
})

describe('结构化记忆：提及策略', () => {
  it('默认随时可提，私聊和群聊都带上', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert([{ kind: 'preference', text: '喜欢喝冰美式' }], 1_000, 'desktop')

    expect(store.digest({ scope: 'desktop', context: 'private' })).toContain('喜欢喝冰美式')
    expect(store.digest({ scope: 'desktop', context: 'group' })).toContain('喜欢喝冰美式')
  })

  it('on_request 在群里被挡下，私聊里单独分组提醒别主动提', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert(
      [{ kind: 'preference', text: '最近在做胃镜检查', mentionPolicy: 'on_request' }],
      1_000,
      'desktop'
    )

    expect(store.digest({ scope: 'desktop', context: 'group' })).toBe('')
    const privateNote = store.digest({ scope: 'desktop', context: 'private' })
    expect(privateNote).toContain('对方问起时再说')
    expect(privateNote).toContain('最近在做胃镜检查')
  })

  it('never 哪儿都不主动提', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert(
      [{ kind: 'person', text: '同事的父亲住院了，别跟别人讲', mentionPolicy: 'never' }],
      1_000,
      'desktop'
    )

    expect(store.digest({ scope: 'desktop', context: 'group' })).toBe('')
    expect(store.digest({ scope: 'desktop', context: 'private' })).toBe('')
  })

  it('提及策略只往更严的方向走，不会被后续默认值冲掉', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert(
      [{ kind: 'preference', text: '最近在做胃镜检查', mentionPolicy: 'on_request' }],
      1_000,
      'desktop'
    )
    store.upsert([{ kind: 'preference', text: '最近在做胃镜检查' }], 1_100, 'desktop')
    expect(store.snapshot('desktop').facts[0].mentionPolicy).toBe('on_request')

    store.upsert(
      [{ kind: 'preference', text: '最近在做胃镜检查', mentionPolicy: 'never' }],
      1_200,
      'desktop'
    )
    expect(store.snapshot('desktop').facts[0].mentionPolicy).toBe('never')
  })

  it('soft_echo 在私聊里只进语气分组，不混进能直说的条目', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert(
      [{ kind: 'person', text: '家里最近有点事', mentionPolicy: 'soft_echo' }],
      1_000,
      'desktop'
    )

    const digest = store.digest({ scope: 'desktop', context: 'private' })
    expect(digest).toContain('可以放在语气里')
    expect(digest).toContain('家里最近有点事')
    expect(digest).not.toContain('你身边的人：')
  })

  it('soft_echo 在群里完全不出现', async () => {
    const store = makeStore(await tempFile(), { now: () => 1_000 })
    store.upsert(
      [{ kind: 'person', text: '家里最近有点事', mentionPolicy: 'soft_echo' }],
      1_000,
      'desktop'
    )

    expect(store.digest({ scope: 'desktop', context: 'group' })).toBe('')
  })
})

describe('结构化记忆：JSONL 备份', () => {
  it('导出再导入是一次完整还原，作用域和提及策略都跟着走', async () => {
    const first = makeStore(await tempFile(), { now: () => 5_000 })
    first.upsert(
      [{ kind: 'preference', text: '喜欢喝冰美式', confidence: 0.9, source: 'chat' }],
      1_000,
      'desktop'
    )
    first.upsert(
      [{ kind: 'person', text: '同事的父亲住院了', mentionPolicy: 'never' }],
      1_000,
      'qq:group:g1'
    )
    const jsonl = first.exportJsonl({ scope: 'all' })
    expect(jsonl.split('\n')).toHaveLength(2)

    const second = makeStore(await tempFile(), { now: () => 6_000 })
    const result = second.importJsonl(jsonl)
    expect(result).toMatchObject({ ok: true, added: 2, merged: 0, skipped: 0, invalid: 0 })

    const facts = second.snapshot().facts
    expect(facts.map((fact) => fact.scope).sort()).toEqual(['desktop', 'qq:group:g1'])
    expect(facts.find((fact) => fact.scope === 'qq:group:g1').mentionPolicy).toBe('never')
    expect(facts.find((fact) => fact.scope === 'desktop').source).toBe('chat')
  })

  it('同 id 再来一次就跳过，重复导入不会越导越多', async () => {
    const store = makeStore(await tempFile(), { now: () => 5_000 })
    store.upsert([{ kind: 'preference', text: '喜欢喝冰美式' }], 1_000, 'desktop')
    const jsonl = store.exportJsonl()

    const result = store.importJsonl(jsonl)
    expect(result).toMatchObject({ ok: true, added: 0, skipped: 1 })
    expect(store.snapshot().total).toBe(1)
  })

  it('坏行只计数，不拖垮整份导入', async () => {
    const store = makeStore(await tempFile(), { now: () => 5_000 })
    const jsonl = [
      '这不是 JSON',
      JSON.stringify({ kind: 'preference', text: '喜欢喝冰美式' }),
      JSON.stringify({ kind: '不存在的分类', text: '被丢掉' }),
      JSON.stringify({ kind: 'project', text: '' })
    ].join('\n')

    const result = store.importJsonl(jsonl)
    expect(result).toMatchObject({ ok: true, added: 1, invalid: 3 })
    expect(store.snapshot().total).toBe(1)
  })

  it('同作用域里说法相近的合并，别的渠道不受影响', async () => {
    const store = makeStore(await tempFile(), { now: () => 5_000 })
    store.upsert([{ kind: 'preference', text: '喜欢喝咖啡' }], 1_000, 'desktop')
    store.upsert([{ kind: 'preference', text: '喜欢喝咖啡' }], 1_000, 'qq:private:u1')

    const jsonl = JSON.stringify({
      kind: 'preference',
      text: '喜欢喝咖啡',
      scope: 'desktop',
      strength: 0.9
    })
    const result = store.importJsonl(jsonl, { at: 5_000 })
    expect(result).toMatchObject({ ok: true, added: 0, merged: 1 })
    expect(store.snapshot().active).toBe(2)
  })
})

describe('断言层：时效与证据', () => {
  it('过了有效期的说法不再进入提示词', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert(
      [{ kind: 'project', text: '在做桌面宠物', evidence: '我在做桌宠', validTo: 5_000 }],
      1_000,
      'desktop'
    )

    expect(store.digest({ scope: 'desktop' })).toBe('')
  })

  it('还没到生效时间的说法也不出现', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert(
      [{ kind: 'project', text: '下个月开始学吉他', evidence: '下个月开始学吉他', validFrom: 20_000 }],
      1_000,
      'desktop'
    )

    expect(store.digest({ scope: 'desktop' })).toBe('')
  })

  it('没有原话、把握也不够的，私聊里只作待确认', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert([{ kind: 'preference', text: '可能喜欢猫', confidence: 0.3 }], 1_000, 'desktop')

    const text = store.digest({ scope: 'desktop' })
    expect(text).toContain('还没确认过')
    expect(text).toContain('可能喜欢猫')
  })

  it('群里不端出没确认过的猜测', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert([{ kind: 'preference', text: '可能喜欢猫', confidence: 0.3 }], 1_000, 'desktop')

    expect(store.digest({ scope: 'desktop', context: 'group' })).toBe('')
  })

  it('有原话作证的，低把握也照常进提示词', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert(
      [{ kind: 'preference', text: '喜欢冰美式', confidence: 0.3, evidence: '我每天都喝冰美式' }],
      1_000,
      'desktop'
    )

    const text = store.digest({ scope: 'desktop' })
    expect(text).toContain('喜欢冰美式')
    expect(text).not.toContain('还没确认过')
  })

  it('时间边界与证据会被保存，旧说法合并时不覆盖第一次记下的', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert(
      [{ kind: 'project', text: '在做桌面宠物', evidence: '第一句原话', validFrom: 1_000 }],
      1_000,
      'desktop'
    )
    store.upsert(
      [{ kind: 'project', text: '在做桌面宠物', evidence: '后来的转述', validFrom: 2_000 }],
      2_000,
      'desktop'
    )

    const [fact] = store.snapshot().facts
    expect(fact.evidence).toBe('第一句原话')
    expect(fact.validFrom).toBe(1_000)
  })
})

describe('被否认后的提及降级', () => {
  it('刚端出去的事被否认，只往后退一格', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert([{ kind: 'preference', text: '喜欢冰美式' }], 1_000, 'desktop')
    store.digest({ scope: 'desktop' })

    const result = store.noteDenial({ at: 10_100 })

    expect(result.ok).toBe(true)
    expect(result.before).toBe('free')
    expect(result.after).toBe('soft_echo')
    expect(store.snapshot().facts[0].mentionPolicy).toBe('soft_echo')
  })

  it('连着被否认才一路退到 never，再否认不再变化', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert([{ kind: 'preference', text: '喜欢冰美式' }], 1_000, 'desktop')

    store.digest({ scope: 'desktop' })
    const first = store.noteDenial({ at: 10_100 })
    store.digest({ scope: 'desktop' })
    const second = store.noteDenial({ at: 10_200 })
    store.digest({ scope: 'desktop' })
    const third = store.noteDenial({ at: 10_300 })
    const fourth = store.noteDenial({ id: third.id, at: 10_400 })

    expect([first.after, second.after, third.after]).toEqual([
      'soft_echo',
      'on_request',
      'never'
    ])
    expect(fourth.ok).toBe(false)
    expect(fourth.reason).toBe('already-last')
  })

  it('这一轮什么都没端出去时，否认不会误伤别的记忆', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert([{ kind: 'preference', text: '喜欢冰美式' }], 1_000, 'desktop')

    const result = store.noteDenial({ at: 10_100 })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nothing-surfaced')
    expect(store.snapshot().facts[0].mentionPolicy).toBe('free')
  })

  it('隔了太久也不再算「刚才提到的那条」', async () => {
    const store = makeStore(await tempFile(), { now: () => 10_000 })
    store.upsert([{ kind: 'preference', text: '喜欢冰美式' }], 1_000, 'desktop')
    store.digest({ scope: 'desktop' })

    const result = store.noteDenial({ at: 10_000 + 31 * 60 * 1000 })

    expect(result.reason).toBe('nothing-surfaced')
    expect(store.snapshot().facts[0].mentionPolicy).toBe('free')
  })
})
