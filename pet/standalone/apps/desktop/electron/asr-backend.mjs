// 语音输入后端：本地 faster-whisper 优先，云端 OpenAI 兼容接口兜底。
//
// 为什么要有这一层：
// - 用户可能两种都想留：云端开箱即用，本地不外传音频。
// - 「接上了就用本地」需要每次调用前做一次轻量探测，而不是启动时拍板一次。
// - 探测失败要能安静回落，麦克风链路不该因为 ASR 没起就整条断掉。
//
// 配置单独存 userData/asr-config.json，不塞进 settings：
// 设置管线会裁剪未知字段，独立文件更稳，也方便用户手改。

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

/** 本地服务默认端口；与 tools/asr/start.ps1 保持一致。 */
export const DEFAULT_LOCAL_URL = 'http://127.0.0.1:8123'
export const CONFIG_FILE = 'asr-config.json'

const DEFAULT_CONFIG = {
  /** 麦克风常开监听。默认关：不开就不申请设备权限。 */
  enabled: false,
  /** cloud=默认走云端；local=只走本机；auto=本机优先。 */
  backend: 'cloud',
  /** backend 为 cloud 时，本机服务一旦就绪就自动切过去（用户要的「接上了就用本机」）。 */
  preferLocal: true,
  localUrl: DEFAULT_LOCAL_URL,
  cloudBaseUrl: 'https://api.openai.com/v1',
  cloudModel: 'whisper-1',
  /** 本地转写用的模型名，独立于云端；faster-whisper 服务端按这个名字加载模型。 */
  localModel: 'small',
  language: 'zh',
  /** 空数组时由调用方给默认词，这里不硬编码。 */
  wakeWords: [],
  /** 唤醒后是否把这句话直接送进对话。 */
  replyAfterWake: false,
  /** 云端超时；本地因为可能首次加载模型，给得宽一些。 */
  cloudTimeoutMs: 20000,
  localTimeoutMs: 45000
}

function normalizeUrl(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return fallback
  if (!/^https?:\/\//i.test(text)) return fallback
  return text.replace(/\/+$/, '')
}

function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const backend = ['auto', 'local', 'cloud'].includes(source.backend) ? source.backend : DEFAULT_CONFIG.backend
  return {
    ...DEFAULT_CONFIG,
    enabled: source.enabled === true,
    backend,
    preferLocal: source.preferLocal !== false,
    localUrl: normalizeUrl(source.localUrl, DEFAULT_LOCAL_URL),
    cloudBaseUrl: normalizeUrl(source.cloudBaseUrl, DEFAULT_CONFIG.cloudBaseUrl),
    cloudModel:
      typeof source.cloudModel === 'string' && source.cloudModel.trim() !== ''
        ? source.cloudModel.trim()
        : DEFAULT_CONFIG.cloudModel,
    localModel:
      typeof source.localModel === 'string' && source.localModel.trim() !== ''
        ? source.localModel.trim()
        : DEFAULT_CONFIG.localModel,
    language:
      typeof source.language === 'string' && source.language.trim() !== ''
        ? source.language.trim()
        : DEFAULT_CONFIG.language,
    wakeWords: Array.isArray(source.wakeWords)
      ? source.wakeWords.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
      : [],
    replyAfterWake: source.replyAfterWake === true,
    cloudTimeoutMs: clampTimeout(source.cloudTimeoutMs, DEFAULT_CONFIG.cloudTimeoutMs),
    localTimeoutMs: clampTimeout(source.localTimeoutMs, DEFAULT_CONFIG.localTimeoutMs)
  }
}

function clampTimeout(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), 3000), 120000)
}

/** 唤醒词比对：去标点、去空白、忽略大小写，命中任意一条即可。 */
export function matchWakeWord(text, words) {
  if (typeof text !== 'string') return null
  const flat = text
    .toLowerCase()
    .replace(/[\s，。！？、,.!?"'“”‘’：:；;…—\-_/\\|()[\]{}]/g, '')
  if (flat === '') return null
  for (const word of words) {
    const target = String(word)
      .toLowerCase()
      .replace(/[\s，。！？、,.!?"'“”‘’：:；;…—\-_/\\|()[\]{}]/g, '')
    if (target !== '' && flat.includes(target)) return word
  }
  return null
}

/**
 * 把 PCM 采样包成 WAV。渲染侧录到的是 Float32 或 Int16 都接受，
 * 统一转成 16 kHz 单声道 16 bit —— Whisper 系模型的标准输入。
 */
export function encodeWav(pcm, sampleRate = 16000) {
  const samples = pcm instanceof Float32Array ? pcm : new Float32Array(pcm)
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + samples.length * 2, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    bytes.writeInt16LE(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, 44 + index * 2)
  }
  return bytes
}

export function createAsrBackend({ userData, getSecret, log = () => {}, describeError = String }) {
  const configPath = path.join(userData, CONFIG_FILE)
  let cached = null
  /** 读进缓存时配置文件的 mtime：文件变了就重读，兑现「手改生效」的承诺。 */
  let cachedMtimeMs = 0
  /** 本地探测结果带短缓存，避免每句话都打一次 /health。 */
  let probeCache = { at: 0, result: null }

  async function readConfig() {
    if (cached !== null) {
      try {
        const info = await stat(configPath)
        if (info.mtimeMs === cachedMtimeMs) return cached
      } catch {
        // stat 读不到（文件被删）就当配置变了，走下面的重读。
      }
    }
    try {
      const parsed = JSON.parse(await readFile(configPath, 'utf8'))
      cached = normalizeConfig(parsed)
      try {
        const info = await stat(configPath)
        cachedMtimeMs = info.mtimeMs
      } catch {
        cachedMtimeMs = 0
      }
    } catch {
      cached = { ...DEFAULT_CONFIG }
      cachedMtimeMs = 0
    }
    return cached
  }

  async function saveConfig(patch) {
    const current = await readConfig()
    const next = normalizeConfig({ ...current, ...(patch !== null && typeof patch === 'object' ? patch : {}) })
    await mkdir(userData, { recursive: true })
    await writeFile(configPath, JSON.stringify(next, null, 2))
    cached = next
    // mtime 归零：下一次 readConfig 重新读盘，缓存和磁盘保持一致。
    cachedMtimeMs = 0
    probeCache = { at: 0, result: null }
    return next
  }

  async function probeLocal(force = false) {
    const now = Date.now()
    if (!force && probeCache.result !== null && now - probeCache.at < 30000) {
      return probeCache.result
    }
    const config = await readConfig()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1200)
    let result = { available: false, url: config.localUrl, model: null, reason: null }
    try {
      const response = await fetch(config.localUrl + '/health', { signal: controller.signal })
      if (response.ok) {
        const body = await response.json().catch(() => ({}))
        result = {
          available: body?.ok === true,
          url: config.localUrl,
          model: typeof body?.model === 'string' ? body.model : null,
          reason: body?.ok === true ? null : 'health_not_ok'
        }
      } else {
        result = { available: false, url: config.localUrl, model: null, reason: `http_${response.status}` }
      }
    } catch (error) {
      result = {
        available: false,
        url: config.localUrl,
        model: null,
        reason: error?.name === 'AbortError' ? 'timeout' : 'unreachable'
      }
    } finally {
      clearTimeout(timer)
    }
    probeCache = { at: now, result }
    return result
  }

  /** 依据配置与探测结果决定这次走哪条路。 */
  async function resolveBackend() {
    const config = await readConfig()
    // 只走云端，且明确关掉了自动接管
    if (config.backend === 'cloud' && config.preferLocal !== true) {
      return { kind: 'cloud', config, local: null }
    }
    const local = await probeLocal()
    if (local.available) return { kind: 'local', config, local }
    if (config.backend === 'local') return { kind: null, config, local, reason: 'local_unavailable' }
    // cloud + preferLocal：本机没接上就安静回落云端
    return { kind: 'cloud', config, local }
  }

  async function postMultipart(url, buffer, config, timeoutMs, model) {
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: 'audio/wav' }), 'clip.wav')
    form.append('language', config.language)
    // 模型名由调用方给：本地用 localModel，云端用 cloudModel，不混用。
    form.append('model', model)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { method: 'POST', body: form, signal: controller.signal })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`ASR ${response.status}: ${text.slice(0, 200)}`)
      }
      let parsed = null
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('ASR 返回的不是 JSON')
      }
      return typeof parsed?.text === 'string' ? parsed.text.trim() : ''
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 转写一段 WAV。返回 { ok, text, backend, error }，不抛异常：
   * 麦克风链路里一次失败不该把监听器带走。
   */
  async function transcribe(wavBuffer, options = {}) {
    if (!Buffer.isBuffer(wavBuffer) || wavBuffer.length < 44) {
      return { ok: false, backend: null, text: '', error: 'empty_audio' }
    }
    const resolved = await resolveBackend()
    if (resolved.kind === null) {
      return { ok: false, backend: null, text: '', error: resolved.reason ?? 'no_backend' }
    }

    const config = { ...resolved.config, ...(options.language ? { language: options.language } : {}) }
    try {
      if (resolved.kind === 'local') {
        const text = await postMultipart(
          config.localUrl + '/v1/audio/transcriptions',
          wavBuffer,
          config,
          config.localTimeoutMs,
          config.localModel
        )
        return { ok: true, backend: 'local', text, error: null }
      }
      const key = typeof getSecret === 'function' ? await getSecret() : ''
      if (typeof key !== 'string' || key === '') {
        return { ok: false, backend: 'cloud', text: '', error: 'cloud_key_missing' }
      }
      const url = `${config.cloudBaseUrl}/audio/transcriptions`
      const form = new FormData()
      form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'clip.wav')
      form.append('model', config.cloudModel)
      form.append('language', config.language)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.cloudTimeoutMs)
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: controller.signal
        })
        const text = await response.text()
        if (!response.ok) {
          return { ok: false, backend: 'cloud', text: '', error: `ASR ${response.status}: ${text.slice(0, 200)}` }
        }
        const parsed = JSON.parse(text)
        return {
          ok: true,
          backend: 'cloud',
          text: typeof parsed?.text === 'string' ? parsed.text.trim() : '',
          error: null
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      log('[asr] transcribe failed:', describeError(error))
      return {
        ok: false,
        backend: resolved.kind,
        text: '',
        error: error?.name === 'AbortError' ? 'timeout' : describeError(error)
      }
    }
  }

  async function status() {
    const config = await readConfig()
    const local = await probeLocal(true)
    const resolved = await resolveBackend()
    const key = typeof getSecret === 'function' ? await getSecret().catch(() => '') : ''
    return {
      ok: true,
      config,
      local,
      activeBackend: resolved.kind,
      cloudConfigured: typeof key === 'string' && key !== ''
    }
  }

  return { readConfig, saveConfig, probeLocal, transcribe, status, matchWakeWord }
}
