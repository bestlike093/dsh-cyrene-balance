/**
 * QQ 官方 Webhook 的本机接收端。
 *
 * 只监听回环地址，默认 127.0.0.1。要接公网就把隧道指到这里，
 * 不要把端口直接暴露到局域网或公网。
 *
 * 验签在进入业务之前完成：签名不对、时间戳过期、body 过大都直接拒绝，
 * 不会把未验签的内容交给上层。
 */
import { createServer } from 'node:http'
import { signWebhookValidation, verifyWebhookSignature } from './qq-official.mjs'
import { DELIVER } from '../standard.mjs'

const MAX_BODY_BYTES = DELIVER.qqWebhookMaxBodyBytes

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // 只 reject、不 destroy：让外层先写 413 再由响应结束关连接，
        // 先 destroy 的话 response 已经废了，413 写不出去。
        fail(new Error('payload-too-large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => done(Buffer.concat(chunks)))
    request.on('error', fail)
    /* 客户端半路断掉时 reject，别让 Promise 挂在一个永远不会来的 end 上。 */
    request.on('aborted', () => fail(new Error('request-aborted')))
    request.on('close', () => fail(new Error('request-closed')))
  })
}

function replyJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text)
  })
  response.end(text)
}

export function createQqWebhookServer(options = {}) {
  const secret = String(options.secret ?? '').trim()
  if (secret === '') throw new Error('Webhook 需要 AppSecret 验签')
  const path = String(options.path ?? '/qq/webhook')
  const port = Number.isFinite(Number(options.port)) ? Number(options.port) : 17321
  /* 只许监听回环地址：填 0.0.0.0 会把端口暴露到局域网/公网，与上方注释的承诺相悖。 */
  const rawHost = String(options.host ?? '127.0.0.1').trim()
  if (!['127.0.0.1', '::1', 'localhost'].includes(rawHost)) {
    throw new Error('Webhook 只允许监听回环地址（127.0.0.1 / ::1 / localhost）')
  }
  const host = rawHost
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  const now = typeof options.now === 'function' ? options.now : Date.now
  const parseEvent = typeof options.parseEvent === 'function' ? options.parseEvent : null
  const maxSkewSeconds = Number.isFinite(options.maxSkewSeconds) ? options.maxSkewSeconds : 300
  /* B2-005：重放窗口跟着验签窗口走，不另发明一个数字。 */
  const replayWindowSeconds = maxSkewSeconds > 0 ? maxSkewSeconds : 300

  let server = null
  let listening = null
  let lastError = ''
  /*
   * B2-005：messageId → 首次通过时的 x-signature-timestamp（秒）。
   *
   * 改动前 timestamp 只喂给 verifyWebhookSignature 就被丢掉，验签之后也没有按 msgId 的闸，
   * 同一份 body 在 skew 窗口内重放会让 onEvent 再跑一遍。这里把 timestamp 补成去重窗口的
   * 基准：窗口外的同 id 不拦（那是另一条消息，或者验签自己就会拒），窗口内的第二次直接丢。
   *
   * 只记 messageId，不落盘：进程重启后窗口从空开始，这与「重放要在一个 skew 窗口内完成」
   * 是同一件事——重启已经让那个窗口过去了。
   */
  const seenMessages = new Map()
  const MAX_TRACKED_MESSAGES = 2000

  /** 第一次见到返回 false；窗口内的重复返回 true。 */
  function isReplayWithinWindow(messageId, timestamp) {
    const sent = Number(timestamp)
    const current = Number.isFinite(sent) ? sent : Math.floor(now() / 1000)
    const previous = seenMessages.get(messageId)
    if (previous !== undefined && Math.abs(current - previous) <= replayWindowSeconds) return true
    seenMessages.set(messageId, current)
    if (seenMessages.size > MAX_TRACKED_MESSAGES) {
      for (const [key, at] of seenMessages) {
        if (Math.abs(current - at) > replayWindowSeconds) seenMessages.delete(key)
      }
    }
    return false
  }

  async function handle(request, response) {
    if (request.method !== 'POST') {
      replyJson(response, 405, { ok: false, reason: 'method-not-allowed' })
      return
    }
    const url = request.url ?? ''
    if (url.split('?')[0] !== path) {
      replyJson(response, 404, { ok: false, reason: 'not-found' })
      return
    }

    let body
    try {
      body = await readBody(request)
    } catch (error) {
      // 先写 413、再由响应结束自然关连接；不能先 destroy 再写。
      replyJson(response, 413, { ok: false, reason: String(error?.message ?? error) })
      return
    }

    /* 回调配置握手（op 13）不带签名头：它考的是「对方是否持有 Secret」，要当场签回去，
       不能走下面的事件验签。#6 搬运自 worktrees/dsh-pet-audit 那代（副本 :105-126），
       这里只做分流——下面 :143 起的事件流程、B2-005 的 seenMessages 与时间戳基准一字未改。 */
    let handshake = null
    try {
      handshake = JSON.parse(body.toString('utf8'))
    } catch {
      handshake = null
    }
    if (
      handshake !== null && typeof handshake === 'object' && handshake.op === 13 &&
      handshake.d !== null && typeof handshake.d === 'object'
    ) {
      const plainToken = String(handshake.d.plain_token ?? '')
      const eventTs = String(handshake.d.event_ts ?? '')
      if (plainToken !== '' && eventTs !== '') {
        replyJson(response, 200, {
          plain_token: plainToken,
          signature: signWebhookValidation({ secret, eventTs, plainToken })
        })
        return
      }
    }

    const signature = String(request.headers['x-signature-ed25519'] ?? '')
    const timestamp = String(request.headers['x-signature-timestamp'] ?? '')
    const verified = verifyWebhookSignature({
      secret,
      signature,
      timestamp,
      body,
      now,
      maxSkewSeconds
    })
    if (!verified) {
      replyJson(response, 401, { ok: false, reason: 'bad-signature' })
      return
    }

    let payload
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      replyJson(response, 400, { ok: false, reason: 'bad-json' })
      return
    }

    if (onEvent === null) {
      replyJson(response, 200, { ok: true })
      return
    }

    try {
      const event = parseEvent === null ? payload : parseEvent(payload)
      if (event !== null) {
        /* B2-005：验签通过 ≠ 第一次见。同一 msgId 在 skew 窗口内再来一次直接丢，
         * 回 200 让 QQ 别再重推，但业务只跑一次。 */
        const messageId = typeof event.messageId === 'string' ? event.messageId.trim() : ''
        if (messageId !== '' && isReplayWithinWindow(messageId, timestamp)) {
          replyJson(response, 200, { ok: true, duplicate: true })
          return
        }
        await onEvent(event, payload)
      }
      replyJson(response, 200, { ok: true })
    } catch (error) {
      lastError = String(error?.message ?? error)
      /* 业务失败也回 200，避免 QQ 反复重推同一条消息 */
      replyJson(response, 200, { ok: false, reason: 'handled-with-error' })
    }
  }

  async function start() {
    if (listening !== null) return listening
    server = createServer((request, response) => {
      // handle 内部已把业务失败回成 200；这里兜住没包住的意外（比如响应写失败），
      // 别让一个未处理的 rejection 把进程带走。
      void handle(request, response).catch((error) => {
        lastError = String(error?.message ?? error)
        try {
          replyJson(response, 500, { ok: false, reason: 'internal-error' })
        } catch {
          /* 响应已经写不进去就算了，不再二次处理 */
        }
      })
    })
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server?.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server?.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
    const address = server.address()
    listening = {
      host: typeof address === 'object' && address !== null ? address.address : host,
      port: typeof address === 'object' && address !== null ? address.port : port,
      path
    }
    return listening
  }

  async function stop() {
    if (server === null) return
    const closing = server
    server = null
    listening = null
    await new Promise((resolve) => {
      try {
        closing.close(() => resolve())
      } catch (error) {
        // 从没 listen 成功过时 close 会抛 ERR_SERVER_NOT_RUNNING，照常放行，别把 stop 卡死。
        if (error?.code === 'ERR_SERVER_NOT_RUNNING') {
          resolve()
          return
        }
        resolve()
      }
    })
  }

  return {
    start,
    stop,
    status: () => ({ running: listening !== null, address: listening, lastError })
  }
}
