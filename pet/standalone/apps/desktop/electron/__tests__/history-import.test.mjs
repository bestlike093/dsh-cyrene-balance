import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFactStore } from '../memory-facts.mjs'
import {
  chunkMessages,
  collectHistoryCandidates,
  extractClaim,
  importHistoryCandidates,
  summarizeChunk
} from '../history-import.mjs'

const tempDirs = []

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-history-'))
  tempDirs.push(dir)
  return path.join(dir, 'facts.bin')
}

function makeStore(filePath) {
  return createFactStore({
    filePath,
    seal: async (value) => value,
    open: async (sealed) => new TextEncoder().encode(JSON.stringify(sealed)),
    log: vi.fn()
  })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('extractClaim', () => {
  it('把「我喜欢」整理成不带第一人称的事实', () => {
    expect(extractClaim('我很喜欢冰美式')).toEqual({
      kind: 'preference',
      text: '喜欢冰美式',
      raw: '我很喜欢冰美式'
    })
  })

  it('先认「不喜欢」，不被「喜欢」吃掉', () => {
    expect(extractClaim('我不喜欢吃香菜')?.text).toBe('不喜欢吃香菜')
  })

  it('正在做的事记成项目', () => {
    expect(extractClaim('我在做桌面宠物')).toEqual({
      kind: 'project',
      text: '在做桌面宠物',
      raw: '我在做桌面宠物'
    })
  })

  it('宠物名字单独记，并保留是猫还是狗', () => {
    expect(extractClaim('我的猫叫团子')?.text).toBe('养的猫叫团子')
    expect(extractClaim('我养狗叫阿黄')?.text).toBe('养的狗叫阿黄')
  })

  it('问句不抽成事实', () => {
    expect(extractClaim('我喜欢猫吗？')).toBeNull()
  })

  it('说对方的话不往自己身上记', () => {
    expect(extractClaim('我喜欢你笑的样子')).toBeNull()
  })

  it('普通闲聊不产生候选', () => {
    expect(extractClaim('今天好热啊')).toBeNull()
    expect(extractClaim('')).toBeNull()
  })
})

describe('collectHistoryCandidates', () => {
  it('只看用户自己的话，跳过回复', () => {
    const candidates = collectHistoryCandidates([
      { role: 'user', content: '我喜欢冰美式' },
      { role: 'assistant', content: '我喜欢记住这件事' }
    ])

    expect(candidates).toHaveLength(1)
    expect(candidates[0].text).toBe('喜欢冰美式')
  })

  it('同一件事反复说只留一条', () => {
    const candidates = collectHistoryCandidates([
      { text: '我喜欢冰美式' },
      { text: '我真的很喜欢冰美式' }
    ])

    expect(candidates).toHaveLength(1)
  })

  it('候选默认标成「被问到再说」，不主动翻旧账', () => {
    const [candidate] = collectHistoryCandidates([{ content: '我在学日语' }])

    expect(candidate.mentionPolicy).toBe('on_request')
    expect(candidate.confidence).toBeLessThan(0.7)
  })

  it('limit 限制一次导入的条数', () => {
    const messages = [
      { content: '我喜欢冰美式' },
      { content: '我喜欢拿铁' },
      { content: '我在学日语' }
    ]

    expect(collectHistoryCandidates(messages, { limit: 2 })).toHaveLength(2)
  })
})

describe('分片与概况', () => {
  it('按条数切段，末尾不足一段也保留', () => {
    const chunks = chunkMessages([1, 2, 3, 4, 5], 2)

    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2, 1])
  })

  it('概况只统计用户的话，并给出反复出现的词', () => {
    const summary = summarizeChunk([
      { role: 'user', content: '桌面宠物又崩了' },
      { role: 'user', content: '桌面宠物启动很慢' },
      { role: 'assistant', content: '桌面宠物' },
      { role: 'user', content: '' }
    ])

    expect(summary.userTurns).toBe(2)
    expect(summary.assistantTurns).toBe(1)
    expect(summary.topics).toContain('桌面')
  })
})

describe('importHistoryCandidates', () => {
  it('第一次导入写入记忆，并标明来自历史聊天', async () => {
    const store = makeStore(await tempFile())
    const result = await importHistoryCandidates({
      messages: [{ role: 'user', content: '我喜欢冰美式' }],
      factStore: store,
      scope: 'desktop',
      at: () => 5_000
    })

    expect(result.added).toBe(1)
    const [fact] = store.snapshot('desktop').facts
    expect(fact.text).toBe('喜欢冰美式')
    expect(fact.source).toBe('history:desktop')
    expect(fact.mentionPolicy).toBe('on_request')
    expect(fact.evidence).toBe('我喜欢冰美式')
  })

  it('再跑一次不会重复写入，也不把强度刷高', async () => {
    const store = makeStore(await tempFile())
    const options = {
      messages: [{ role: 'user', content: '我喜欢冰美式' }],
      factStore: store,
      scope: 'desktop',
      at: () => 5_000
    }
    await importHistoryCandidates(options)
    const firstStrength = store.snapshot('desktop').facts[0].strength

    const second = await importHistoryCandidates(options)

    expect(second.added).toBe(0)
    expect(second.skipped).toBe(1)
    expect(store.snapshot('desktop').facts[0].strength).toBe(firstStrength)
  })

  it('没有历史时安静返回', async () => {
    const store = makeStore(await tempFile())
    const result = await importHistoryCandidates({ messages: [], factStore: store })

    expect(result.ok).toBe(true)
    expect(result.added).toBe(0)
  })
})
