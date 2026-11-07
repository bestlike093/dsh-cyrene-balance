/**
 * 连发拆句：把一段长回复拆成两三条，像人一样打完一句先发出去。
 *
 * 拆句只在「够长」时发生。QQ 的被动回复窗口有次数上限，
 * 一句「嗯嗯」也拆成三条，很快就把窗口用光了。
 * 所以这里只按句末标点切，短句一律不拆，最多也只拆三段。
 *
 * 这个模块不负责发消息，也不碰计时器以外的副作用；间隔时间由调用方决定。
 */

const SENTENCE_END = /[。！？!?…～~]/
const HARD_BREAK = /\n+/

/** 把文本切成句子，保留句末标点。 */
function toSentences(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized === '') return []
  const sentences = []
  let buffer = ''
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]
    if (HARD_BREAK.test(char)) {
      if (buffer.trim() !== '') sentences.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += char
    if (SENTENCE_END.test(char)) {
      // 连续的句末标点（「？！」）跟着同一句走。
      while (i + 1 < normalized.length && SENTENCE_END.test(normalized[i + 1])) {
        i += 1
        buffer += normalized[i]
      }
      if (buffer.trim() !== '') sentences.push(buffer.trim())
      buffer = ''
    }
  }
  if (buffer.trim() !== '') sentences.push(buffer.trim())
  return sentences
}

/**
 * 拆成要连发的几段。
 *
 * - 短于 minLength：原样返回，不拆
 * - 只有一句：原样返回，不拆
 * - 按句子尽量平均分，最多 maxParts 段
 * - 任何一段短于 minPart，就并回相邻段
 */
export function splitReply(text, { minLength = 50, maxParts = 3, minPart = 8 } = {}) {
  const source = typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : ''
  if (source === '') return []
  const chars = Array.from(source).length
  if (chars < minLength) return [source]

  const sentences = toSentences(source)
  if (sentences.length < 2) return [source]

  const max = Number.isFinite(maxParts) && maxParts > 0 ? Math.floor(maxParts) : 3
  const parts = []
  let current = ''
  // 目标长度按段数均分，让几条消息看起来差不多长。
  const target = Math.ceil(chars / Math.min(max, sentences.length))
  for (const sentence of sentences) {
    if (current === '') {
      current = sentence
      continue
    }
    const wouldBe = Array.from(current + sentence).length
    // 已经够一段、而且还有位置时，先发这一段。
    if (wouldBe > target && parts.length < max - 1) {
      parts.push(current)
      current = sentence
    } else {
      current += sentence
    }
  }
  if (current !== '') parts.push(current)

  // 太短的段并回前一段，避免出现「嗯。」单独一条。
  const merged = []
  for (const part of parts) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && Array.from(part).length < minPart) {
      merged[merged.length - 1] = previous + part
    } else {
      merged.push(part)
    }
  }
  return merged.length <= 1 ? [source] : merged
}

/**
 * 两条消息之间要等多久：按上一段长度估算打字时间。
 * rng 可注入，测试时用固定值；生产环境传入 Math.random 即可。
 */
export function burstDelay(text, { rng = Math.random, min = 420, max = 1400 } = {}) {
  const chars = typeof text === 'string' ? Array.from(text).length : 0
  const base = Math.min(max, Math.max(min, chars * 45))
  // ±15% 的抖动，避免每次连发都一模一样。
  const jitter = (rng() * 2 - 1) * 0.15
  const delay = Math.round(base * (1 + jitter))
  return Math.min(max, Math.max(min, delay))
}
