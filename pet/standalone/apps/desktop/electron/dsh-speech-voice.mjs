/**
 * 让念出来的话像人说的。
 *
 * DSH 的回复是写给眼睛看的：带代码块、路径、加粗、分点。
 * 原样送进 TTS，就会听见一串「星号星号 D 冒号 反斜杠」。
 *
 * 这里只做减法和挑句子，不改原意，也不编新内容：
 *   - 剥掉读出来毫无意义的噪声（代码、路径、链接、符号）；
 *   - 从里面挑一句最值得说的（优先结论句），控制在能一口气说完的长度。
 *
 * 气泡仍然显示完整原文，只有念出来的是这一版。
 */

const NOISE_RULES = [
  // 代码块整段不要，念出来只是一串符号。
  [/```[\s\S]*?```/g, ''],
  // 行内代码：路径和命令多在这里，一并去掉。
  [/`[^`\n]*`/g, ''],
  // Markdown 链接与图片，只留文字会读成断句，索性整段去掉。
  [/!?\[[^\]]*\]\([^)]*\)/g, ''],
  // 裸链接。
  [/https?:\/\/\S+/g, ''],
  // Windows 路径：只删完整形态（盘符 + 反斜杠 + 路径字符），
  // 字符类收窄到路径里能出现的字母数字点划下划线和中文，避免把路径后的正文一起吞掉。
  [/[A-Za-z]:\\[A-Za-z0-9_.\u4e00-\u9fa5\-\\]+/g, ''],
  // Unix 路径：要求以 / 开头且至少带一层子目录，结尾必须是边界，
  // 数学式子里偶尔出现的斜杠（如 1/2）不会命中。
  [/(?:^|\s)\/[\w.-]+(?:\/[\w.-]+)+(?=[\s，。；、）)]|$)/g, ' '],
  // 表格行。
  [/^\s*\|.*\|\s*$/gm, ''],
  // 分隔线与标题符号。
  [/^\s*[-*_]{3,}\s*$/gm, ''],
  [/^\s*#{1,6}\s*/gm, ''],
  // 列表与引用符号，只留文字。
  [/^\s*(?:[-*+]|\d+[.)]|>)\s+/gm, ''],
  // 加粗、斜体、删除线标记：只删行首标记或整行只剩符号的情况。
  // 正文里的 * _ ~ 可能是乘号、下划线命名，不能见一个删一个。
  [/^\s*[*_~]{1,3}(?=[^\s*_~])/gm, ''],
  [/^\s*[*_~]{1,3}\s*$/gm, ''],
  // emoji 与常见装饰符号；保留 ✓ / ✔（2713-2714），它们常用来表达「确认好了」。
  [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2715}-\u{27BF}\u{FE0F}]/gu, '']
]

/** 书面连接词换口语；换完读起来才不像报告。 */
const BOOKISH_RULES = [
  ['因此', '所以'],
  ['然而', '不过'],
  ['此外', '还有'],
  ['另外，', '还有，'],
  ['值得注意的是，', ''],
  ['综上所述，', ''],
  ['总的来说，', ''],
  ['本质上，', ''],
  ['实际上，', ''],
  ['也就是说，', ''],
  ['换句话说，', ''],
  ['需要指出的是，', '']
]

/**
 * 带这些词的句子通常就是结论，优先念它。
 * 刻意不收「失败」「报错」这类负面词：报错句子念出来没有下一步，
 * 收尾句（比如「要我重启试试吗」）才值得出声。
 */
const RESULT_WORDS = ['完成', '好了', '搞定', '通过', '修好', '已经', '改成', '加上', '装好']

const MIN_SENTENCE = 2

function stripNoise(text) {
  let value = String(text ?? '')
  for (const [pattern, replacement] of NOISE_RULES) {
    value = value.replace(pattern, replacement)
  }
  for (const [from, to] of BOOKISH_RULES) {
    value = value.split(from).join(to)
  }
  // 连续标点、空行、行首空格都收干净。
  return value
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[，,、]{2,}/g, '，')
    .replace(/([。！？；])[。！？；]+/g, '$1')
    .trim()
}

function splitSentences(text) {
  return text
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= MIN_SENTENCE)
}

/**
 * 这句能不能念。
 *
 * 剥掉行内代码和链接后，句子中间会留下空洞（「我把 加上了」「位置在 。」），
 * 念出来是残句。中文正文本来不用空格断开，所以只要出现「中文 空格 中文」
 * 或「空格紧贴标点」，就说明这里少了一块，整句跳过换下一句。
 */
function isSpeakable(sentence) {
  if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(sentence)) return false
  if (/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(sentence)) return false
  if (/\s+[，。；、！？]/.test(sentence)) return false
  return true
}

/**
 * 缝一下残句。
 *
 * 整句干净就原样用；不干净就按逗号拆开，丢掉带洞的半句，
 * 把剩下的拼回去——「参考 里的说明，已经改好了」还能保住后半句。
 */
function mendSentence(sentence) {
  if (isSpeakable(sentence)) return sentence
  const parts = sentence
    .split(/[，,]/)
    .map((part) => part.trim())
    .filter((part) => part !== '' && isSpeakable(part))
  return parts.join('，')
}

/**
 * 挑句子。
 *
 * 技术回复的结论通常落在最后，所以从后往前找带结果词的那句；
 * 找不到就退到最后一句——那里一般是收尾或反问，适合当结束语。
 */
function pickSentence(sentences) {
  const usable = sentences
    .map(mendSentence)
    .filter((sentence) => sentence !== '')
  if (usable.length === 0) return ''
  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const sentence = usable[index]
    if (RESULT_WORDS.some((word) => sentence.includes(word))) return sentence
  }
  return usable[usable.length - 1]
}

/** 超长就在标点处收口，不留半句话。 */
function clipAtPause(text, maxChars) {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return text

  const head = chars.slice(0, maxChars).join('')
  const cut = Math.max(
    head.lastIndexOf('，'),
    head.lastIndexOf('、'),
    head.lastIndexOf('；'),
    head.lastIndexOf('。')
  )
  if (cut >= MIN_SENTENCE) return head.slice(0, cut)
  return head
}

/**
 * 把一段回复变成一句能念出口的话。
 * 返回空串时，调用方应当跳过这一条，不要硬念。
 */
export function toSpokenLine(raw, options = {}) {
  const rawMax = Number(options.maxChars)
  const maxChars = Number.isFinite(rawMax) && rawMax > 0 ? Math.trunc(rawMax) : 60

  const cleaned = stripNoise(raw)
  if (cleaned === '') return ''

  const sentences = splitSentences(cleaned)
  const picked = pickSentence(sentences)
  if (picked === '') return ''

  // 只剩标点和符号的句子不念。
  if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(picked)) return ''
  return clipAtPause(picked, maxChars)
}
