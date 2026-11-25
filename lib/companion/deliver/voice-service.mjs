// 语音请求的先决判断与本地服务探测。
// 拆出来是为了能在 Node 里直接跑自测，不必拉起 Electron。
import http from 'node:http'
import https from 'node:https'
import { shouldSpeakNow, presenceQuietModeAt as quietModeAt } from '../speak/quiet-hours.mjs'
import { TIME } from '../standard.mjs'

/** 云端音频上限 8MB：约 4 分钟 16kHz/16bit 单声道，够念一句话且有富余。 */
const CLOUD_AUDIO_MAX_BYTES = 8 * 1024 * 1024

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
 * 云端合成地址校验：必须 https，且不能是回环。
 *
 * 回环请走本机 TTS 那条路（它不要求 https）；云端走明文 http 等于把台词
 * 和 key 一起裸奔，直接拒。返回规范化后的地址，不合格返回 ''。
 */
export function normalizeCloudTtsEndpoint(endpoint) {
  const trimmed = String(endpoint ?? '').trim()
  if (trimmed === '') return ''
  let target
  try {
    target = new URL(trimmed)
  } catch {
    return ''
  }
  if (target.protocol !== 'https:') return ''
  const host = target.hostname.replace(/^\[|\]$/g, '')
  if (['127.0.0.1', '::1', 'localhost'].includes(host)) return ''
  return target.href
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
 * 向本机 TTS 发一次合成请求。
 *
 * 只接受回环地址；返回原始 WAV 字节，交给上层落盘或直接播。
 * 合成可能比探测慢很多，默认给 60 秒，超时由调用方决定怎么退回。
 */
export function synthesizeSpeech({
  endpoint,
  text,
  refAudioPath,
  promptLang = 'zh',
  timeoutMs = TIME.MINUTE
}) {
  return new Promise((resolve) => {
    const spoken = typeof text === 'string' ? text.trim() : ''
    if (spoken === '') {
      resolve({ ok: false, error: 'empty-text' })
      return
    }
    const ref = String(refAudioPath ?? '').trim()
    if (ref === '') {
      resolve({ ok: false, error: 'no-ref-audio' })
      return
    }

    let target
    try {
      target = new URL(toTtsEndpoint(endpoint))
    } catch {
      resolve({ ok: false, error: 'bad-url' })
      return
    }
    if (!isLoopbackEndpoint(target.href)) {
      resolve({ ok: false, error: 'not-loopback' })
      return
    }

    const body = Buffer.from(
      JSON.stringify({
        text: spoken,
        ref_audio_path: ref,
        prompt_lang: promptLang,
        text_lang: promptLang,
        media_type: 'wav'
      }),
      'utf8',
    )
    const client = target.protocol === 'https:' ? https : http
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const request = client.request(
      target,
      {
        method: 'POST',
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => {
          chunks.push(chunk)
        })
        response.on('end', () => {
          const audio = Buffer.concat(chunks)
          if (Number(response.statusCode ?? 0) !== 200) {
            const detail = audio.toString('utf8').slice(0, 300)
            finish({ ok: false, error: `http-${response.statusCode}`, detail })
            return
          }
          if (audio.length < 12 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
            finish({ ok: false, error: 'not-wav' })
            return
          }
          finish({ ok: true, audio, format: 'wav' })
        })
        response.on('error', (error) => {
          finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      },
    )
    request.on('timeout', () => {
      request.destroy()
      finish({ ok: false, error: 'timeout' })
    })
    request.on('error', (error) => {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    request.end(body)
  })
}

/**
 * 向云端 TTS 发一次合成请求（OpenAI 兼容 /v1/audio/speech 契约）。
 *
 * 只收 https 非回环地址；key 走 Authorization 头，不进 URL、不落日志。
 * 统一要 wav：本机播放和 QQ 转 silk 都吃 wav，省一层解码。
 * 响应超过 8MB 直接判坏，不让一段异常返回把内存吃穿。
 */
export function synthesizeCloudSpeech({
  endpoint,
  apiKey,
  model,
  voice,
  text,
  timeoutMs = 30000
}) {
  return new Promise((resolve) => {
    const spoken = typeof text === 'string' ? text.trim() : ''
    if (spoken === '') {
      resolve({ ok: false, error: 'empty-text' })
      return
    }
    const key = String(apiKey ?? '').trim()
    if (key === '') {
      resolve({ ok: false, error: 'no-api-key' })
      return
    }
    const target = normalizeCloudTtsEndpoint(endpoint)
    if (target === '') {
      resolve({ ok: false, error: 'bad-url' })
      return
    }

    const body = Buffer.from(
      JSON.stringify({
        model: String(model ?? ''),
        input: spoken,
        voice: String(voice ?? ''),
        response_format: 'wav'
      }),
      'utf8',
    )
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const request = https.request(
      new URL(target),
      {
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          Authorization: `Bearer ${key}`,
        },
      },
      (response) => {
        const chunks = []
        let total = 0
        response.on('data', (chunk) => {
          total += chunk.length
          /* 边收边判：超上限立刻断开，不等对方把整段灌完。 */
          if (total > CLOUD_AUDIO_MAX_BYTES) {
            request.destroy()
            finish({ ok: false, error: 'too-large' })
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (settled) return
          const audio = Buffer.concat(chunks)
          if (Number(response.statusCode ?? 0) !== 200) {
            /* 错误详情可能带回显的请求体，只留前 200 字且不进日志。 */
            const detail = audio.toString('utf8').slice(0, 200)
            finish({ ok: false, error: `http-${response.statusCode}`, detail })
            return
          }
          if (audio.length < 12 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
            finish({ ok: false, error: 'not-wav' })
            return
          }
          finish({ ok: true, audio, format: 'wav' })
        })
        response.on('error', (error) => {
          finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      },
    )
    request.on('timeout', () => {
      request.destroy()
      finish({ ok: false, error: 'timeout' })
    })
    request.on('error', (error) => {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    request.end(body)
  })
}

/**
 * 这一次请求该不该合成。
 *
 * manual（点小喇叭）只受总开关和免打扰约束；auto 还要看触发时机与最小间隔。
 * 夜间不扰（陪伴页）统管自动开口：时段内 auto 一律静音；manual 是使用者的明确动作，不拦。
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

  /* 合成参数按引擎分支装配：缺料就地报原因，不把半套参数交给调用方。 */
  let synth = null
  if (voice.provider === 'cloud') {
    /* 云端：地址必须 https 非回环，模型与 key 缺一不可，缺了就如实报原因。 */
    const cloudEndpoint = normalizeCloudTtsEndpoint(voice.cloudUrl)
    if (cloudEndpoint === '') return { ok: false, reason: 'no-endpoint' }
    const cloudModel = String(voice.cloudModel ?? '').trim()
    if (cloudModel === '') return { ok: false, reason: 'no-model' }
    const cloudApiKey = String(voice.cloudApiKey ?? '').trim()
    if (cloudApiKey === '') return { ok: false, reason: 'no-api-key' }
    synth = {
      cloudEndpoint,
      cloudModel,
      cloudVoice: String(voice.cloudVoice ?? '').trim(),
      cloudApiKey,
    }
  } else if (voice.provider === 'local') {
    const refAudioPath = String(voice.refAudioPath ?? '').trim()
    if (refAudioPath.length === 0) return { ok: false, reason: 'no-ref-audio' }

    const endpoint = toTtsEndpoint(voice.localUrl)
    if (endpoint.length === 0) return { ok: false, reason: 'no-endpoint' }

    synth = {
      endpoint,
      refAudioPath,
      protocol: voice.localProtocol ?? 'gpt-sovits',
      promptLang: voice.promptLang ?? 'zh',
    }
  } else {
    /* 系统语音由客户端自己念，不走合成；其余值一律当没准备好。 */
    return { ok: false, reason: 'cloud-not-ready' }
  }

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
    provider: voice.provider,
    text: spoken,
    ...synth,
    // 只有自动开口才推进节流时间；manual 不该让下一句自动台词被挡。
    autoSpeakAt: speakReason === 'auto' ? now : null
  }
}
