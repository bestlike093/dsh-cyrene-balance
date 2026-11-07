import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../memory.mjs'
import { rankMemories } from '../memory-search.mjs'

const tempDirs = []

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-memory-decay-'))
  tempDirs.push(dir)
  return path.join(dir, 'memory.bin')
}

function makeStore(filePath, overrides = {}) {
  return createMemoryStore({
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

describe('记忆强化', () => {
  it('被反复想起来的条目在同分时排得更前', () => {
    const now = Date.now()
    const ranked = rankMemories(
      '美式',
      [
        { id: 'fresh', text: '用户爱喝美式', at: new Date(now).toISOString(), recallCount: 0 },
        { id: 'worn', text: '用户爱喝美式', at: new Date(now).toISOString(), recallCount: 20 }
      ],
      { now }
    )

    expect(ranked).toHaveLength(2)
    expect(ranked[0].id).toBe('worn')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    // 强化有上限：最多 +30%，不会把一条普通旧事抬成绝对优先。
    expect(ranked[0].score / ranked[1].score).toBeLessThanOrEqual(1.31)
  })

  it('检索命中会累加 recallCount，同一分钟内不重复计数', async () => {
    const store = makeStore(await tempFile())
    const at = Date.now()
    store.appendTurn('user', '以前爱喝美式', new Date(at - 86_400_000).toISOString())

    store.search('美式', { now: at })
    store.search('美式', { now: at + 10_000 })
    expect(store.list({ limit: 1 }).items[0].recallCount).toBe(1)

    store.search('美式', { now: at + 120_000 })
    expect(store.list({ limit: 1 }).items[0].recallCount).toBe(2)
  })
})

describe('主动遗忘', () => {
  it('冷了很久且没被想起来的原文会归档，事实与经验不动', async () => {
    const now = Date.now()
    const old = new Date(now - 200 * 86_400_000).toISOString()
    const filePath = await tempFile()
    await writeFile(
      filePath,
      JSON.stringify({
        version: 4,
        records: [
          { id: 'raw-old', role: 'user', text: '很久以前的闲聊', at: old, scope: 'desktop', layer: 'raw' },
          { id: 'raw-worn', role: 'user', text: '很久但常被想起', at: old, scope: 'desktop', layer: 'raw', recallCount: 6 },
          { id: 'fact-old', role: 'user', text: '用户住在重庆', at: old, scope: 'desktop', layer: 'fact' },
          { id: 'lesson-old', role: 'assistant', text: '报错先看退出码', at: old, scope: 'desktop', layer: 'lesson' }
        ]
      })
    )

    const store = makeStore(filePath)
    await store.load()
    const result = store.sweep(now)
    expect(result.archived).toBe(1)
    expect(result.ids).toEqual(['raw-old'])

    const items = store.list({ limit: 10 }).items
    expect(items.find((item) => item.id === 'raw-old').archived).toBe(true)
    expect(items.find((item) => item.id === 'raw-worn').archived).toBe(false)
    expect(items.find((item) => item.id === 'fact-old').archived).toBe(false)
    expect(items.find((item) => item.id === 'lesson-old').archived).toBe(false)
    expect(store.stats().archived).toBe(1)
  })

  it('归档记忆默认不参与检索，明确翻出来时会解冻', async () => {
    const now = Date.now()
    const old = new Date(now - 200 * 86_400_000).toISOString()
    const store = makeStore(await tempFile())
    store.appendTurn('user', '以前爱喝美式', old)
    store.sweep(now)

    expect(store.search('美式', { now })).toHaveLength(0)
    const revived = store.search('美式', { now, includeCold: true, includeArchived: true })
    expect(revived).toHaveLength(1)
    expect(store.list({ limit: 1 }).items[0].archived).toBe(false)
  })

  it('一次扫描最多归档 50 条，不会一口气清空', async () => {
    const now = Date.now()
    const old = new Date(now - 200 * 86_400_000).toISOString()
    const store = makeStore(await tempFile())
    for (let index = 0; index < 60; index += 1) {
      store.appendTurn('user', `旧闲聊 ${index}`, old)
    }

    expect(store.sweep(now).archived).toBe(50)
    expect(store.sweep(now).archived).toBe(10)
    expect(store.stats().archived).toBe(60)
  })

  it('手动归档与取回会写进密文并读回来', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    store.appendTurn('user', '一句话')
    const id = store.list({ limit: 1 }).items[0].id

    expect(store.setArchived(id, true)).toEqual({ ok: true, id, archived: true })
    expect(store.list({ includeArchived: false }).total).toBe(0)
    expect(await store.flush()).toBe(true)

    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    expect(saved.version).toBe(5)
    expect(saved.records[0].archived).toBe(true)

    const reopened = makeStore(filePath)
    await reopened.load()
    expect(reopened.list({ limit: 1 }).items[0].archived).toBe(true)
    expect(reopened.setArchived(id, false).archived).toBe(false)
    expect(reopened.setArchived('missing', true)).toMatchObject({ ok: false, reason: 'not-found' })
  })
})
