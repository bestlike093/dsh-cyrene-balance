import { describe, expect, it } from 'vitest'
import { describeSpeaker, wireContent } from '../chat.mjs'
import { fixMisattributedQuote } from '../reply-guard.mjs'

const group = (overrides = {}) => ({
  channel: 'qq',
  chatType: 'group',
  openId: 'group-1',
  ...overrides
})

describe('describeSpeaker', () => {
  it('桌面的消息没有说话人标记', () => {
    expect(describeSpeaker(null)).toBe('')
    expect(describeSpeaker({ channel: 'desktop' })).toBe('')
  })

  it('私聊不标代号：那里只有一个人', () => {
    expect(describeSpeaker({ channel: 'qq', chatType: 'private', senderOpenId: 'abc' })).toBe('')
  })

  it('主人单独标出来', () => {
    expect(describeSpeaker(group({ isOwner: true, senderOpenId: 'abcdef12' }))).toBe('主人')
  })

  it('同一个群友每次得到同一个代号', () => {
    const a = describeSpeaker(group({ senderOpenId: 'ABCD1234EFGH' }))
    const b = describeSpeaker(group({ senderOpenId: 'ABCD1234EFGH' }))
    expect(a).toBe('群友·efgh')
    expect(a).toBe(b)
  })

  it('不同群友得到不同代号', () => {
    const a = describeSpeaker(group({ senderOpenId: 'openid-aaaa' }))
    const b = describeSpeaker(group({ senderOpenId: 'openid-bbbb' }))
    expect(a).not.toBe(b)
  })

  it('没有 openid 时退回一个通用称呼', () => {
    expect(describeSpeaker(group())).toBe('群友')
  })
})

describe('wireContent', () => {
  it('群聊消息带上说话人', () => {
    const wire = wireContent('今天好热', group({ senderOpenId: 'aaaa1111' }))
    expect(wire).toBe('［QQ 群聊｜群友·1111］今天好热')
  })

  it('主人的话单独标出来', () => {
    const wire = wireContent('在吗', group({ isOwner: true }))
    expect(wire).toBe('［QQ 群聊｜主人］在吗')
  })

  it('私聊保持原来的来源标记', () => {
    const wire = wireContent('在吗', { channel: 'qq', chatType: 'private' })
    expect(wire).toBe('［QQ 私聊］在吗')
  })

  it('桌面消息不加前缀', () => {
    expect(wireContent('在吗', null)).toBe('在吗')
  })
})

describe('fixMisattributedQuote', () => {
  const history = [
    { speaker: '群友·1111', text: 'Rust 的借用检查真难' },
    { speaker: '主人', text: '我今天不想写代码' }
  ]

  it('把别人的话安到当前人头上时，改回真正说的人', () => {
    const result = fixMisattributedQuote('你刚才说「Rust 的借用检查真难」，我记着呢', {
      speaker: '群友·2222',
      history
    })
    expect(result.text).toBe('刚才群友·1111说「Rust 的借用检查真难」，我记着呢')
    expect(result.fixed[0].type).toBe('quote_other_speaker')
  })

  it('引文本来就是当前人说的，不动', () => {
    const result = fixMisattributedQuote('你说的「我今天不想写代码」我记住了', {
      speaker: '主人',
      history
    })
    expect(result.text).toBe('你说的「我今天不想写代码」我记住了')
    expect(result.fixed).toEqual([])
  })

  it('找不到出处时退成不确定的说法', () => {
    const result = fixMisattributedQuote('你之前说「明天要下雪」', {
      speaker: '群友·2222',
      history
    })
    expect(result.text).toBe('刚才群里有人说「明天要下雪」')
    expect(result.fixed[0].type).toBe('quote_unknown')
  })

  it('没有引号的转述不猜，原样保留', () => {
    const text = '你刚才说 Rust 很难'
    expect(fixMisattributedQuote(text, { speaker: '群友·2222', history }).text).toBe(text)
  })

  it('桌面的回复不启用这套纠正', () => {
    const text = '你刚才说「Rust 的借用检查真难」'
    expect(fixMisattributedQuote(text, { speaker: '', history }).text).toBe(text)
  })

  it('只纠正明确写成「你说」的那一处，其他引文不猜', () => {
    const result = fixMisattributedQuote(
      '你刚才说「Rust 的借用检查真难」，又提到「我今天不想写代码」',
      { speaker: '群友·2222', history }
    )
    expect(result.text).toContain('刚才群友·1111说「Rust 的借用检查真难」')
    expect(result.text).toContain('又提到「我今天不想写代码」')
    expect(result.fixed).toHaveLength(1)
  })
})
