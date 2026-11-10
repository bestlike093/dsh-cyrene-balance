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
import { readFile } from 'node:fs/promises'

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const API_BASE = 'https://api.sgroup.qq.com'
/* 本地表情走 base64 上传，4MB 以上不塞进消息体。 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
/* 语音同样走 base64，上限保守取 5MB，够念一两分钟。 */
const MAX_VOICE_BYTES = 5 * 1024 * 1024
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
/** 所有 QQ 请求统一 10 秒超时：网络挂起不能把整条通道拖死。 */
const FETCH_TIMEOUT_MS = 10_000
/** seq 计数器只保留最近的消息 key：seq 只在同一轮被动回复里有意义，旧 key 过期即弃。 */
const SEQ_KEEP = 500

/** Ed25519 密钥对缓存：同一个 secret 派生一次，别每次验签都重新派生。 */
const keyPairCache = new Map()

function keyPairFor(secret) {
  const key = String(secret ?? '')
  const cached = keyPairCache.get(key)
  if (cached !== undefined) return cached
  const pair = deriveEd25519KeyPair(secret)
  keyPairCache.set(key, pair)
  /* 缓存只留最近几个 secret，换密文仓库时不会无限增长。 */
  if (keyPairCache.size > 8) {
    const oldest = keyPairCache.keys().next()
    if (!oldest.done) keyPairCache.delete(oldest.value)
  }
  return pair
}

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

  const pair = keyPairFor(secret)
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

/**
 * 从 attachments 里挑出图片。
 *
 * QQ 官方把图片放在 attachments，content_type 形如 image/png；
 * 拿不到 content_type 时退回看扩展名，两边都不认就丢掉。
 */
export function imagesFromAttachments(attachments) {
  if (!Array.isArray(attachments)) return []
  const images = []
  for (const item of attachments) {
    if (item === null || typeof item !== 'object') continue
    const url = String(item.url ?? '').trim()
    if (url === '') continue
    const rawType = String(item.content_type ?? item.contentType ?? '').toLowerCase().split(';')[0].trim()
    const guessed = /\.(png|jpe?g|gif|webp)$/i.test(String(item.filename ?? ''))
    // octet-stream 是「没标类型」，和空类型一样退回看扩展名，别把图丢掉。
    const isImage =
      rawType.startsWith('image/') ||
      ((rawType === '' || rawType === 'application/octet-stream') && guessed)
    if (!isImage) continue
    images.push({
      url,
      contentType: rawType.startsWith('image/') ? rawType : imageTypeFromName(item.filename),
      filename: String(item.filename ?? '').trim(),
      size: Number(item.size ?? 0) || 0,
      width: Number(item.width ?? 0) || 0,
      height: Number(item.height ?? 0) || 0
    })
  }
  return images
}

function imageTypeFromName(name) {
  const text = String(name ?? '').toLowerCase()
  if (text.endsWith('.png')) return 'image/png'
  if (text.endsWith('.jpg') || text.endsWith('.jpeg')) return 'image/jpeg'
  if (text.endsWith('.gif')) return 'image/gif'
  if (text.endsWith('.webp')) return 'image/webp'
  return ''
}

/** 按码点截断，避免 UTF-16 码元把 emoji 等字符切成两半。 */
function clipCodePoints(text, max) {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : text
}

export function parseOfficialEvent(payload) {
  if (payload === null || typeof payload !== 'object') return null
  const data = payload.d
  if (data === null || typeof data !== 'object') return null

  const images = imagesFromAttachments(data.attachments)
  const rawContent = String(data.content ?? '').trim()
  /* 图片标记要同时覆盖纯图与图文混排：模型至少要能看见「这里有一张图」。 */
  const imageNote = images.length === 0 ? '' : images.length === 1 ? '[图片]' : `[图片x${images.length}]`
  const content = rawContent === '' ? imageNote : imageNote === '' ? rawContent : `${rawContent} ${imageNote}`

  if (payload.t === 'C2C_MESSAGE_CREATE') {
    const userId = String(data.author?.user_openid ?? '').trim()
    if (userId === '' || content === '') return null
    return {
      kind: 'c2c',
      userId,
      groupId: '',
      content,
      images,
      messageId: String(data.id ?? '').trim(),
      timestamp: String(data.timestamp ?? '').trim()
    }
  }

  /* 群全量消息开启后，未 @ 的消息走 GROUP_MESSAGE_CREATE；两种都按群消息解析 */
  if (payload.t === 'GROUP_AT_MESSAGE_CREATE' || payload.t === 'GROUP_MESSAGE_CREATE') {
    const userId = String(data.author?.member_openid ?? '').trim()
    const groupId = String(data.group_openid ?? '').trim()
    /* 剥掉 @ 机器人的 <@!openid> 标记，剩下来的才是正文；没有正文就只剩图片标记。 */
    const plainText = rawContent.replace(/<@!?\d+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
    const groupContent =
      plainText === '' ? imageNote : imageNote === '' ? plainText : `${plainText} ${imageNote}`
    if (userId === '' || groupId === '' || groupContent === '') return null
    return {
      kind: 'group',
      userId,
      groupId,
      content: groupContent,
      images,
      messageId: String(data.id ?? '').trim(),
      timestamp: String(data.timestamp ?? '').trim(),
      /* 全量群消息里没被 @ 的，只进记忆、不接话 */
      ...(payload.t === 'GROUP_MESSAGE_CREATE' ? { atMe: false } : {})
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
  /** 换 token 的单飞去重：同一时刻只发一次请求，其他调用者等同一笔结果。 */
  let tokenPromise = null
  const seqByMessage = new Map()

  /** 所有出站请求统一走这里：带 AbortController 超时，不让一次网络挂起拖死通道。 */
  async function fetchWithTimeout(url, init = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  /** 同一条被动回复的 seq 顺延 +1；只保留最近的 SEQ_KEEP 条 key。 */
  function nextSeqFor(messageId) {
    if (messageId === '') return 1
    const next = (seqByMessage.get(messageId) ?? 0) + 1
    seqByMessage.set(messageId, next)
    if (seqByMessage.size > SEQ_KEEP) {
      const oldest = seqByMessage.keys().next()
      if (!oldest.done) seqByMessage.delete(oldest.value)
    }
    return next
  }

  async function getAccessToken() {
    if (token !== '' && now() < expiresAt) return token
    if (tokenPromise === null) {
      tokenPromise = (async () => {
        const response = await fetchWithTimeout(tokenUrl, {
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
      })().finally(() => {
        tokenPromise = null
      })
    }
    return tokenPromise
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
      msgSeq = nextSeqFor(messageId)
    }

    /* 按码点截断：slice(0, 2000) 按 UTF-16 码元切，会把 emoji 之类的字符切成两半。 */
    const body = { content: clipCodePoints(text, 2000), msg_type: 0, msg_seq: msgSeq }
    if (messageId !== '') body.msg_id = messageId

    const path = targetType === 'c2c'
      ? `/v2/users/${encodeURIComponent(id)}/messages`
      : `/v2/groups/${encodeURIComponent(id)}/messages`
    const response = await fetchWithTimeout(`${apiBase}${path}`, {
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

  /**
   * 发图片：先把图片交给 QQ 换成 file_info，再按 msg_type=7 发出去。
   *
   * 图片走 url 上传，省掉本地读盘；QQ 要求先换 file_info，
   * 不能直接把外链塞进 content。
   */
  async function sendImage(targetType, targetId, imageUrl, extra = {}) {
    if (targetType !== 'c2c' && targetType !== 'group') throw new Error('targetType 只能是 c2c 或 group')
    const id = String(targetId ?? '').trim()
    const url = String(imageUrl ?? '').trim()
    if (id === '') throw new Error('缺少接收方 openid')
    if (url === '') throw new Error('图片地址不能为空')

    /* 本地表情包走 base64（file_data），外链走 url；两种都由 QQ 的 /files 换 file_info。 */
    const remote = /^https?:\/\//i.test(url)
    let media
    if (remote) {
      media = { url }
    } else {
      const buffer = await readFile(url)
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`图片超过上限（${MAX_IMAGE_BYTES} 字节）`)
      }
      media = { file_data: buffer.toString('base64') }
    }

    const accessToken = await getAccessToken()
    const filePath = targetType === 'c2c'
      ? `/v2/users/${encodeURIComponent(id)}/files`
      : `/v2/groups/${encodeURIComponent(id)}/files`
    const upload = await fetchWithTimeout(`${apiBase}${filePath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `QQBot ${accessToken}`
      },
      body: JSON.stringify({ file_type: 1, ...media, srv_send_msg: false })
    })
    if (!upload.ok) {
      const detail = String(await upload.text()).slice(0, 300)
      throw new Error(`QQ 图片上传失败 ${upload.status}${detail === '' ? '' : `：${detail}`}`)
    }
    const uploaded = await upload.json().catch(() => ({}))
    const fileInfo = String(uploaded?.file_info ?? uploaded?.data?.file_info ?? '').trim()
    if (fileInfo === '') throw new Error('QQ 图片上传响应里没有 file_info')

    const messageId = String(extra.msgId ?? '').trim()
    let msgSeq = Number(extra.msgSeq ?? 0)
    if (!Number.isFinite(msgSeq) || msgSeq <= 0) {
      msgSeq = nextSeqFor(messageId)
    }

    const body = { msg_type: 7, media: { file_info: fileInfo }, msg_seq: msgSeq, content: ' ' }
    if (messageId !== '') body.msg_id = messageId

    const path = targetType === 'c2c'
      ? `/v2/users/${encodeURIComponent(id)}/messages`
      : `/v2/groups/${encodeURIComponent(id)}/messages`
    const response = await fetchWithTimeout(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `QQBot ${accessToken}`
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      const detail = String(await response.text()).slice(0, 300)
      throw new Error(`QQ 图片发送失败 ${response.status}${detail === '' ? '' : `：${detail}`}`)
    }
    return response.json().catch(() => ({}))
  }

  /**
   * 发语音：file_type=3 传 silk，换到 file_info 再按 msg_type=7 发出去。
   *
   * QQ 只收 silk，WAV 转码由上层负责，这里拿到什么发什么。
   * 不替调用方猜格式——格式错了会被服务端退回，伪造成功更难查。
   */
  async function sendVoice(targetType, targetId, audioBuffer, extra = {}) {
    if (targetType !== 'c2c' && targetType !== 'group') throw new Error('targetType 只能是 c2c 或 group')
    const id = String(targetId ?? '').trim()
    const audio = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer ?? [])
    if (id === '') throw new Error('缺少接收方 openid')
    if (audio.length === 0) throw new Error('语音内容不能为空')
    if (audio.length > MAX_VOICE_BYTES) {
      throw new Error(`语音超过上限（${MAX_VOICE_BYTES} 字节）`)
    }

    const accessToken = await getAccessToken()
    const filePath = targetType === 'c2c'
      ? `/v2/users/${encodeURIComponent(id)}/files`
      : `/v2/groups/${encodeURIComponent(id)}/files`
    const upload = await fetchWithTimeout(`${apiBase}${filePath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `QQBot ${accessToken}`
      },
      body: JSON.stringify({ file_type: 3, file_data: audio.toString('base64'), srv_send_msg: false })
    })
    if (!upload.ok) {
      const detail = String(await upload.text()).slice(0, 300)
      throw new Error(`QQ 语音上传失败 ${upload.status}${detail === '' ? '' : `：${detail}`}`)
    }
    const uploaded = await upload.json().catch(() => ({}))
    const fileInfo = String(uploaded?.file_info ?? uploaded?.data?.file_info ?? '').trim()
    if (fileInfo === '') throw new Error('QQ 语音上传响应里没有 file_info')

    const messageId = String(extra.msgId ?? '').trim()
    let msgSeq = Number(extra.msgSeq ?? 0)
    if (!Number.isFinite(msgSeq) || msgSeq <= 0) {
      msgSeq = nextSeqFor(messageId)
    }

    const body = { msg_type: 7, media: { file_info: fileInfo }, msg_seq: msgSeq, content: ' ' }
    if (messageId !== '') body.msg_id = messageId

    const path = targetType === 'c2c'
      ? `/v2/users/${encodeURIComponent(id)}/messages`
      : `/v2/groups/${encodeURIComponent(id)}/messages`
    const response = await fetchWithTimeout(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `QQBot ${accessToken}`
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      const detail = String(await response.text()).slice(0, 300)
      throw new Error(`QQ 语音发送失败 ${response.status}${detail === '' ? '' : `：${detail}`}`)
    }
    return response.json().catch(() => ({}))
  }

  return {
    appId,
    getAccessToken,
    sendToUser: (openid, content, extra) => send('c2c', openid, content, extra),
    sendToGroup: (groupOpenid, content, extra) => send('group', groupOpenid, content, extra),
    sendImageToUser: (openid, imageUrl, extra) => sendImage('c2c', openid, imageUrl, extra),
    sendImageToGroup: (groupOpenid, imageUrl, extra) => sendImage('group', groupOpenid, imageUrl, extra),
    sendVoiceToUser: (openid, silk, extra) => sendVoice('c2c', openid, silk, extra),
    sendVoiceToGroup: (groupOpenid, silk, extra) => sendVoice('group', groupOpenid, silk, extra),
    verifyWebhook: ({ signature, timestamp, body, maxSkewSeconds = 300 }) =>
      verifyWebhookSignature({ secret: appSecret, signature, timestamp, body, now, maxSkewSeconds }),
    parseEvent: parseOfficialEvent
  }
}
