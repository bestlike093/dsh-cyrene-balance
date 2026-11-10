import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertChannelAdapter,
  CHANNEL_PLATFORMS,
  CHANNEL_TEXT_LIMITS,
  normalizeInbound,
  normalizeOutbound,
  splitForChannel,
} from '../lib/companion/deliver/channel-contract.mjs'

test('平台登记：qq / wechat 已在册', () => {
  assert.deepEqual([...CHANNEL_PLATFORMS], ['qq', 'wechat'])
  assert.ok(CHANNEL_TEXT_LIMITS.qq === 2000)
  assert.ok(CHANNEL_TEXT_LIMITS.wechat === 2048)
})

test('适配器自检：必备方法缺失要如实报', () => {
  const ok = assertChannelAdapter({
    start() {},
    stop() {},
    describe() {},
    sendText() {},
  }, 'probe')
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.missing, [])

  const broken = assertChannelAdapter({ describe() {} }, 'probe')
  assert.equal(broken.ok, false)
  assert.deepEqual(broken.missing.sort(), ['sendText', 'start', 'stop'].sort())

  const none = assertChannelAdapter(null, 'probe')
  assert.equal(none.ok, false)
  assert.ok(none.missing.length >= 4)
})

test('长文本切分：码点安全、句边界优先、至少一段', () => {
  assert.deepEqual(splitForChannel('', 'qq'), [''])
  assert.deepEqual(splitForChannel('一句话。', 'qq'), ['一句话。'])
  // 中文 2000 字以内原样返回。
  const short = '好'.repeat(1999)
  assert.deepEqual(splitForChannel(short, 'qq'), [short])
  // 超过上限切成多段，每段不超过上限。
  const long = '第一句。第二句！第三句？' + '长'.repeat(3000)
  const parts = splitForChannel(long, 'qq')
  assert.ok(parts.length >= 2)
  for (const part of parts) assert.ok(Array.from(part).length <= 2000)
  assert.equal(parts.join(''), long)
  // 未知平台回落保守值 1000。
  const unknownParts = splitForChannel('好'.repeat(1500), 'unknown')
  assert.equal(unknownParts.length, 2)
  // 代理对不劈半：emoji 密集文本每段仍是完整码点。
  const emojiText = '😀'.repeat(2500)
  const emojiParts = splitForChannel(emojiText, 'wechat')
  for (const part of emojiParts) {
    assert.ok(Array.from(part).length <= 2048)
    assert.ok(!/[\\uD800-\\uDBFF]$/.test(part))
  }
})

test('入站归一化：字段收敛、坏输入不抛', () => {
  const inbound = normalizeInbound({
    platform: 'qq',
    kind: 'group',
    senderId: 'abc',
    targetId: 'g1',
    text: '你好',
    mentioned: true,
    images: [{ url: 'http://x/1.png' }],
    msgId: 'm1',
    at: 1700000000000,
  })
  assert.equal(inbound.platform, 'qq')
  assert.equal(inbound.kind, 'group')
  assert.equal(inbound.senderId, 'abc')
  assert.equal(inbound.mentioned, true)
  assert.equal(inbound.at, 1700000000000)

  const junk = normalizeInbound(null)
  assert.equal(junk.platform, 'unknown')
  assert.equal(junk.kind, 'unknown')
  assert.equal(junk.text, '')
  assert.ok(Number.isFinite(junk.at))
})

test('出站归一化：缺字段给空值不抛', () => {
  const out = normalizeOutbound({ kind: 'private', targetId: 'u1', text: 'hi' })
  assert.equal(out.targetId, 'u1')
  assert.equal(out.image, null)
  assert.equal(out.voice, null)
  assert.equal(normalizeOutbound(null).text, '')
})
