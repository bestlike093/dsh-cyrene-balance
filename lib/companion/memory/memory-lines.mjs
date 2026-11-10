/**
 * 注入侧：把记忆条目压成「会被模型看见的那几行」。
 *
 * 约束：
 * - 只读条目已有字段，不新造信息；
 * - 同一条记忆的确定程度不同，前缀不同，让模型知道该不该主动提；
 * - 纯函数，不碰存储，便于单独验证。
 */

/**
 * 前缀表示「这条记忆有多确定」：
 * 钉住的是她特意留的，冷掉的先放着，反复想起的不用说也懂。
 */
export function memoryLinePrefix(item) {
  if (item?.pinned === true) return '（她特意留住的）'
  if (item?.cold === true) return '（很久没提起了）'
  if (Number(item?.recallCount ?? item?.mentions ?? 0) >= 3) return '（常常想起）'
  return ''
}

/* 字段缺失时按 0 处理：否则 NaN 参与比较会让整个排序失效。 */
function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

/*
 * 排序：固定优先，其次提及次数，最后按时间。
 * 先剔空再截断，避免空条目占掉名额。
 */
export function rankMemoryLines(items, limit = 8) {
  const max = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 8)
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      item,
      text: String(item?.text ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((entry) => entry.text !== '')
    .sort(
      (a, b) =>
        toNumber(b.item?.pinned) - toNumber(a.item?.pinned) ||
        toNumber(b.item?.mentions) - toNumber(a.item?.mentions) ||
        toNumber(b.item?.lastAt) - toNumber(a.item?.lastAt),
    )
    .slice(0, max)
    .map((entry) => `${memoryLinePrefix(entry.item)}${entry.text}`)
}
