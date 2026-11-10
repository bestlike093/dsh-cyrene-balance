/**
 * 表情标记：`[图:id]`、`【图：id】`、`(图: id)` 三种写法都认。
 *
 * 这里故意不限制 id 的字符合法性：模型编出 `[图:../../etc/passwd]` 时，
 * 也要把整段标记摘掉，否则残骸会直接漏进气泡。合法性交给 allowlist 判断。
 */
const EMOJI_TAG_PATTERN = /[[【(（]\s*图\s*[:：]\s*([^\]】)）\n]{1,40})\s*[\]】)）]/

/**
 * 从模型输出里摘出表情标记。
 *
 * 必须在 cleanBubbleLine 之前调用：清洗只保留第一句话，
 * 句末的标记会被整段砍掉，图也就丢了。
 * allowedIds 用来挡住模型自己编的 id，不认识的直接丢掉，不留空图框。
 */
export function parseEmojiTag(raw, allowedIds = null) {
  if (typeof raw !== 'string') return { text: '', emojiId: null }
  // 用带 g 的副本：matchAll 需要全局标志，但常量本身要保持无状态，
  // 否则 lastIndex 会跨调用残留，下一次匹配从上次的位置开始。
  const pattern = new RegExp(EMOJI_TAG_PATTERN.source, 'g')
  const tags = [...raw.matchAll(pattern)]
  if (tags.length === 0) return { text: raw, emojiId: null }

  const isAllowed = (id) => {
    if (allowedIds === null) return true
    return Array.isArray(allowedIds) ? allowedIds.includes(id) : allowedIds.has(id)
  }

  // 只认第一个合法 id；但所有标记都要摘掉，模型写两个或编出非法 id 时，
  // 残骸留在正文里会直接进气泡。
  let emojiId = null
  for (const tag of tags) {
    const id = tag[1].trim()
    if (emojiId === null && isAllowed(id)) emojiId = id
  }
  return {
    text: raw.replace(pattern, '').trim(),
    emojiId
  }
}
