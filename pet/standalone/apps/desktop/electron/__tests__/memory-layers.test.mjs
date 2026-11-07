import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../memory.mjs'

const tempDirs = []

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-memory-layer-'))
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

describe('记忆分层', () => {
  it('对话默认进 raw，也可以显式写进 episode / lesson', async () => {
    const store = makeStore(await tempFile())
    store.appendTurn('user', '今天有点累')
    store.appendTurn('user', '项目卡在打包上', undefined, null, null, { layer: 'episode' })
    store.appendTurn('assistant', '遇到报错先看退出码', undefined, null, null, { layer: 'lesson' })

    expect(store.list({ limit: 10 }).items.map((item) => item.layer)).toEqual([
      'lesson',
      'episode',
      'raw'
    ])
    expect(store.list({ layer: 'episode' }).total).toBe(1)
    expect(store.list({ layer: 'fact' }).total).toBe(0)
  })

  it('非法 layer 回落 raw，不写入奇怪的值', async () => {
    const store = makeStore(await tempFile())
    store.appendTurn('user', '随便说说', undefined, null, null, { layer: 'nonsense' })
    expect(store.list({ limit: 1 }).items[0].layer).toBe('raw')
  })

  it('新事实取代旧事实，旧记录保留但默认不参与检索', async () => {
    const store = makeStore(await tempFile())
    const first = store.rememberFact({ text: '用户喜欢喝热美式', scope: 'desktop' })
    expect(first.ok).toBe(true)

    const second = store.rememberFact({
      text: '用户现在只喝冰美式，不加糖',
      scope: 'desktop',
      about: ['美式']
    })
    expect(second.superseded).toEqual([first.id])

    const all = store.list({ scope: 'desktop', limit: 10 }).items
    const old = all.find((item) => item.id === first.id)
    const fresh = all.find((item) => item.id === second.id)
    expect(old.supersededBy).toBe(second.id)
    expect(fresh.supersedes).toEqual([first.id])

    const visible = store.search('美式', { scope: 'desktop' }).map((item) => item.id)
    expect(visible).toContain(second.id)
    expect(visible).not.toContain(first.id)

    const withOld = store.search('美式', { scope: 'desktop', includeSuperseded: true }).map(
      (item) => item.id
    )
    expect(withOld).toContain(first.id)
  })

  it('只取代同 scope 的旧事实，不跨会话', async () => {
    const store = makeStore(await tempFile())
    const desktop = store.rememberFact({ text: '用户喜欢热美式', scope: 'desktop' })
    const group = store.rememberFact({ text: '群里有人喜欢热美式', scope: 'qq:group:g1' })

    store.rememberFact({ text: '用户改喝冰美式', scope: 'desktop', about: ['美式'] })

    const groupItem = store.list({ scope: 'qq:group:g1', limit: 10 }).items[0]
    expect(groupItem.id).toBe(group.id)
    expect(groupItem.supersededBy).toBe('')
    expect(desktop.ok).toBe(true)
  })
})

describe('冷记忆与衰减', () => {
  it('超过 90 天的原文变冷，事实不降温', async () => {
    const store = makeStore(await tempFile())
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString()
    store.appendTurn('user', '很久以前的一句话', old)
    store.rememberFact({ text: '用户住在重庆', at: old, scope: 'desktop' })

    expect(store.refreshCold()).toBe(true)
    const items = store.list({ limit: 10 }).items
    expect(items.find((item) => item.text === '很久以前的一句话').cold).toBe(true)
    expect(items.find((item) => item.text === '用户住在重庆').cold).toBe(false)
  })

  it('冷记忆默认不进检索，但仍在管理列表里', async () => {
    const store = makeStore(await tempFile())
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString()
    store.appendTurn('user', '以前爱喝美式', old)
    store.refreshCold()

    expect(store.search('美式')).toHaveLength(0)
    expect(store.list({ limit: 10 }).total).toBe(1)
    expect(store.list({ includeCold: false }).total).toBe(0)
    // 明确把它捞出来看过一次，就算重新用上了，不再算冷。
    expect(store.search('美式', { includeCold: true })).toHaveLength(1)
    expect(store.list({ includeCold: false }).total).toBe(1)
  })

  it('检索命中会记下最近使用时间，久远的原文不再变冷', async () => {
    const store = makeStore(await tempFile())
    const at = Date.now()
    const old = new Date(at - 60 * 86_400_000).toISOString()
    store.appendTurn('user', '以前爱喝美式', old)

    // 在它还没老到 90 天时被检索到：这次命中就是最近一次「碰过」。
    expect(store.search('美式', { now: at })).toHaveLength(1)

    // 再过 60 天，写入时间已经超过 90 天，但最近命中在 90 天内，不该变冷。
    const later = at + 60 * 86_400_000
    expect(store.refreshCold(later)).toBe(false)
    expect(store.list({ includeCold: false }).total).toBe(1)
  })

  it('分层半衰期：事实层不衰减，原文层按 30 天减半', async () => {
    const store = makeStore(await tempFile())
    const old = new Date(Date.now() - 365 * 86_400_000).toISOString()
    store.rememberFact({ text: '用户住在重庆', at: old, scope: 'desktop' })
    store.appendTurn('user', '重庆今天下雨', old, null, 'desktop')

    const hits = store.search('重庆', { scope: 'desktop', includeCold: true })
    const fact = hits.find((item) => item.layer === 'fact')
    const raw = hits.find((item) => item.layer === 'raw')
    expect(fact.recency).toBe(1)
    expect(raw.recency).toBeLessThan(0.7)
  })

  it('episode 也按 30 天衰减，lesson 和 fact 一样不降温', async () => {
    const store = makeStore(await tempFile())
    const old = new Date(Date.now() - 365 * 86_400_000).toISOString()
    store.appendTurn('user', '重庆那次出差的片段', old, null, 'desktop', { layer: 'episode' })
    store.appendTurn('assistant', '重庆项目学到的经验', old, null, 'desktop', { layer: 'lesson' })

    const hits = store.search('重庆', { scope: 'desktop', includeCold: true })
    const episode = hits.find((item) => item.layer === 'episode')
    const lesson = hits.find((item) => item.layer === 'lesson')
    expect(episode.recency).toBeLessThan(0.7)
    expect(lesson.recency).toBe(1)
  })

  it('旧版记录缺 layer / cold / lastHitAt 时回落 raw / false / 0', async () => {
    const filePath = await tempFile()
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString()
    await writeFile(
      filePath,
      JSON.stringify({
        version: 2,
        records: [
          { id: 'old-1', role: 'user', text: '很久以前的旧话', at: old, scope: 'desktop' },
          {
            id: 'old-2',
            role: 'user',
            text: '很久以前但最近碰过',
            at: old,
            scope: 'desktop',
            lastHitAt: Date.now()
          }
        ]
      })
    )

    const store = makeStore(filePath)
    expect(await store.load()).toEqual({ ok: true, count: 2 })

    // list 会顺手刷新冷暖：缺 lastHitAt 的那条按写入时间变冷；
    // 自带最近命中的那条不该变冷；两层的 layer 都回落 raw。
    const items = store.list({ limit: 10 }).items
    expect(items.every((item) => item.layer === 'raw')).toBe(true)
    expect(items.find((item) => item.id === 'old-1').cold).toBe(true)
    expect(items.find((item) => item.id === 'old-2').cold).toBe(false)
  })

  it('手动标记冷暖可以来回切换', async () => {
    const store = makeStore(await tempFile())
    store.appendTurn('user', '一句话')
    const id = store.list({ limit: 1 }).items[0].id

    expect(store.setCold(id, true)).toEqual({ ok: true, id, cold: true })
    expect(store.list({ includeCold: false }).total).toBe(0)
    expect(store.setCold(id, false).cold).toBe(false)
    expect(store.list({ includeCold: false }).total).toBe(1)
    expect(store.setCold('missing', true)).toMatchObject({ ok: false, reason: 'not-found' })
  })
})

describe('统计与落盘', () => {
  it('stats 里的四层数量加起来等于总数', async () => {
    const store = makeStore(await tempFile())
    store.appendTurn('user', '原文')
    store.appendTurn('user', '片段', undefined, null, null, { layer: 'episode' })
    store.rememberFact({ text: '事实', scope: 'desktop' })
    store.appendTurn('user', '经验', undefined, null, null, { layer: 'lesson' })

    const stats = store.stats()
    expect(stats.layers).toEqual({ raw: 1, episode: 1, fact: 1, lesson: 1 })
    expect(Object.values(stats.layers).reduce((sum, n) => sum + n, 0)).toBe(stats.count)
    expect(stats.cold).toBe(0)
  })

  it('layer / supersedes / cold 会写进密文文件并读回来', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    store.appendTurn('user', '旧的说法')
    store.rememberFact({ text: '用户住在重庆', scope: 'desktop' })
    store.appendTurn('user', '经验一条', undefined, null, null, { layer: 'lesson' })
    expect(await store.flush()).toBe(true)

    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    expect(saved.version).toBe(5)
    expect(saved.records.map((item) => item.layer)).toEqual(['raw', 'fact', 'lesson'])
    expect(saved.records.every((item) => Array.isArray(item.supersedes))).toBe(true)

    const reopened = makeStore(filePath)
    expect(await reopened.load()).toEqual({ ok: true, count: 3 })
    expect(reopened.list({ layer: 'fact' }).items[0].text).toBe('用户住在重庆')
  })
})
