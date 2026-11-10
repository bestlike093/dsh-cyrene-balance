import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createEmojiSearch,
  emojiSearchText,
  localEmojiScore
} from '../lib/companion/assets/emoji-search.mjs'

const CATALOG = [
  { id: 'cy-happy', file: 'cy-happy.png', emotions: ['happy'], scenes: [], weight: 1 },
  { id: 'cy-sad', file: 'cy-sad.png', emotions: ['sad'], scenes: [], weight: 1 },
  { id: 'cy-morning', file: 'cy-morning.png', emotions: ['gentle'], scenes: ['morning'], weight: 1 },
  { id: 'cy-tease', file: 'cy-tease.png', emotions: ['excited'], scenes: ['tease'], weight: 2 }
]

test('localEmojiScore：id 直接命中给满分', () => {
  assert.equal(localEmojiScore(CATALOG[0], '来一个 cy-happy 看看'), 1)
})

test('localEmojiScore：中文别名能命中英文情绪标签', () => {
  assert.equal(localEmojiScore(CATALOG[0], '今天好开心'), 0.75)
  assert.equal(localEmojiScore(CATALOG[1], '有点难过'), 0.75)
})

test('localEmojiScore：中文场景词命中', () => {
  assert.equal(localEmojiScore(CATALOG[2], '早安呀'), 0.5)
})

test('localEmojiScore：不相关不给分', () => {
  assert.equal(localEmojiScore(CATALOG[0], '下雨了'), 0)
  assert.equal(localEmojiScore(CATALOG[1], ''), 0)
})

test('emojiSearchText：id + 标签拼成可嵌入文本', () => {
  assert.equal(emojiSearchText(CATALOG[0]), 'cy-happy happy')
  assert.equal(emojiSearchText(CATALOG[3]), 'cy-tease excited tease')
})

test('search：纯本地模式按情绪命中排序，weight 生效', async () => {
  const search = createEmojiSearch({ catalog: CATALOG })
  const result = await search.search('今天好开心，逗我一下')
  assert.deepEqual(result[0], 'cy-tease') // tease 情绪 excited 不命中，但 weight 2 × 场景? 逗=tease 0.5×2=1
})

test('search：空查询返回空', async () => {
  const search = createEmojiSearch({ catalog: CATALOG })
  assert.deepEqual(await search.search(''), [])
})

test('search：向量分并入本地分', async () => {
  const embedding = {
    scoreAll: async (query, items) => {
      assert.equal(query, '今天有点低落')
      const map = new Map()
      for (const item of items) {
        if (item.id === 'cy-sad') map.set(item.id, 0.9)
        else map.set(item.id, 0.1)
      }
      return map
    }
  }
  const search = createEmojiSearch({ catalog: CATALOG, embedding })
  const result = await search.search('今天有点低落')
  // 本地「低落」不命中任何词，语义把 cy-sad 顶到第一。
  assert.equal(result[0], 'cy-sad')
})

test('search：向量后端抛错时安静降级本地匹配', async () => {
  const embedding = {
    scoreAll: async () => {
      throw new Error('network down')
    }
  }
  const logCalls = []
  const search = createEmojiSearch({ catalog: CATALOG, embedding, log: (...args) => logCalls.push(args) })
  const result = await search.search('开心')
  assert.equal(result[0], 'cy-happy')
  assert.equal(logCalls.length, 1)
})

test('search：limit 与 minScore 生效', async () => {
  const search = createEmojiSearch({ catalog: CATALOG })
  const result = await search.search('早安', { limit: 1, minScore: 1 })
  assert.deepEqual(result, []) // 早安只有 0.5 分，被 minScore 拦下
  const relaxed = await search.search('早安', { limit: 5 })
  assert.deepEqual(relaxed, ['cy-morning'])
})

test('search：不带向量后端时完全不调用', async () => {
  const search = createEmojiSearch({ catalog: CATALOG, embedding: null })
  const result = await search.search('难过')
  assert.deepEqual(result, ['cy-sad'])
})
