import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../memory.mjs'

const tempDirs = []

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-memory-pin-'))
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

function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('记忆钉子', () => {
  it('钉住后不降温、不自动归档；取下后恢复普通规则', async () => {
    const store = makeStore(await tempFile())
    store.appendTurn('user', '关于那盆栀子花的约定', daysAgo(200))
    const id = store.list({ limit: 1 }).items[0].id

    expect(store.setPinned(id, true)).toMatchObject({ ok: true, pinned: true })
    // 钉住会顺手解冻：用户显然希望它回到日常检索里。
    store.refreshCold()
    expect(store.list({ limit: 1 }).items[0].cold).toBe(false)
    expect(store.sweep(Date.now(), { afterDays: 180 }).archived).toBe(0)

    expect(store.setPinned(id, false)).toMatchObject({ ok: true, pinned: false })
    store.refreshCold()
    expect(store.list({ limit: 1 }).items[0].cold).toBe(true)
  })

  it('钉住的事在检索里排得更靠前', async () => {
    const store = makeStore(await tempFile())
    // 旧条目本来会衰减到 0.6，钉住后按「长期有效」处理，并带一点加权。
    store.appendTurn('user', '我喜欢喝冰美式', daysAgo(400))
    const oldId = store.list({ limit: 1 }).items[0].id
    store.setPinned(oldId, true)
    store.appendTurn('user', '我喜欢喝冰美式')

    const hits = store.search('冰美式', { limit: 2 })
    expect(hits[0]?.id).toBe(oldId)
  })

  it('钉子计数进 stats，未知 id 明确回 not-found', async () => {
    const store = makeStore(await tempFile())
    store.appendTurn('user', '一句话')
    expect(store.stats().pinned).toBe(0)

    const id = store.list({ limit: 1 }).items[0].id
    store.setPinned(id, true)
    expect(store.stats().pinned).toBe(1)
    expect(store.setPinned('missing-id', true)).toEqual({ ok: false, reason: 'not-found' })
  })
})
