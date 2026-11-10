/**
 * 用视觉模型给「自动收下的图」起一个短标签。
 *
 * 设计约束：
 *   - 纯逻辑，不读磁盘、不碰 Electron；fetch 由调用方注入；
 *   - 默认关闭，配置缺失或请求失败都静默回退，绝不影响聊天；
 *   - 只产出 1～2 个短词，写不写进标签表由调用方决定。
 */

const DEFAULT_TIMEOUT_MS = 8000
const MAX_LABELS = 2
const MAX_LABEL_LENGTH = 8

const PROMPT =
  '这是一张聊天表情包。用 1 到 2 个中文短词概括它表达的情绪或动作，每个词不超过 6 个字。' +
  '只输出 JSON 数组，例如 ["开心","蹦跳"]，不要解释。'

function cleanLabels(input) {
  if (!Array.isArray(input)) return []
  const out = []
  for (const raw of input) {
    const text = String(raw ?? '')
      .replace(/["'`「」『』【】\[\]（）()，。、！？!?.,;；:：\s]/g, '')
      .slice(0, MAX_LABEL_LENGTH)
    if (text === '' || out.includes(text)) continue
    out.push(text)
    if (out.length >= MAX_LABELS) break
  }
  return out
}

/** 模型偶尔会带一句解释，先抠出数组，再退回按行/逗号切。 */
export function parseLabels(content) {
  const text = String(content ?? '').trim()
  if (text === '') return []

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      const labels = cleanLabels(parsed)
      if (labels.length > 0) return labels
    } catch {
      /* 落到下面的宽松切分。 */
    }
  }

  return cleanLabels(
    text
      .replace(/^```[a-z]*|```$/gi, '')
      .split(/[\n,，、;；|]+/)
      .map((part) => part.replace(/^[-*\d.\s]+/, ''))
  )
}

function baseUrlOf(raw) {
  const text = String(raw ?? '').trim().replace(/\/+$/, '')
  if (text === '') return ''
  return text.endsWith('/chat/completions') ? text : `${text}/chat/completions`
}

export function createStickerVision({
  fetchImpl = globalThis.fetch,
  baseUrl = '',
  model = '',
  apiKey = '',
  enabled = false,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const url = baseUrlOf(baseUrl)
  const configured = url !== '' && model !== '' && typeof fetchImpl === 'function'
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS

  async function post(body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` })
        },
        body: JSON.stringify({ model, ...body }),
        signal: controller.signal
      })
      if (!response?.ok) {
        return { ok: false, reason: `http-${response?.status ?? 'unknown'}` }
      }
      const json = await response.json()
      const content = json?.choices?.[0]?.message?.content
      const text = Array.isArray(content)
        ? content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
        : content
      return { ok: true, content: typeof text === 'string' ? text : '' }
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, reason: 'timeout' }
      return { ok: false, reason: 'fetch-failed' }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 给一张图起标签；任何失败都只返回原因，不抛异常。 */
  async function describe({ buffer, contentType = 'image/png' } = {}) {
    if (!enabled) return { ok: false, reason: 'disabled' }
    if (!configured) return { ok: false, reason: 'unconfigured' }
    if (!buffer || buffer.length === 0) return { ok: false, reason: 'empty-image' }

    const dataUrl = `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`
    const response = await post({
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    })
    if (!response.ok) return response

    const labels = parseLabels(response.content)
    if (labels.length === 0) return { ok: false, reason: 'empty-labels' }
    return { ok: true, labels }
  }

  /** 设置页的「测试连接」：只发一句话，验证地址、模型、key 是否可用。 */
  async function testConnection() {
    if (!configured) return { ok: false, reason: 'unconfigured' }
    const response = await post({
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }]
    })
    if (!response.ok) return response
    return { ok: true }
  }

  return { describe, testConnection, get configured() { return configured } }
}
