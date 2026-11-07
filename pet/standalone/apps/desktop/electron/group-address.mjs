/**
 * 群聊里「这句话要不要接」的分档。
 *
 * 以前只有一个开关：被 @ 就回，没被 @ 就交给主动开口那套碰运气。
 * 结果是要么完全不理人，要么一开口就像在自言自语。
 *
 * 这里把「别人在说话」拆成四档：
 *
 *   addressed     明确在叫她（@、叫名字）——一定应声
 *   continuation  刚和她说完，对方还在这条线上——顺着接
 *   topic         在聊她参与过的事——可以接，但看分寸
 *   ambient       别人之间的对话——不插嘴
 *
 * 只做判断，不发消息、不落盘。
 */

/** 说完一句话之后，这算「还在同一条线上」的时间。 */
const CONTINUATION_WINDOW_MS = 90_000
/** 话题对得上至少要像到这个程度，太低会把寒暄也算成相关。 */
const TOPIC_MIN_SIMILARITY = 0.12
/** 短到只有几个字的回应，像「嗯」「然后呢」，默认是在接话。 */
const SHORT_REPLY_MAX = 6

export const ADDRESS_LEVELS = ['addressed', 'continuation', 'topic', 'ambient']

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 中文没有空格，用相邻两字片段做很轻的相似度判断。 */
function bigrams(text) {
  const value = String(text ?? '').replace(/\s+/g, '')
  const result = new Set()
  for (let i = 0; i < value.length - 1; i += 1) result.add(value.slice(i, i + 2))
  return result
}

function similarity(a, b) {
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let hit = 0
  for (const item of left) if (right.has(item)) hit += 1
  return hit / Math.max(left.size, right.size)
}

/**
 * 判断这一条消息落在哪一档。
 *
 * @param {object} input
 * @param {string} input.text            这一条的内容
 * @param {boolean} [input.mentioned]    平台确认的 @
 * @param {string[]} [input.wakeWords]   她在这个群被叫的名字
 * @param {{ text?: string, at?: number } | null} [input.lastSpoken]
 *        她上一次在这个群说的话与时间
 * @param {string[]} [input.topics]      她记得的、和这个群有关的事
 * @param {number} [input.now]
 */
export function classifyGroupAddress(input = {}) {
  const text = cleanText(input.text)
  const now = Number.isFinite(input.now) ? input.now : Date.now()

  // 明确叫她：平台给的 @ 比任何猜测都可靠。
  if (input.mentioned === true) {
    return { level: 'addressed', reason: 'mentioned' }
  }

  const wakeWords = Array.isArray(input.wakeWords) ? input.wakeWords : []
  for (const word of wakeWords) {
    const value = cleanText(word)
    if (value !== '' && text.includes(value)) {
      return { level: 'addressed', reason: 'wake-word' }
    }
  }

  const lastSpoken = input.lastSpoken
  if (lastSpoken !== null && typeof lastSpoken === 'object' && Number.isFinite(lastSpoken.at)) {
    const age = now - lastSpoken.at
    if (age >= 0 && age <= CONTINUATION_WINDOW_MS && text !== '') {
      const related = similarity(text, cleanText(lastSpoken.text))
      // 说得久一点但话题接得上，或者只是很短的一声应答，都算还在同一条线上。
      if (related >= TOPIC_MIN_SIMILARITY || Array.from(text).length <= SHORT_REPLY_MAX) {
        return { level: 'continuation', reason: 'recent-turn', similarity: Math.round(related * 1000) / 1000 }
      }
    }
  }

  const topics = Array.isArray(input.topics) ? input.topics : []
  for (const topic of topics) {
    const value = cleanText(topic)
    if (value === '') continue
    const related = similarity(text, value)
    if (related >= TOPIC_MIN_SIMILARITY) {
      return { level: 'topic', reason: 'topic-overlap', similarity: Math.round(related * 1000) / 1000 }
    }
  }

  return { level: 'ambient', reason: 'not-addressed' }
}

/**
 * 给模型的一句分寸说明。
 * 只在真的要接的时候用，避免它把「听见了」当成「在叫我」。
 */
export function describeAddress(level) {
  if (level === 'addressed') return '对方是在叫你，直接应声就好。'
  if (level === 'continuation') return '你刚说过的话，对方还在这条线上，顺着接住就好，不用另起话题。'
  if (level === 'topic') return '他们在聊你参与过的事。想说就接一句，不想说也不必勉强。'
  return ''
}
