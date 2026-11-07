/**
 * 向量检索：把「意思相近」补到 BM25 之上。
 *
 * 为什么不内置模型：DeepSeek 没有 embeddings 端点，本机也没装 Ollama；
 * 直接塞一个 onnxruntime 加模型会多出上百 MB，打包还要处理原生模块。
 * 这里只做协议适配：填一家兼容 /embeddings 的服务，或者本机起了 Ollama，
 * 就自动用；都没有就安静地退回纯 BM25，不报错、不拖慢检索。
 *
 * 两种协议：
 *   openai —— POST {baseUrl}/embeddings，OpenAI 兼容（硅基流动、智谱、官方都行）
 *   ollama —— POST {baseUrl}/api/embed，本地默认 127.0.0.1:11434
 */
import { createHash } from 'node:crypto'

/** 检索默认配置。provider=auto 时先看有没有填 baseUrl，再探本地 Ollama。 */
export const DEFAULT_EMBEDDING = {
  provider: 'auto',
  baseUrl: '',
  model: '',
  apiKey: '',
  /** 检索卡在回复主路径上，宁可这轮不算，也不能让对方等八秒。 */
  timeoutMs: 1_500,
  batchSize: 16,
  cacheSize: 512,
  /** 余弦低于这个值就当不相关，避免负相关被抬成 0。 */
  minSimilarity: 0.2
}

/** 各协议的默认模型。openai 兼容没有统一型号，必须自己填。 */
const DEFAULT_MODELS = {
  openai: '',
  ollama: 'bge-m3'
}

const PROBE_TTL_MS = 5 * 60_000
const OLLAMA_BASE = 'http://127.0.0.1:11434'

function cleanString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

/** 把设置里的零散字段收成一份可用配置；非法值回落到默认。 */
export function normalizeConfig(raw) {
  const source = raw ?? {}
  const provider = ['auto', 'openai', 'ollama', 'off'].includes(source.provider)
    ? source.provider
    : DEFAULT_EMBEDDING.provider
  const baseUrl = cleanString(source.baseUrl)
  const model = cleanString(source.model)
  const apiKey = cleanString(source.apiKey)
  const timeoutMs = Number(source.timeoutMs)
  const batchSize = Number(source.batchSize)
  const cacheSize = Number(source.cacheSize)
  const minSimilarity = Number(source.minSimilarity)
  return {
    provider,
    baseUrl,
    model,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(Math.max(timeoutMs, 1_000), 30_000)
      : DEFAULT_EMBEDDING.timeoutMs,
    batchSize: Number.isFinite(batchSize) && batchSize > 0
      ? Math.min(Math.max(Math.round(batchSize), 1), 64)
      : DEFAULT_EMBEDDING.batchSize,
    cacheSize: Number.isFinite(cacheSize) && cacheSize > 0
      ? Math.min(Math.max(Math.round(cacheSize), 16), 4_096)
      : DEFAULT_EMBEDDING.cacheSize,
    minSimilarity: Number.isFinite(minSimilarity)
      ? Math.min(Math.max(minSimilarity, 0), 1)
      : DEFAULT_EMBEDDING.minSimilarity
  }
}

/** 内容指纹：同一段文字换服务或换模型都要重新算，所以模型也进 key。 */
export function fingerprint(model, text) {
  return createHash('sha1').update(`${model}\u0000${text}`, 'utf8').digest('hex')
}

/**
 * 余弦相似度映射到 0..1。
 * 负相关直接记 0：记忆检索里「相反」没有意义，抬高反而抢名额。
 */
export function similarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0) return 0
  if (left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index])
    const b = Number(right[index])
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  const cosine = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
  return Math.min(Math.max(cosine, 0), 1)
}

/**
 * @param {object} options
 * @param {() => object} options.getConfig   每次调用都读，设置改完立即生效
 * @param {Function} [options.fetchImpl]
 * @param {(message: string, error?: unknown) => void} [options.log]
 * @param {() => number} [options.now]
 */
export function createEmbeddingService({
  getConfig,
  fetchImpl = globalThis.fetch,
  log = () => {},
  now = Date.now
} = {}) {
  /** @type {Map<string, number[]>} */
  const cache = new Map()
  /** @type {{ at: number, provider: string, reason: string }|null} */
  let probe = null

  function cacheGet(key) {
    if (!cache.has(key)) return null
    const value = cache.get(key)
    // 触碰一下，维持 LRU 顺序。
    cache.delete(key)
    cache.set(key, value)
    return value
  }

  function cacheSet(key, value, limit) {
    cache.set(key, value)
    while (cache.size > limit) {
      const oldest = cache.keys().next()
      if (oldest.done === true) break
      cache.delete(oldest.value)
    }
  }

  /** 按协议拼请求。返回 null 表示这份配置不完整。 */
  function buildRequest(config, texts) {
    if (config.provider === 'ollama') {
      const base = (config.baseUrl === '' ? OLLAMA_BASE : config.baseUrl).replace(/\/+$/, '')
      return {
        url: `${base}/api/embed`,
        headers: { 'Content-Type': 'application/json' },
        body: { model: config.model === '' ? DEFAULT_MODELS.ollama : config.model, input: texts }
      }
    }
    if (config.provider === 'openai') {
      if (config.baseUrl === '' || config.model === '') return null
      const base = config.baseUrl.replace(/\/+$/, '')
      const headers = { 'Content-Type': 'application/json' }
      if (config.apiKey !== '') headers.Authorization = `Bearer ${config.apiKey}`
      return {
        url: `${base}/embeddings`,
        headers,
        body: { model: config.model, input: texts }
      }
    }
    return null
  }

  /** 从两种响应里取二维数组；结构不对就当失败。 */
  function readVectors(payload, expected) {
    const list = Array.isArray(payload?.data)
      ? payload.data.map((item) => item?.embedding)
      : Array.isArray(payload?.embeddings)
        ? payload.embeddings
        : null
    if (list === null || list.length !== expected) return null
    for (const vector of list) {
      if (!Array.isArray(vector) || vector.length === 0) return null
    }
    return list
  }

  /**
   * 探测该用哪条路。
   * - 明确指定 provider 就用它，不再猜；
   * - auto：填了 baseUrl 走 openai，没填就短探一次本地 Ollama；
   * - 探测结果缓存 5 分钟，避免每轮检索都打一次超时请求。
   */
  async function resolveConfig() {
    const config = normalizeConfig(getConfig?.())
    if (config.provider !== 'auto') return config

    const stamp = now()
    if (probe !== null && stamp - probe.at < PROBE_TTL_MS) {
      if (probe.provider === 'off') return { ...config, provider: 'off' }
      return { ...config, provider: probe.provider }
    }

    if (config.baseUrl !== '') {
      probe = { at: stamp, provider: 'openai', reason: 'baseUrl' }
      return { ...config, provider: 'openai' }
    }

    const reachable = await probeOllama(config.timeoutMs)
    probe = reachable
      ? { at: stamp, provider: 'ollama', reason: 'local' }
      : { at: stamp, provider: 'off', reason: 'no-backend' }
    return { ...config, provider: reachable ? 'ollama' : 'off' }
  }

  async function probeOllama(timeoutMs) {
    if (typeof fetchImpl !== 'function') return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 1_200))
    timer.unref?.()
    try {
      const response = await fetchImpl(`${OLLAMA_BASE}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      })
      return response?.ok === true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 批量取向量。命中缓存的不再请求。
   * 返回 Map<文本, 向量>；失败返回 null，调用方退回 BM25。
   */
  async function embedTexts(texts, config) {
    const pending = []
    const resolved = new Map()
    for (const text of texts) {
      const key = fingerprint(config.model, text)
      const hit = cacheGet(key)
      if (hit !== null) {
        resolved.set(text, hit)
      } else if (!resolved.has(text)) {
        pending.push(text)
      }
    }
    if (pending.length === 0) return resolved
    if (typeof fetchImpl !== 'function') return null

    for (let start = 0; start < pending.length; start += config.batchSize) {
      const batch = pending.slice(start, start + config.batchSize)
      const request = buildRequest(config, batch)
      if (request === null) return null

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      timer.unref?.()
      try {
        const response = await fetchImpl(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal
        })
        if (response?.ok !== true) return null
        const payload = await response.json()
        const vectors = readVectors(payload, batch.length)
        if (vectors === null) return null
        for (let index = 0; index < batch.length; index += 1) {
          const text = batch[index]
          const vector = vectors[index]
          resolved.set(text, vector)
          cacheSet(fingerprint(config.model, text), vector, config.cacheSize)
        }
      } catch (error) {
        log('向量请求失败，本轮退回本地检索', error)
        return null
      } finally {
        clearTimeout(timer)
      }
    }
    return resolved
  }

  /**
   * 给 memory.search 用的入口。
   * @param {string} query
   * @param {Array<{id: string, text: string}>} items
   * @returns {Promise<Map<string, number>|null>} id → 0..1；不可用返回 null
   */
  async function scoreAll(query, items) {
    const text = cleanString(query)
    if (text === '') return null
    if (!Array.isArray(items) || items.length === 0) return null

    const config = await resolveConfig()
    if (config.provider === 'off') return null

    const candidates = items
      .map((item) => ({
        id: typeof item?.id === 'string' ? item.id : '',
        text: cleanString(item?.text)
      }))
      .filter((item) => item.id !== '' && item.text !== '')
    if (candidates.length === 0) return null

    const vectors = await embedTexts([text, ...candidates.map((item) => item.text)], config)
    if (vectors === null) return null
    const queryVector = vectors.get(text)
    if (queryVector === undefined) return null

    const scores = new Map()
    for (const item of candidates) {
      const vector = vectors.get(item.text)
      if (vector === undefined) continue
      const value = similarity(queryVector, vector)
      // 低于门槛的不写进去，让 BM25 独自决定这条。
      if (value >= config.minSimilarity) scores.set(item.id, value)
    }
    return scores.size > 0 ? scores : null
  }

  /** 设置页/诊断用：当前实际走哪条路，以及为什么。 */
  async function status() {
    const config = await resolveConfig()
    return {
      provider: config.provider,
      model: config.model === '' ? DEFAULT_MODELS[config.provider] ?? '' : config.model,
      baseUrl: config.baseUrl,
      cacheSize: cache.size,
      reason: config.provider === 'off' ? probe?.reason ?? 'not-configured' : 'ready'
    }
  }

  function clearCache() {
    cache.clear()
    probe = null
  }

  return { scoreAll, status, clearCache, resolveConfig }
}
