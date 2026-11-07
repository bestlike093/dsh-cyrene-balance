import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemeDictionary } from '../meme-dictionary.mjs'

const tempDirs = []
const DAY = 86_400_000
const SCOPE = 'qq:group:g1'

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-meme-dict-'))
  tempDirs.push(dir)
  return path.join(dir, 'meme-dictionary.json')
}

function makeStore(filePath, overrides = {}) {
  return createMemeDictionary({ filePath, log: vi.fn(), now: () => 0, ...overrides })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('createMemeDictionary', () => {
  it('收录候选时按出现次数累加，不改第一次出现时间', async () => {
    const store = makeStore(await tempFile())
    await store.load()
    store.observe(SCOPE, [{ phrase: '量子纠缠', count: 3 }], 100)
    store.observe(SCOPE, [{ phrase: '量子纠缠', count: 2 }], 200)
    const entry = store.get(SCOPE, '量子纠缠')
    expect(entry.seen).toBe(5)
    expect(entry.firstSeenAt).toBe(100)
    expect(entry.lastSeenAt).toBe(200)
  })

  it('忽略空短语和过长的句子', async () => {
    const store = makeStore(await tempFile())
    await store.load()
    store.observe(SCOPE, [{ phrase: '' }, { phrase: '一' }, { phrase: '很'.repeat(20) }])
    expect(store.snapshot(SCOPE).total).toBe(0)
  })

  it('她说出去才算一次使用，没收录过的词不记', async () => {
    const store = makeStore(await tempFile())
    await store.load()
    store.observe(SCOPE, [{ phrase: '量子纠缠', count: 3 }])
    const used = store.markUsed(SCOPE, '这波量子纠缠了', 10)
    expect(used).toEqual(['量子纠缠'])
    expect(store.get(SCOPE, '量子纠缠').uses).toBe(1)
    expect(store.markUsed(SCOPE, '随便说点什么')).toEqual([])
  })

  it('别人接住算加分', async () => {
    const store = makeStore(await tempFile())
    await store.load()
    store.observe(SCOPE, [{ phrase: '量子纠缠', count: 3 }])
    store.markUsed(SCOPE, '量子纠缠了', 10)
    store.observeReply(SCOPE, '确实量子纠缠', 20)
    expect(store.get(SCOPE, '量子纠缠').pickedUp).toBe(1)
  })

  it('一直被反问、没人接的梗会退役', async () => {
    const store = makeStore(await tempFile())
    await store.load()
    store.observe(SCOPE, [{ phrase: '量子纠缠', count: 3 }])
    store.markUsed(SCOPE, '量子纠缠了', 10)
    store.observeReply(SCOPE, '量子纠缠什么意思', 20)
    store.markUsed(SCOPE, '量子纠缠了', 30)
    store.observeReply(SCOPE, '啥意思啊量子纠缠', 40)
    const entry = store.get(SCOPE, '量子纠缠')
    expect(entry.askedBack).toBe(2)
    expect(entry.pickedUp).toBe(0)
    expect(entry.retired).toBe(true)
  })

  it('过了 24 小时才有人提，不算接住', async () => {
    const store = makeStore(await tempFile())
    await store.load()
    store.observe(SCOPE, [{ phrase: '量子纠缠', count: 3 }])
    store.markUsed(SCOPE, '量子纠缠了', 0)
    store.observeReply(SCOPE, '量子纠缠', DAY + 1)
    expect(store.get(SCOPE, '量子纠缠').pickedUp).toBe(0)
  })

  it('digest 只给见过三次以上、没退役的，并按可用度排序', async () => {
    const store = makeStore(await tempFile())
    await store.load()
    store.observe(SCOPE, [{ phrase: '接住了', count: 3 }, { phrase: '没人接', count: 3 }, { phrase: '新词', count: 1 }])
    store.markUsed(SCOPE, '接住了', 10)
    store.observeReply(SCOPE, '接住了接住了', 20)
    store.markUsed(SCOPE, '没人接', 10)
    const digest = store.digest(SCOPE, 5)
    expect(digest.map((item) => item.phrase)).toEqual(['接住了', '没人接'])
    expect(digest[0].pickedUp).toBe(1)
    expect(digest[0].score).toBeGreaterThan(digest[1].score)
  })

  it('落盘后新实例能读回来', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    await store.load()
    store.observe(SCOPE, [{ phrase: '量子纠缠', count: 3 }])
    store.markUsed(SCOPE, '量子纠缠了', 10)
    await store.flush()

    const raw = JSON.parse(await readFile(filePath, 'utf8'))
    expect(raw.version).toBe(1)
    expect(raw.entries).toHaveLength(1)

    const again = makeStore(filePath)
    await again.load()
    const entry = again.get(SCOPE, '量子纠缠')
    expect(entry.seen).toBe(3)
    expect(entry.uses).toBe(1)
  })

  it('九十天没出现又没被用过的条目会被清掉', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    await store.load()
    store.observe(SCOPE, [{ phrase: '旧梗', count: 3 }], 0)
    store.observe(SCOPE, [{ phrase: '常用梗', count: 3 }], 0)
    store.markUsed(SCOPE, '常用梗', 0)
    await store.flush()

    const later = makeStore(filePath, { now: () => 100 * DAY })
    await later.load()
    await later.flush()
    expect(later.get(SCOPE, '旧梗')).toBeNull()
    expect(later.get(SCOPE, '常用梗')).not.toBeNull()
  })

  it('不同群各记各的', async () => {
    const store = makeStore(await tempFile())
    await store.load()
    store.observe(SCOPE, [{ phrase: '量子纠缠', count: 3 }])
    store.observe('qq:group:g2', [{ phrase: '量子纠缠', count: 1 }])
    expect(store.get(SCOPE, '量子纠缠').seen).toBe(3)
    expect(store.get('qq:group:g2', '量子纠缠').seen).toBe(1)
    expect(store.digest('qq:group:g2')).toEqual([])
  })
})
