import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OUTLINE_PREFERENCE,
  OUTLINE_COLORS,
  OUTLINE_LUMA_THRESHOLD,
  applyOutline,
  decideOutlineColor,
  resolveOutlineKey,
  sampleCanvasLuma
} from '../renderer/outline.mjs'

/** 假元素：只留 style 上真会用到的三个方法，够验证描边写没写进去。 */
function fakeElement() {
  const props = new Map()
  return {
    props,
    style: {
      setProperty: (name, value) => props.set(name, value),
      removeProperty: (name) => props.delete(name)
    }
  }
}

describe('decideOutlineColor', () => {
  it('亮立绘配深色边，深立绘配白边', () => {
    expect(decideOutlineColor(230)).toBe('dark')
    expect(decideOutlineColor(OUTLINE_LUMA_THRESHOLD + 1)).toBe('dark')
    expect(decideOutlineColor(OUTLINE_LUMA_THRESHOLD)).toBe('light')
    expect(decideOutlineColor(40)).toBe('light')
  })

  it('读不到亮度时给白边而不是抛异常', () => {
    expect(decideOutlineColor(null)).toBe('light')
    expect(decideOutlineColor(NaN)).toBe('light')
  })

  it('两种描边色都定义好了，不会写出 undefined', () => {
    expect(OUTLINE_COLORS.dark).toMatch(/^#/)
    expect(OUTLINE_COLORS.light).toMatch(/^#/)
  })
})

describe('applyOutline', () => {
  it('八个方向叠 drop-shadow，描边才会贴着轮廓而不是一圈方框', () => {
    const element = fakeElement()
    expect(applyOutline(element, OUTLINE_COLORS.dark, 2)).toBe(true)
    const filter = element.props.get('filter')
    expect(filter.split('drop-shadow(')).toHaveLength(9)
    expect(filter).toContain('2px 0px 0 #181820')
    expect(filter).toContain('-2px -2px 0 #181820')
  })

  it('粗细为 0 或颜色为空时把 filter 摘干净', () => {
    const element = fakeElement()
    applyOutline(element, OUTLINE_COLORS.light, 3)
    expect(element.props.has('filter')).toBe(true)
    applyOutline(element, OUTLINE_COLORS.light, 0)
    expect(element.props.has('filter')).toBe(false)

    applyOutline(element, OUTLINE_COLORS.light, 3)
    applyOutline(element, '', 3)
    expect(element.props.has('filter')).toBe(false)
  })

  it('没有元素就返回 false，不抛', () => {
    expect(applyOutline(null, OUTLINE_COLORS.dark, 2)).toBe(false)
  })
})

describe('sampleCanvasLuma', () => {
  it('拿不到画布或画布尺寸非法时如实报原因，不猜一个亮度', () => {
    expect(sampleCanvasLuma(null)).toEqual({ ok: false, reason: 'no-canvas' })
    expect(sampleCanvasLuma({ width: 0, height: 0 })).toEqual({ ok: false, reason: 'empty-canvas' })
    expect(sampleCanvasLuma({ width: NaN, height: 10 })).toEqual({ ok: false, reason: 'empty-canvas' })
  })
})

describe('resolveOutlineKey', () => {
  it('默认是白边', () => {
    expect(DEFAULT_OUTLINE_PREFERENCE).toBe('light')
  })

  it('设成白边就一直是白边，不看亮度', () => {
    expect(resolveOutlineKey('light', 240)).toBe('light')
    expect(resolveOutlineKey('light', 10)).toBe('light')
  })

  it('设成深边就一直是深边', () => {
    expect(resolveOutlineKey('dark', 240)).toBe('dark')
    expect(resolveOutlineKey('dark', 10)).toBe('dark')
  })

  it('auto 才按亮度自己挑', () => {
    expect(resolveOutlineKey('auto', 200)).toBe('dark')
    expect(resolveOutlineKey('auto', 40)).toBe('light')
  })

  it('写了不认识的值时退回 auto，不把边丢掉', () => {
    expect(resolveOutlineKey('white', 200)).toBe('dark')
    expect(resolveOutlineKey('', 40)).toBe('light')
    expect(resolveOutlineKey(null, 40)).toBe('light')
  })

  it('大小写和空格都不影响', () => {
    expect(resolveOutlineKey(' LIGHT ', 10)).toBe('light')
    expect(resolveOutlineKey('Dark', 240)).toBe('dark')
  })
})
