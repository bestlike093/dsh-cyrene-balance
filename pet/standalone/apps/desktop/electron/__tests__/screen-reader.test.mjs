import { describe, expect, it } from 'vitest'
import { summarizeScreenText, thumbnailSize } from '../screen-reader.mjs'

describe('summarizeScreenText', () => {
  it('中文逐字拆开的空档要收回去', () => {
    expect(summarizeScreenText(['11 月 7 日 ， 星 期 六'])).toBe('11 月 7 日，星期六')
  })

  it('丢掉纯符号、单字和时钟这类碎片', () => {
    const text = summarizeScreenText(['·', '口', '0：33', '0 : 33', '真正的正文'])
    expect(text).toBe('真正的正文')
  })

  it('重复的行只留一次，顺序按原样', () => {
    const text = summarizeScreenText(['项目进度', '项目进度', '明天再做'])
    expect(text).toBe('项目进度 / 明天再做')
  })

  it('太多行时截断，并带上省略号', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `第 ${index} 行的内容`)
    const text = summarizeScreenText(lines, { maxLines: 5 })
    expect(text.split(' / ')).toHaveLength(5)
    expect(text).toContain('第 0 行的内容')
    expect(text).not.toContain('第 5 行的内容')
  })

  it('字数上限按字符算，超了就收尾', () => {
    const text = summarizeScreenText(['一二三四五六七八九十'.repeat(3)], { maxChars: 20 })
    expect(text.endsWith('…')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(21)
  })

  it('空输入与怪输入都返回空串', () => {
    expect(summarizeScreenText(null)).toBe('')
    expect(summarizeScreenText([])).toBe('')
    expect(summarizeScreenText([null, 42, {}])).toBe('')
  })
})

describe('thumbnailSize', () => {
  it('超宽屏按 1280 缩，比例不变', () => {
    expect(thumbnailSize(2560, 1440)).toEqual({ width: 1280, height: 720 })
  })

  it('小屏不放大', () => {
    expect(thumbnailSize(1024, 768)).toEqual({ width: 1024, height: 768 })
  })

  it('拿不到尺寸时给一个安全的 16:9', () => {
    expect(thumbnailSize(0, 0)).toEqual({ width: 1280, height: 720 })
  })
})
