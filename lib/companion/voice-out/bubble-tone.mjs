/**
 * 气泡句末的轻调制。
 *
 * 只碰句末：换掉末尾那个标点，或者在句尾补一个语气词。
 * 正文在实现上原样拼回，没有任何「先改一遍再比对」的路径。
 *
 * 三条硬边界：
 *   1. 只作用于主动开口这条气泡通道，不进回复正文，也不补 turn 槽。
 *   2. 问句、感叹句整句放过：换掉问号会改句子类型，那已经不是表层了。
 *   3. 纯函数，不落盘、不参与排序；同一段文本配同一个温度，永远同一个结果。
 *
 * 温度取 0~1 的小标量，越高越容易在句尾多一点温度。低于 0.35 直接不加工，
 * 陌生关系下她说的话保持原样；封顶是一处，最多只动句末那一个位置。
 */

/* 末尾这些标点可以被替换；问号、感叹号不在其中，前面就拦下了 */
const ENDING_PUNCT = /[。.…～~♪]+$/

/* 句末的表情标记要原样保留，标记本身永远不参与调制 */
const EMOJI_TAG = /(\s*\[图:[^\]]*\])$/

/* 已经带语气词的句子不再追加，免得出现「啦啦」「呢呀」 */
const HAS_TONE = /[♪呀啦呢哦嘛～]$/

const WARM_ENDINGS = ['♪', '呀', '啦']
const SOFT_ENDINGS = ['～', '呢', '哦']

/** 32 位字符串散列：同一段文本永远同一个种子。 */
function seedOf(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 0~1 的稳定伪随机。 */
function unitOf(seed) {
  const value = Math.sin(Number(seed) || 0) * 10000
  return value - Math.floor(value)
}

/**
 * 给气泡句末加一点温度。
 *
 * @param {string} text 已经成句的气泡文本
 * @param {{ warmth?: number|null, enabled?: boolean }} options
 *   warmth 取 0~1；不是有限数就原样返回。enabled=false 整条关掉。
 * @returns {string} 只可能等于原文，或原文 + 一个句末语气词
 */
export function bubbleTone(text, { warmth = null, enabled = true } = {}) {
  const raw = typeof text === 'string' ? text : ''
  if (raw === '' || enabled === false) return raw

  const value = Number(warmth)
  if (!Number.isFinite(value)) return raw
  const level = Math.min(1, Math.max(0, value))
  /*
   * 三个区间：
   *   < 0.35        不加工，原文照出；
   *   0.35 ~ 0.65   加工，用默认词表；
   *   >= 0.65       加工，换暖词表。
   * 0.35 决定做不做，0.65 只换词、不拦人。
   * 随温度单调的是「追加句末的概率」，不是改动比例——换词那天比例会跳一下。
   */
  if (level < 0.35) return raw

  const tagMatch = raw.match(EMOJI_TAG)
  const tag = tagMatch === null ? '' : tagMatch[1]
  const core = tag === '' ? raw : raw.slice(0, raw.length - tag.length)
  if (core === '') return raw

  /* 问句和感叹句不改：句子类型属于内容，不属于句末 */
  if (/[？?！!]$/.test(core)) return raw

  const punctMatch = core.match(ENDING_PUNCT)
  const body = punctMatch === null ? core : core.slice(0, core.length - punctMatch[0].length)
  if (body.trim() === '') return raw
  if (HAS_TONE.test(body)) return raw

  /*
   * 右引号收尾的 note 不追加语气词。
   *
   * 带 memo 的 note 常写成「……」，句末在引号内；此时把「呀」拼到整串
   * 末尾，会落在右引号外面，变成「……」呀。引号内句末的位置无法从
   * 纯文本可靠判断，所以这里整句跳过，正文 token 原样保留。
   * 纯文本（末尾不是右引号）仍走下面的旧后处理。
   */
  if (/[」』”’]$/.test(body)) return raw

  /*
   * 掷骰只用文本当种子，不掺温度：温度只抬阈值，不换随机数。
   * 否则同一句话会因为温度变化重掷，改动比例也就不再随温度单调。
   */
  const roll = unitOf(seedOf(core))
  const chance = 0.12 + level * 0.38
  if (roll > chance) return raw

  /* 只决定用哪一组词，不参与「做不做」的判断。 */
  const pool = level >= 0.65 ? WARM_ENDINGS : SOFT_ENDINGS
  const index = Math.floor(unitOf(seedOf(core) + 7) * pool.length) % pool.length
  return body + pool[index] + tag
}
