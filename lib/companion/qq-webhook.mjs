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
import { verifyWebhookSignature } from './qq-official.mjs'

const MAX_BODY_BYTES = 256 * 1024

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
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
  const host = String(options.host ?? '127.0.0.1')
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  const now = typeof options.now === 'function' ? options.now : Date.now
  const parseEvent = typeof options.parseEvent === 'function' ? options.parseEvent : null
  const maxSkewSeconds = Number.isFinite(options.maxSkewSeconds) ? options.maxSkewSeconds : 300

  let server = null
  let listening = null
  let lastError = ''

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
      replyJson(response, 413, { ok: false, reason: String(error?.message ?? error) })
      return
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
      if (event !== null) await onEvent(event, payload)
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
      void handle(request, response)
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
    await new Promise((resolve) => closing.close(() => resolve()))
  }

  return {
    start,
    stop,
    status: () => ({ running: listening !== null, address: listening, lastError })
  }
}
