/**
 * QQ 官方机器人传输层。
 *
 * 只做协议适配，不碰网络以外的东西：
 *   - AppID / AppSecret 换 AccessToken，带缓存；
 *   - C2C 与群聊被动回复；
 *   - Webhook Ed25519 验签（按官方文档用 Secret 派生密钥）；
 *   - 事件归一化成 { kind, userId, groupId, content, messageId }。
 *
 * 凭证由调用方注入；测试里 fetch 也注入，真实运行用全局 fetch。
 * 没有凭证时不要创建实例，让上层继续走本机通道。
 */
import {
  createPrivateKey,
  createPublicKey,
  verify as cryptoVerify
} from 'node:crypto'

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const API_BASE = 'https://api.sgroup.qq.com'
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function repeatToSeed(secret) {
  let seed = Buffer.from(String(secret ?? ''), 'utf8')
  if (seed.length === 0) throw new Error('AppSecret 不能为空')
  while (seed.length < 32) seed = Buffer.concat([seed, seed])
  return seed.subarray(0, 32)
}

/** 官方文档的派生方式：Secret 反复翻倍到 32 字节，作为 Ed25519 seed。 */
export function deriveEd25519KeyPair(secret) {
  const seed = repeatToSeed(secret)
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8'
  })
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  const publicKeyRaw = spki.subarray(spki.length - 32)
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, publicKeyRaw]),
    format: 'der',
    type: 'spki'
  })
  return { privateKey, publicKey, publicKeyRaw }
}

export function verifyWebhookSignature({ secret, signature, timestamp, body, now = Date.now, maxSkewSeconds = 300 }) {
  if (typeof signature !== 'string' || signature.trim() === '') return false
  if (typeof timestamp !== 'string' || timestamp.trim() === '') return false
  if (maxSkewSeconds > 0) {
    const sent = Number(timestamp)
    if (!Number.isFinite(sent)) return false
    if (Math.abs(Math.floor(now() / 1000) - sent) > maxSkewSeconds) return false
  }

  let sig
  try {
    sig = Buffer.from(signature.trim(), 'hex')
  } catch {
    return false
  }
  if (sig.length !== 64) return false

  const pair = deriveEd25519KeyPair(secret)
  const message = Buffer.concat([
    Buffer.from(timestamp, 'utf8'),
    Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8')
  ])
  try {
    return cryptoVerify(null, message, pair.publicKey, sig)
  } catch {
    return false
  }
}

export function parseOfficialEvent(payload) {
  if (payload === null || typeof payload !== 'object') return null
  const data = payload.d
  if (data === null || typeof data !== 'object') return null

  if (payload.t === 'C2C_MESSAGE_CREATE') {
    const userId = String(data.author?.user_openid ?? '').trim()
    const content = String(data.content ?? '').trim()
    if (userId === '' || content === '') return null
    return {
      kind: 'c2c',
      userId,
      groupId: '',
      content,
      messageId: String(data.id ?? '').trim(),
      timestamp: String(data.timestamp ?? '').trim()
    }
  }

  if (payload.t === 'GROUP_AT_MESSAGE_CREATE') {
    const userId = String(data.author?.member_openid ?? '').trim()
    const groupId = String(data.group_openid ?? '').trim()
    const content = String(data.content ?? '').trim()
    if (userId === '' || groupId === '' || content === '') return null
    return {
      kind: 'group',
      userId,
      groupId,
      content,
      messageId: String(data.id ?? '').trim(),
      timestamp: String(data.timestamp ?? '').trim()
    }
  }

  return null
}

export function createOfficialQqTransport(options = {}) {
  const appId = String(options.appId ?? '').trim()
  const appSecret = String(options.appSecret ?? '').trim()
  if (appId === '' || appSecret === '') throw new Error('QQ 官方机器人需要 AppID 和 AppSecret')

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('当前环境没有 fetch')
  const tokenUrl = String(options.tokenUrl ?? TOKEN_URL)
  const apiBase = String(options.apiBase ?? API_BASE).replace(/\/+$/, '')
  const now = typeof options.now === 'function' ? options.now : Date.now

  let token = ''
  let expiresAt = 0
  const seqByMessage = new Map()

  async function getAccessToken() {
    if (token !== '' && now() < expiresAt) return token
    const response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret: appSecret })
    })
    if (!response.ok) {
      const detail = String(await response.text()).slice(0, 300)
      throw new Error(`QQ AccessToken 获取失败 ${response.status}${detail === '' ? '' : `：${detail}`}`)
    }
    const data = await response.json()
    const accessToken = String(data?.access_token ?? data?.data?.access_token ?? '').trim()
    if (accessToken === '') throw new Error('QQ AccessToken 响应里没有 access_token')
    const expiresIn = Number(data?.expires_in ?? data?.data?.expires_in ?? 7200)
    token = accessToken
    expiresAt = now() + Math.max(60, expiresIn - 60) * 1000
    return token
  }

  async function send(targetType, targetId, content, extra = {}) {
    if (targetType !== 'c2c' && targetType !== 'group') throw new Error('targetType 只能是 c2c 或 group')
    const id = String(targetId ?? '').trim()
    const text = String(content ?? '').trim()
    if (id === '') throw new Error('缺少接收方 openid')
    if (text === '') throw new Error('回复内容不能为空')

    const accessToken = await getAccessToken()
    const messageId = String(extra.msgId ?? '').trim()
    let msgSeq = Number(extra.msgSeq ?? 0)
    if (!Number.isFinite(msgSeq) || msgSeq <= 0) {
      if (messageId !== '') {
        const next = (seqByMessage.get(messageId) ?? 0) + 1
        seqByMessage.set(messageId, next)
        msgSeq = next
      } else {
        msgSeq = 1
      }
    }

    const body = { content: text.slice(0, 2000), msg_type: 0, msg_seq: msgSeq }
    if (messageId !== '') body.msg_id = messageId

    const path = targetType === 'c2c'
      ? `/v2/users/${encodeURIComponent(id)}/messages`
      : `/v2/groups/${encodeURIComponent(id)}/messages`
    const response = await fetchImpl(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `QQBot ${accessToken}`
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      const detail = String(await response.text()).slice(0, 300)
      throw new Error(`QQ 消息发送失败 ${response.status}${detail === '' ? '' : `：${detail}`}`)
    }
    return response.json().catch(() => ({}))
  }

  return {
    appId,
    getAccessToken,
    sendToUser: (openid, content, extra) => send('c2c', openid, content, extra),
    sendToGroup: (groupOpenid, content, extra) => send('group', groupOpenid, content, extra),
    verifyWebhook: ({ signature, timestamp, body, maxSkewSeconds = 300 }) =>
      verifyWebhookSignature({ secret: appSecret, signature, timestamp, body, now, maxSkewSeconds }),
    parseEvent: parseOfficialEvent
  }
}
