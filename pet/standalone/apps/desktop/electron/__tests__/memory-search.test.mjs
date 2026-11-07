import { describe, expect, it } from 'vitest'

import { cosineSimilarity, rankMemories, tokenize } from '../memory-search.mjs'

const NOW = new Date('2026-11-06T12:00:00+08:00').getTime()

function daysAgo(days) {
  return new Date(NOW - days * 86_400_000).toISOString()
}

const ITEMS = [
  { id: 'coffee', text: '旅人喜欢喝冰美式，不加糖', at: daysAgo(30) },
  { id: 'rain', text: '今天重庆下雨了，出门记得带伞', at: daysAgo(1) },
  { id: 'pkg', text: '打包前要先退出 DSH Pet，不然 asar 会报 EBUSY', at: daysAgo(5) }
]

describe('tokenize', () => {
  it('中文切成字二元组', () => {
    expect(tokenize('降温了')).toEqual(['降温', '温了'])
  })

  it('单字保留，英文和数字按整词', () => {
    expect(tokenize('好 asar 128MB')).toEqual(['asar', '128mb', '好'])
  })

  it('标点和空白不产生词', () => {
    expect(tokenize('，。！ ')).toEqual([])
    expect(tokenize('')).toEqual([])
    expect(tokenize(null)).toEqual([])
  })
})

describe('rankMemories', () => {
  it('相关的那条排第一', () => {
    const result = rankMemories('美式', ITEMS, { now: NOW })
    expect(result[0].id).toBe('coffee')
  })

  it('不相关的不会硬凑进来', () => {
    const result = rankMemories('美式', ITEMS, { now: NOW })
    expect(result.map((item) => item.id)).not.toContain('pkg')
  })

  it('英文关键词也能命中', () => {
    const result = rankMemories('asar EBUSY', ITEMS, { now: NOW })
    expect(result[0].id).toBe('pkg')
  })

  it('同样相关时新的在前', () => {
    const items = [
      { id: 'old', text: '项目要打包了', at: daysAgo(60) },
      { id: 'new', text: '项目要打包了', at: daysAgo(0) }
    ]
    const result = rankMemories('打包', items, { now: NOW })
    expect(result.map((item) => item.id)).toEqual(['new', 'old'])
  })

  it('limit 生效', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `item-${index}`,
      text: `关于打包的第 ${index} 条记录`,
      at: daysAgo(index)
    }))
    expect(rankMemories('打包', items, { now: NOW, limit: 3 })).toHaveLength(3)
  })

  it('空查询和纯标点返回空', () => {
    expect(rankMemories('', ITEMS, { now: NOW })).toEqual([])
    expect(rankMemories('，。', ITEMS, { now: NOW })).toEqual([])
  })

  it('没有任何命中时返回空', () => {
    expect(rankMemories('量子纠缠', ITEMS, { now: NOW })).toEqual([])
  })

  it('向量分参与混合后能改变排序', () => {
    const vectorScores = new Map([
      ['coffee', 0],
      ['rain', 1],
      ['pkg', 0]
    ])
    const result = rankMemories('美式', ITEMS, {
      now: NOW,
      vectorScores,
      vectorWeight: 1
    })
    expect(result[0].id).toBe('rain')
  })

  it('不改动传入的对象', () => {
    const snapshot = JSON.stringify(ITEMS)
    rankMemories('美式', ITEMS, { now: NOW })
    expect(JSON.stringify(ITEMS)).toBe(snapshot)
  })

  it('空列表不抛错', () => {
    expect(rankMemories('美式', [], { now: NOW })).toEqual([])
    expect(rankMemories('美式', null, { now: NOW })).toEqual([])
  })
})

describe('cosineSimilarity', () => {
  it('同向为 1，正交为 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('维度不一致或空向量返回 0', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity(null, [1])).toBe(0)
  })

  it('含非法数值返回 0', () => {
    expect(cosineSimilarity([1, Number.NaN], [1, 1])).toBe(0)
  })
})
