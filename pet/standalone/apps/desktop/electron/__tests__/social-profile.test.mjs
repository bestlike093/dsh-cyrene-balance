import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSocialProfileStore, sanitizeStats } from '../social-profile.mjs'

const tempDirs = []
const DAY = 86_400_000

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-social-profile-'))
  tempDirs.push(dir)
  return path.join(dir, 'social-profile.json')
}

function makeStore(filePath, overrides = {}) {
  return createSocialProfileStore({
    filePath,
    log: vi.fn(),
    now: () => 0,
    ...overrides
  })
}

function stats(overrides = {}) {
  return {
    sampleSize: 10,
    avgLength: 8,
    shortRatio: 0.6,
    emojiRatio: 0.1,
    punctuationRatio: 0.2,
    mentionRatio: 0.3,
    imageRatio: 0.4,
    avgGapSeconds: 12,
    burst: { one: 0.5, two: 0.2, threePlus: 0.3, avg: 1.8 },
    particles: ['哈哈'],
    frequentPhrases: [{ phrase: '量子纠缠', count: 3 }],
    openers: ['哈哈'],
    closers: ['好的'],
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('群聊画像落盘', () => {
  it('样本足够时记住合并后的统计', async () => {
    const store = makeStore(await tempFile())
    const merged = store.remember('qq:group:g1', stats())

    expect(merged).not.toBeNull()
    expect(store.get('qq:group:g1')?.avgLength).toBe(8)
    expect(store.get('qq:group:g1')?.samples).toBe(10)
  })

  it('样本太少时不写画像', async () => {
    const store = makeStore(await tempFile())
    expect(store.remember('qq:group:g1', stats({ sampleSize: 3 }))).toBeNull()
    expect(store.get('qq:group:g1')).toBeNull()
  })

  it('落盘只写统计字段，不写原文', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    store.remember('qq:group:g1', stats())
    expect(await store.flush()).toBe(true)

    const raw = await readFile(filePath, 'utf8')
    expect(raw).toContain('量子纠缠')
    expect(raw).not.toContain('这条是原句')
  })

  it('重启后能读回统计', async () => {
    const filePath = await tempFile()
    const first = makeStore(filePath)
    first.remember('qq:group:g1', stats())
    await first.flush()

    const second = makeStore(filePath)
    expect(await second.load()).toEqual({ ok: true, count: 1 })
    expect(second.get('qq:group:g1')?.avgLength).toBe(8)
  })

  it('旧画像超过 7 天后权重变轻，数值向新样本靠拢', async () => {
    const filePath = await tempFile()
    let clock = 0
    const store = makeStore(filePath, { now: () => clock })
    store.remember('qq:group:g1', stats({ avgLength: 4 }))
    await store.flush()

    // 放 30 天：旧画像权重接近 0，新样本几乎完全覆盖。
    clock = 30 * DAY
    const merged = store.remember('qq:group:g1', stats({ avgLength: 20, sampleSize: 10 }))

    expect(merged.avgLength).toBeGreaterThan(18)
  })
})

describe('sanitizeStats', () => {
  it('丢掉白名单之外的内容', () => {
    const cleaned = sanitizeStats({ ...stats(), rawText: '不该出现' })
    expect(cleaned.rawText).toBeUndefined()
    expect(cleaned.mentionRatio).toBeCloseTo(0.3)
  })
})
