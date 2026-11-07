import { describe, expect, it } from 'vitest'
import '../renderer/settings-search.js'

const { tokenize, includesAll, matchSection, matchPanelName } = globalThis.SettingsSearch

describe('设置搜索：关键词拆分', () => {
  it('空格、中英文逗号、顿号都当分隔符', () => {
    expect(tokenize('记忆 搜索，情绪、日程')).toEqual(['记忆', '搜索', '情绪', '日程'])
  })

  it('忽略大小写、去重、丢掉空词', () => {
    expect(tokenize('  API   api  ')).toEqual(['api'])
  })

  it('非字符串输入返回空数组，不抛异常', () => {
    expect(tokenize(undefined)).toEqual([])
    expect(tokenize(null)).toEqual([])
    expect(tokenize(42)).toEqual([])
  })

  it('空关键词不命中任何内容', () => {
    expect(includesAll('记忆', [])).toBe(false)
  })
})

describe('设置搜索：段落匹配', () => {
  const section = {
    title: '情绪与反思',
    note: '只影响她怎么开口',
    actions: ['立即巡视一次', '生成今日反思'],
    items: ['记录开关', '摘要间隔', '搜索关键词']
  }

  it('命中标题时整段保留', () => {
    const result = matchSection(section, tokenize('情绪'))
    expect(result.hit).toBe(true)
    expect(result.scope).toBe('section')
    expect(result.itemHits).toEqual([true, true, true])
  })

  it('命中按钮文字也算命中，避免按钮搜不到', () => {
    const result = matchSection(section, tokenize('今日反思'))
    expect(result.hit).toBe(true)
    expect(result.scope).toBe('section')
  })

  it('只命中部分条目时，仅保留命中的条目', () => {
    const result = matchSection(section, tokenize('摘要'))
    expect(result.scope).toBe('items')
    expect(result.itemHits).toEqual([false, true, false])
  })

  it('多个词分散在标题和条目里时保留整段', () => {
    const result = matchSection(section, tokenize('情绪 摘要'))
    expect(result.hit).toBe(true)
    expect(result.scope).toBe('section')
  })

  it('多个词必须同时出现，缺一个就不命中', () => {
    const result = matchSection(section, tokenize('情绪 不存在的词'))
    expect(result.hit).toBe(false)
    expect(result.scope).toBe('none')
  })

  it('没有条目的段落也能靠标题或按钮命中', () => {
    const result = matchSection({ title: '对话', note: '', actions: ['打开观察台'], items: [] }, tokenize('观察台'))
    expect(result.hit).toBe(true)
    expect(result.itemHits).toEqual([])
  })

  it('面板名可以单独命中', () => {
    expect(matchPanelName('记忆 情感与记忆', tokenize('记忆'))).toBe(true)
    expect(matchPanelName('对话', tokenize('记忆'))).toBe(false)
  })
})
