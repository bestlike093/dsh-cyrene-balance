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
 *   - kind：'group' | 'c2c' | 'unknown'（认不出就是 unknown，不折成私聊 —— B2-012）
 *   - targetId：群聊是 groupId，私聊是 userId，unknown 是空串
 *   - messageId：宿主消息 id，没有就空串
 *   - chatType：'group' | 'private' | 'unknown'（记忆侧口径；unknown 不伪装成 private）
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
  /* B2-012：认不出的 kind 不许折成私聊。
   * 旧写法是 `source.kind === 'group' ? 'group' : 'c2c'`，把 kind 缺失 / 'GROUP' /
   * 'group_chat' / 拼错 / 非字符串一律当私聊：targetId 取 userId、chatType 记 'private'，
   * 下游 index.js:5037 再兜一次 scope:'private'、:5056 拿 targetId 直接发回复。
   * 三态沿用 channel-contract.mjs:90 已有的词（group / private / unknown），不新造：
   * 这里私聊侧保留 QQ 口径的 'c2c'，认不出的落 'unknown'。
   * 现网 QQ 链的 kind 由 parseOfficialEvent 显式写（qq-official.mjs:168 'c2c'、:188 'group'），
   * 缺 kind 只会来自畸形或非 QQ 输入，判 unknown 不误伤真私聊。 */
  const kind = source.kind === 'group' ? 'group' : source.kind === 'c2c' ? 'c2c' : 'unknown'
  /* unknown 时给空串。照本件 :17 那句「只做形状归一，不做空值拦截；谁用谁判空」——
   * 这里不补拦截，下游拿空串怎么办是下游的事（未验，见总账 §48.4）。 */
  const targetId = kind === 'group' ? clean(source.groupId) : kind === 'c2c' ? userId : ''
  const messageId = clean(source.messageId) || clean(source.msgId)
  return {
    text,
    userId,
    kind,
    targetId,
    messageId,
    chatType: kind === 'group' ? 'group' : kind === 'c2c' ? 'private' : 'unknown',
    target: { kind, targetId, msgId: messageId },
    raw: source
  }
}
