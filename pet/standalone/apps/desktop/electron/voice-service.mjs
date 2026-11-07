// 语音请求的先决判断与本地服务探测。
// 拆出来是为了能在 Node 里直接跑自测，不必拉起 Electron。
import http from 'node:http'
import https from 'node:https'
import { shouldSpeakNow } from '../../../packages/shared/dist/index.js'
import { quietModeAt } from '../dist/main/quiet-mode.js'

/** 本地合成地址补成 /tts：设置里只填端口，省得每个人都要记住路径。 */
export function toTtsEndpoint(baseUrl) {
  const trimmed = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return ''
  return /\/tts$/i.test(trimmed) ? trimmed : `${trimmed}/tts`
}

/** 判断地址是否回环；URL 解析失败或 host 非回环都返回 false。 */
export function isLoopbackEndpoint(endpoint) {
  try {
    const target = new URL(endpoint)
    const host = target.hostname.replace(/^\[|\]$/g, '')
    return ['127.0.0.1', '::1', 'localhost'].includes(host)
  } catch {
    return false
  }
}

/**
 * 短探一下本地合成服务还在不在。
 *
 * 只要求「有人应答」：GPT-SoVITS 的 /tts 只收 POST，GET 回 405 也算在线。
 * 只连回环地址，避免设置页填了一个外网地址就把台词发出去。
 */
export function probeTtsEndpoint(endpoint, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let target
    try {
      target = new URL(endpoint)
    } catch {
      resolve({ ok: false, error: 'bad-url' })
      return
    }

    const host = target.hostname.replace(/^\[|\]$/g, '')
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
      resolve({ ok: false, error: 'not-loopback' })
      return
    }

    const client = target.protocol === 'https:' ? https : http
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const request = client.get(target, { timeout: timeoutMs }, (response) => {
      response.resume()
      finish({ ok: true, status: Number(response.statusCode ?? 0) })
    })
    request.on('timeout', () => {
      request.destroy()
      finish({ ok: false, error: 'timeout' })
    })
    request.on('error', (error) => {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
  })
}

/**
 * 这一次请求该不该合成。
 *
 * manual（点小喇叭）只受总开关和免打扰约束；auto 还要看触发时机与最小间隔。
 * 夜间不扰（陪伴页）统管自动朗读：时段内 auto 一律静音；manual 是使用者的明确动作，不拦。
 * 返回 ok:true 时把要念的文本（已按 maxChars 截断）和合成参数一起交出去。
 */
export function planSpeak({
  voice,
  quiet,
  text,
  reason = 'auto',
  now = Date.now(),
  lastAutoSpeakAt = 0
}) {
  const rawText = typeof text === 'string' ? text.trim() : ''
  if (rawText.length === 0) return { ok: false, reason: 'empty' }

  const speakReason = reason === 'manual' ? 'manual' : 'auto'
  if (!shouldSpeakNow(voice, speakReason, new Date(now))) return { ok: false, reason: 'silent' }
  if (speakReason === 'auto' && quietModeAt(new Date(now), quiet) !== 'off') {
    return { ok: false, reason: 'quiet-hours' }
  }
  if (voice.provider !== 'local') return { ok: false, reason: 'cloud-not-ready' }

  const refAudioPath = String(voice.refAudioPath ?? '').trim()
  if (refAudioPath.length === 0) return { ok: false, reason: 'no-ref-audio' }

  const endpoint = toTtsEndpoint(voice.localUrl)
  if (endpoint.length === 0) return { ok: false, reason: 'no-endpoint' }

  // 自动念的时候按最小间隔节流；点小喇叭不受限制。
  if (speakReason === 'auto') {
    const gapSeconds = Number(voice.minIntervalSeconds)
    if (Number.isFinite(gapSeconds) && gapSeconds > 0 && now - lastAutoSpeakAt < gapSeconds * 1000) {
      return { ok: false, reason: 'rate-limited' }
    }
  }

  // 超长只念前面一段：设置项写的是「超出部分不念」，不能把整段独白都送出去。
  const maxChars = Number(voice.maxChars)
  const spoken =
    Number.isFinite(maxChars) && maxChars > 0
      ? Array.from(rawText).slice(0, Math.trunc(maxChars)).join('')
      : rawText

  return {
    ok: true,
    text: spoken,
    endpoint,
    refAudioPath,
    protocol: voice.localProtocol ?? 'gpt-sovits',
    promptLang: voice.promptLang ?? 'zh',
    // 只有自动开口才推进节流时间；manual 不该让下一句自动台词被挡。
    autoSpeakAt: speakReason === 'auto' ? now : null
  }
}
