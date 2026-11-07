import { describe, expect, it } from 'vitest'
import { burstDelay, splitReply } from '../reply-split.mjs'

describe('splitReply', () => {
  it('短回复不拆，原样一条发出去', () => {
    expect(splitReply('好呀♪')).toEqual(['好呀♪'])
  })

  it('只有一句话时不拆', () => {
    const text = '今天外面风很大，我把窗户关上了，免得桌上的纸被吹跑，你也记得添件衣服。'
    expect(splitReply(text)).toEqual([text])
  })

  it('长回复按句号拆开，拼回去和原文一致', () => {
    const text =
      '今天把桌面宠物的记忆那条线补完了。旧聊天里只挑明确的自我陈述入库，标成被问到再说。剩下两处等明天再收尾。'
    const parts = splitReply(text)

    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe(text)
  })

  it('最多只拆三段，避免把 QQ 回复窗口用光', () => {
    const text = Array.from({ length: 8 }, (_, index) => `这是第${index + 1}句完整的话。`).join('')
    const parts = splitReply(text)

    expect(parts.length).toBeLessThanOrEqual(3)
    expect(parts.join('')).toBe(text)
  })

  it('连续的句末标点留在同一句里', () => {
    const text =
      '你真的做到了？！我还以为要再等很久很久呢，结果一转身就已经在这里了。那就一起看看吧，慢慢来。'
    const parts = splitReply(text, { minLength: 10 })

    expect(parts[0]).toContain('？！')
  })

  it('太短的尾句并回上一段', () => {
    const text =
      '今天把记忆降级那条线接上了，被否认的旧事会自动往后退一格，不会每次都翻出来。好。'
    const parts = splitReply(text, { minLength: 10, minPart: 8 })

    expect(parts.every((part) => Array.from(part).length >= 8)).toBe(true)
  })

  it('空字符串返回空数组', () => {
    expect(splitReply('')).toEqual([])
    expect(splitReply(null)).toEqual([])
  })
})

describe('burstDelay', () => {
  it('按上一段长度估算，并落在给定范围内', () => {
    const delay = burstDelay('这是一段比较长的话，需要一点打字时间。', { rng: () => 0.5 })

    expect(delay).toBeGreaterThanOrEqual(420)
    expect(delay).toBeLessThanOrEqual(1400)
  })

  it('很短的段落也会至少等一小会儿', () => {
    expect(burstDelay('嗯。', { rng: () => 0 })).toBeGreaterThanOrEqual(420)
  })

  it('再长的段落也不会超过上限', () => {
    expect(burstDelay('很长'.repeat(200), { rng: () => 1 })).toBeLessThanOrEqual(1400)
  })
})
