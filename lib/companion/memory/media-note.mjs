/**
 * 媒体占位标记 —— 生成与识别共用一个口。
 *
 * B2-006 现场：`qq-official.mjs:158-159` 在收消息时给图片附件生成 `[图片]` / `[图片x2]`
 * 并拼进 content，注释写明是故意的（「模型至少要能看见这里有一张图」）。这条本身没错。
 * 错在下游两道闸都只挡空串：
 *   memory-store.mjs:78   `if (slot === null || text === '')`  → 纯占位符成了一条记忆正文
 *   bond.mjs:263 / :458   `line.trim() !== ''`                 → 占位符占住探针采样名额
 *
 * 跟 scrub 那套不同物：scrub 管的是「本机路径 / 手机号 / 身份证」这类隐私形状，
 * 命中要换成占位符；这里管的是「整行除了占位符什么都没有」，命中要整条丢掉。
 *
 * 生成式与识别式必须住在一个文件里：格式改一边、另一边立刻对不上，
 * 这是 A2-006 那颗「同一份身份写两遍」的直接复用 —— 不造第二副本。
 */

/** 图片附件数 → 标记文本。0 张不产生标记。 */
export function mediaNote(count) {
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 0) return ''
  const whole = Math.trunc(n)
  return whole === 1 ? '[图片]' : `[图片x${whole}]`
}

/** 标记形状只在这里定义一次；识别与生成共用。 */
const NOTE_PATTERN = /\[图片(?:x\d+)?\]/g

/**
 * 整行除媒体标记以外没有正文吗？
 * 图文混排（「今天这张真好看 [图片]」）返回 false —— 那种句子该照旧留下。
 */
export function isMediaNoteOnly(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed === '') return false
  return trimmed.replace(NOTE_PATTERN, ' ').trim() === ''
}

/** 去掉媒体标记之后还剩正文吗（给调用方留着判「有没有可记的话」）。 */
export function hasProse(text) {
  if (typeof text !== 'string') return false
  return text.replace(NOTE_PATTERN, ' ').trim() !== ''
}
