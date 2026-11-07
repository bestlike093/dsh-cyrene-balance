import assert from 'node:assert/strict'
import { it } from 'vitest'

import {
  DEFAULT_SEARCH,
  cosineSimilarity,
  rankMemories,
  tokenize
} from '../memory-search.mjs'
import {
  DEFAULT_EMBEDDING,
  createEmbeddingService,
  normalizeConfig,
  similarity
} from '../embedding.mjs'

it('normalizeConfig 收非法值，不把超时和批次放成负数', () => {
  const config = normalizeConfig({
    provider: 'weird',
    timeoutMs: -5,
    batchSize: 999,
    cacheSize: 1,
    minSimilarity: 3
  })
  assert.equal(config.provider, 'auto')
  assert.equal(config.timeoutMs, DEFAULT_EMBEDDING.timeoutMs)
  assert.equal(config.batchSize, 64)
  assert.equal(config.cacheSize, 16)
  assert.equal(config.minSimilarity, 1)
})

it('similarity 只认同维、非空；相反方向记 0', () => {
  assert.equal(similarity([], [1]), 0)
  assert.equal(similarity([1, 0], [1, 0, 0]), 0)
  assert.equal(similarity([1, 0], [1, 0]), 1)
  assert.equal(similarity([1, 0], [-1, 0]), 0)
})

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body
    }
  }
}

it('openai 协议：按 batch 取向量，并把相似度写进 Map', async () => {
  const calls = []
  const service = createEmbeddingService({
    getConfig: () => ({
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      model: 'bge-m3',
      apiKey: 'k'
    }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      const { input } = JSON.parse(init.body)
      return jsonResponse({
        data: input.map((text) => ({
          embedding: text === 'query' ? [1, 0] : text === '最近' ? [0.9, 0.1] : [0, 1]
        }))
      })
    }
  })

  const scores = await service.scoreAll('query', [
    { id: 'a', text: '最近' },
    { id: 'b', text: '完全相反' }
  ])
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/embeddings$/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k')
  assert.ok(scores instanceof Map)
  assert.ok(scores.get('a') > 0.9)
  assert.equal(scores.has('b'), false)
})

it('ollama 协议：/api/embed 且不需要 Key', async () => {
  const calls = []
  const service = createEmbeddingService({
    getConfig: () => ({ provider: 'ollama' }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      const { input } = JSON.parse(init.body)
      return jsonResponse({ embeddings: input.map(() => [1, 1]) })
    }
  })

  const scores = await service.scoreAll('query', [{ id: 'a', text: '旧事' }])
  assert.match(calls[0].url, /http:\/\/127\.0\.0\.1:11434\/api\/embed$/)
  assert.equal(calls[0].init.headers.Authorization, undefined)
  assert.ok(scores.get('a') > 0.99)
})

it('请求失败就退回 BM25：返回 null，不抛错', async () => {
  const service = createEmbeddingService({
    getConfig: () => ({ provider: 'openai', baseUrl: 'https://example.test/v1', model: 'm' }),
    fetchImpl: async () => {
      throw new Error('offline')
    }
  })
  assert.equal(await service.scoreAll('query', [{ id: 'a', text: '旧事' }]), null)
})

it('provider=off 时一次网络都不发', async () => {
  let called = 0
  const service = createEmbeddingService({
    getConfig: () => ({ provider: 'off' }),
    fetchImpl: async () => {
      called += 1
      return jsonResponse({})
    }
  })
  assert.equal(await service.scoreAll('query', [{ id: 'a', text: '旧事' }]), null)
  assert.equal(called, 0)
})

it('同一个文本第二次走缓存，不再请求', async () => {
  let called = 0
  const service = createEmbeddingService({
    getConfig: () => ({ provider: 'openai', baseUrl: 'https://example.test/v1', model: 'm' }),
    fetchImpl: async (url, init) => {
      called += 1
      const { input } = JSON.parse(init.body)
      return jsonResponse({ data: input.map(() => ({ embedding: [1, 0] })) })
    }
  })
  const items = [{ id: 'a', text: '旧事' }]
  await service.scoreAll('query', items)
  await service.scoreAll('query', items)
  assert.equal(called, 1)
})

it('向量分传进 rankMemories 后能改写名次，且不改原数组', () => {
  const items = [
    { id: 'a', text: '天气', at: Date.now() },
    { id: 'b', text: '天气', at: Date.now() }
  ]
  const vectorScores = new Map([['b', 1]])
  const ranked = rankMemories('天气', items, {
    vectorScores,
    vectorWeight: 0.9,
    now: Date.now()
  })
  assert.equal(ranked[0].id, 'b')
  assert.equal(items[0].id, 'a')
})

it('没有向量分时排序与旧路径一致', () => {
  const items = [
    { id: 'a', text: '今晚吃什么', at: Date.now() },
    { id: 'b', text: '上次说的那本书', at: Date.now() }
  ]
  const ranked = rankMemories('那本书', items, { now: Date.now() })
  assert.equal(ranked[0].id, 'b')
})

it('tokenize 中文按二元组，英文按整词', () => {
  const tokens = tokenize('喝咖啡 coffee')
  assert.ok(tokens.includes('咖啡'))
  assert.ok(tokens.includes('coffee'))
})

it('cosineSimilarity 对空向量与维度不一致都返回 0', () => {
  assert.equal(cosineSimilarity([], [1]), 0)
  assert.equal(cosineSimilarity([1], [1, 2]), 0)
})

it('DEFAULT_SEARCH 仍然只靠 BM25，除非调用方显式给向量', () => {
  assert.equal(DEFAULT_SEARCH.vectorWeight, 0.6)
  const items = [{ id: 'a', text: '完全无关', at: Date.now() }]
  assert.deepEqual(rankMemories('咖啡', items, { now: Date.now() }), [])
})
