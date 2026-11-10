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
 * 拼两段：前段不以空白结尾时补一个空格。
 * 句子切完都 trim 过，直接相加会把英文粘成 Hello.World.；
 * 中文补空格也不影响阅读，所以统一在这里补。
 */
function joinParts(left, right) {
  const l = typeof left === 'string' ? left : ''
  const r = typeof right === 'string' ? right : ''
  if (l === '') return r
  if (r === '') return l
  return /\s$/.test(l) ? l + r : `${l} ${r}`
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
  // minPart 只认真正数：负数 / 0 / NaN 会让「太短的段并回前一段」整个失效，按默认值走。
  const min = Number.isFinite(minPart) && minPart > 0 ? Math.floor(minPart) : 8
  const parts = []
  let current = ''
  // 目标长度按段数均分，让几条消息看起来差不多长。
  const target = Math.ceil(chars / Math.min(max, sentences.length))
  for (const sentence of sentences) {
    if (current === '') {
      current = sentence
      continue
    }
    const wouldBe = Array.from(joinParts(current, sentence)).length
    // 已经够一段、而且还有位置时，先发这一段。
    if (wouldBe > target && parts.length < max - 1) {
      parts.push(current)
      current = sentence
    } else {
      current = joinParts(current, sentence)
    }
  }
  if (current !== '') parts.push(current)

  // 太短的段并回相邻段，避免出现「嗯。」单独一条。
  // 第一段就短时没有前段可并：先压住，等下一段进来时往前并（向前并）；
  // 全部段都短时，压住的头段最后作为整体落下来，最终只剩一段就退回原文。
  const merged = []
  let pendingHead = null
  for (const part of parts) {
    const previous = merged[merged.length - 1]
    const short = Array.from(part).length < min
    if (short && previous !== undefined) {
      merged[merged.length - 1] = joinParts(previous, part)
    } else if (short && pendingHead !== null) {
      pendingHead = joinParts(pendingHead, part)
    } else if (short) {
      pendingHead = part
    } else if (pendingHead !== null) {
      merged.push(joinParts(pendingHead, part))
      pendingHead = null
    } else {
      merged.push(part)
    }
  }
  if (pendingHead !== null) merged.push(pendingHead)
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
  // rng 返回值要验有限性，NaN 会一路把 delay 带成 NaN 毫秒；
  // 非有限数按中点 0.5（不抖动）处理。
  const raw = rng()
  const value = Number.isFinite(Number(raw)) ? Number(raw) : 0.5
  const jitter = (value * 2 - 1) * 0.15
  const delay = Math.round(base * (1 + jitter))
  return Math.min(max, Math.max(min, delay))
}
