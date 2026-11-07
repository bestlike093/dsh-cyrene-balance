import { describe, expect, it } from 'vitest'
import {
  collapseDuplicateParagraphs,
  guardReply,
  isFarewell,
  shouldStaySilent,
  stripControlTags
} from '../reply-guard.mjs'

describe('stripControlTags', () => {
  it('清掉成对的内部标签，协议值也不留给用户', () => {
    expect(stripControlTags('<pc_state>开心</pc_state>晚安')).toBe('晚安')
  })

  it('清掉孤立或自闭合的标签', () => {
    expect(stripControlTags('好耶<cyrene_note/>')).toBe('好耶')
    expect(stripControlTags('好耶</memory_slot>')).toBe('好耶')
  })

  it('普通尖括号内容不动', () => {
    expect(stripControlTags('用 <div> 包一层')).toBe('用 <div> 包一层')
  })
})

describe('collapseDuplicateParagraphs', () => {
  it('合并完全相同的整段', () => {
    expect(collapseDuplicateParagraphs('好耶\n\n好耶')).toBe('好耶')
    expect(collapseDuplicateParagraphs('第一段\n\n第二段\n\n第一段')).toBe('第一段\n\n第二段')
  })

  it('相似但不相同的段落保留', () => {
    expect(collapseDuplicateParagraphs('哈哈\n\n哈哈哈')).toBe('哈哈\n\n哈哈哈')
  })

  it('空文本返回空串', () => {
    expect(collapseDuplicateParagraphs('   ')).toBe('')
  })
})

describe('guardReply', () => {
  it('清理后给出可解释的说明', () => {
    const result = guardReply('<pc_mood>soft</pc_mood>晚安♪\n\n晚安♪')
    expect(result.text).toBe('晚安♪')
    expect(result.notes.map((item) => item.type)).toContain('control_tag')
    expect(result.notes.map((item) => item.type)).toContain('duplicate_paragraph')
  })

  it('本来干净的话原样返回', () => {
    const result = guardReply('今天也会好好陪着你的♪')
    expect(result.text).toBe('今天也会好好陪着你的♪')
    expect(result.notes).toEqual([])
  })

  it('空输入不会抛错', () => {
    expect(guardReply(null).text).toBe('')
  })
})

describe('isFarewell', () => {
  it('纯道别和应声算收尾', () => {
    expect(isFarewell('晚安')).toBe(true)
    expect(isFarewell('晚安♪')).toBe(true)
    expect(isFarewell('好梦～')).toBe(true)
    expect(isFarewell('谢谢啦')).toBe(true)
    expect(isFarewell('嗯')).toBe(true)
  })

  it('带新内容就不算', () => {
    expect(isFarewell('晚安，明天记得叫我')).toBe(false)
    expect(isFarewell('我睡了，你也早点睡')).toBe(false)
    expect(isFarewell('')).toBe(false)
  })
})

describe('shouldStaySilent', () => {
  it('上一轮已经道别，这一轮也只是道别', () => {
    expect(shouldStaySilent({ userText: '晚安', lastAssistantText: '晚安，好梦♪' })).toBe(true)
  })

  it('上一轮没有收尾就照常回复', () => {
    expect(shouldStaySilent({ userText: '晚安', lastAssistantText: '今天辛苦了' })).toBe(false)
  })

  it('对方还有话要说就照常回复', () => {
    expect(
      shouldStaySilent({ userText: '晚安，明天见', lastAssistantText: '晚安♪' })
    ).toBe(false)
  })

  it('没有历史时不禁言', () => {
    expect(shouldStaySilent({ userText: '晚安', lastAssistantText: '' })).toBe(false)
  })
})
