import { describe, expect, it } from 'vitest'
import { ADDRESS_LEVELS, classifyGroupAddress, describeAddress } from '../group-address.mjs'

const NOW = 1_000_000

describe('群聊分档：谁在跟谁说话', () => {
  it('平台确认的 @ 一定算在叫她', () => {
    const result = classifyGroupAddress({ text: '你在吗', mentioned: true, now: NOW })
    expect(result.level).toBe('addressed')
  })

  it('名字被叫到也算在叫她', () => {
    const result = classifyGroupAddress({
      text: '昔涟今天怎么这么安静',
      wakeWords: ['昔涟', 'Cyrene'],
      now: NOW
    })
    expect(result.level).toBe('addressed')
    expect(result.reason).toBe('wake-word')
  })

  it('刚说完几十秒，对方一个短句就是在接话', () => {
    const result = classifyGroupAddress({
      text: '然后呢',
      lastSpoken: { text: '我刚看完那部片子', at: NOW - 30_000 },
      now: NOW
    })
    expect(result.level).toBe('continuation')
  })

  it('刚说完但换了个不相干的长话题，不算接话', () => {
    const result = classifyGroupAddress({
      text: '明天早上的航班改到几点了有人知道吗',
      lastSpoken: { text: '我刚看完那部片子', at: NOW - 30_000 },
      now: NOW
    })
    expect(result.level).not.toBe('continuation')
  })

  it('过了九十秒就不算还在同一条线上', () => {
    const result = classifyGroupAddress({
      text: '嗯',
      lastSpoken: { text: '我刚看完那部片子', at: NOW - 120_000 },
      now: NOW
    })
    expect(result.level).toBe('ambient')
  })

  it('聊到她记得的事，算可以接的话题', () => {
    const result = classifyGroupAddress({
      text: '桌面宠物的安装包又崩了',
      topics: ['旅人在做桌面宠物，最近在修安装包'],
      now: NOW
    })
    expect(result.level).toBe('topic')
  })

  it('别人之间随口闲聊不插嘴', () => {
    const result = classifyGroupAddress({ text: '中午吃什么', topics: ['宠物安装包'], now: NOW })
    expect(result.level).toBe('ambient')
  })

  it('空消息不参与判断', () => {
    const result = classifyGroupAddress({ text: '   ', mentioned: false, now: NOW })
    expect(result.level).toBe('ambient')
  })

  it('四档都有，顺序由强到弱', () => {
    expect(ADDRESS_LEVELS).toEqual(['addressed', 'continuation', 'topic', 'ambient'])
  })

  it('每一档都有一句分寸说明，杂音没有', () => {
    expect(describeAddress('addressed')).not.toBe('')
    expect(describeAddress('continuation')).not.toBe('')
    expect(describeAddress('topic')).not.toBe('')
    expect(describeAddress('ambient')).toBe('')
  })
})
