/**
 * DSH / QQ 消息事件的统一信封。
 *
 * 宿主把同一件事用了几种说法：content / text 是正文，kind 有时叫 group 有时叫 c2c，
 * 群号有时在 groupId、发送者在 userId。宿主半里多个入口各自就地解析，
 * 字段口径一旦再变，每处都要跟着改。
 *
 * 这个纯函数把「一条 DSH 消息事件」归一成一份信封，所有入口共享同一套取值：
 *   - text：正文，已 trim
 *   - userId：发送者 openId
 *   - kind：'group' | 'c2c'
 *   - targetId：群聊是 groupId，私聊是 userId
 *   - messageId：宿主消息 id，没有就空串
 *   - chatType：'group' | 'private'（记忆侧口径）
 *   - target：{ kind, targetId, msgId }（发送回原会话用）
 *
 * 只做形状归一，不做空值拦截；谁用谁判空。
 */

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeDshEnvelope(event) {
  const source = event !== null && typeof event === 'object' ? event : {}
  const text = clean(source.content) || clean(source.text)
  const userId = clean(source.userId) || clean(source.senderOpenId)
  const kind = source.kind === 'group' ? 'group' : 'c2c'
  const targetId = kind === 'group' ? clean(source.groupId) : userId
  const messageId = clean(source.messageId) || clean(source.msgId)
  return {
    text,
    userId,
    kind,
    targetId,
    messageId,
    chatType: kind === 'group' ? 'group' : 'private',
    target: { kind, targetId, msgId: messageId },
    raw: source
  }
}
