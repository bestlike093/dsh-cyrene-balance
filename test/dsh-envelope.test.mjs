import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeDshEnvelope } from '../lib/companion/sense/dsh-envelope.mjs'

test('normalizeDshEnvelope：私聊事件归一', () => {
  const envelope = normalizeDshEnvelope({
    content: '  晚上好  ',
    userId: 'u-123',
    messageId: 'm-9'
  })
  assert.equal(envelope.text, '晚上好')
  assert.equal(envelope.userId, 'u-123')
  assert.equal(envelope.kind, 'c2c')
  assert.equal(envelope.targetId, 'u-123')
  assert.equal(envelope.messageId, 'm-9')
  assert.equal(envelope.chatType, 'private')
  assert.deepEqual(envelope.target, { kind: 'c2c', targetId: 'u-123', msgId: 'm-9' })
})

test('normalizeDshEnvelope：群聊事件归一', () => {
  const envelope = normalizeDshEnvelope({
    kind: 'group',
    content: '早',
    userId: 'u-456',
    groupId: 'g-1',
    messageId: 'm-2'
  })
  assert.equal(envelope.kind, 'group')
  assert.equal(envelope.targetId, 'g-1')
  assert.equal(envelope.chatType, 'group')
  assert.deepEqual(envelope.target, { kind: 'group', targetId: 'g-1', msgId: 'm-2' })
})

test('normalizeDshEnvelope：text / msgId / senderOpenId 别名也认', () => {
  const envelope = normalizeDshEnvelope({
    kind: 'group',
    text: ' 在吗 ',
    senderOpenId: 'u-7',
    groupId: 'g-8',
    msgId: 'm-3'
  })
  assert.equal(envelope.text, '在吗')
  assert.equal(envelope.userId, 'u-7')
  assert.equal(envelope.messageId, 'm-3')
})

test('normalizeDshEnvelope：空与畸形输入不抛错', () => {
  const empty = normalizeDshEnvelope(null)
  assert.equal(empty.text, '')
  assert.equal(empty.kind, 'c2c')
  const weird = normalizeDshEnvelope('not-an-object')
  assert.equal(weird.text, '')
  assert.equal(weird.targetId, '')
})

test('normalizeDshEnvelope：content 为空时回退 text', () => {
  const envelope = normalizeDshEnvelope({ content: '', text: ' 你好', userId: 'u-1' })
  assert.equal(envelope.text, '你好')
})
