/**
 * 动作标记：`[动作:名称]`、`【动作：名称】`、`(动作: 名称)` 三种写法都认。
 *
 * 与表情标记（emoji-tag）同一套容错口径：不限制名称的字符合法性，
 * 模型编出什么都要把整段标记摘掉，残骸不能漏进气泡。
 * 合法性交给 allowedNames 判断，与 Live2D catalog 的动作清单对照。
 */
const MOTION_TAG_PATTERN = /[[【(（]\s*动作\s*[:：]\s*([^\]】)）\n]{1,24})\s*[\]】)）]/

/**
 * 从模型输出里摘出动作标记。
 *
 * 与 parseEmojiTag 同款行为：先摘标记再判合法；只认第一个合法动作名，
 * 但所有标记都摘掉，编出非法名称时不留残骸。
 * allowedNames 为 null 表示不校验；数组或 Set 都可以。
 */
export function parseMotionTag(raw, allowedNames = null) {
  if (typeof raw !== 'string') return { text: '', motion: null }
  // 用带 g 的副本：matchAll 需要全局标志，但常量本身要保持无状态，
  // 否则 lastIndex 会跨调用残留，下一次匹配从上次的位置开始。
  const pattern = new RegExp(MOTION_TAG_PATTERN.source, 'g')
  const tags = [...raw.matchAll(pattern)]
  if (tags.length === 0) return { text: raw, motion: null }

  const isAllowed = (name) => {
    if (allowedNames === null) return true
    return Array.isArray(allowedNames) ? allowedNames.includes(name) : allowedNames.has(name)
  }

  let motion = null
  for (const tag of tags) {
    const name = tag[1].trim()
    if (motion === null && isAllowed(name)) motion = name
  }
  return {
    text: raw.replace(pattern, '').trim(),
    motion,
  }
}
