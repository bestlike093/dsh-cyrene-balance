/**
 * 两份写入口共用的状态合并规则。
 *
 * 网页设置与桌宠窗口都只提交自己改动的字段；这里只做整份对象上的浅合并，
 * 缺失字段保留原值，避免「后写的一方把先写的字段抹掉」。
 * rev 只用于发现过期客户端，不参与业务字段合并。
 */

const NESTED_OBJECT_KEYS = ['background', 'intimacy', 'persona', 'schedule']

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function mergeStatePatch(base, patch) {
  const current = isPlainObject(base) ? base : {}
  const incoming = isPlainObject(patch) ? patch : {}
  const merged = { ...current, ...incoming }
  /* rev 只用于校验，客户端提交的值不能推进或回退本地版本号 */
  if ('rev' in current) merged.rev = current.rev
  else delete merged.rev
  /* 这几个字段是多属性对象，整块替换会把没提交的属性抹掉 */
  for (const key of NESTED_OBJECT_KEYS) {
    if (isPlainObject(current[key]) && isPlainObject(incoming[key])) {
      merged[key] = { ...current[key], ...incoming[key] }
    }
  }
  return merged
}

export function readRev(value) {
  /* 空串、null、布尔值都算“没带 rev”，不能被 Number() 悄悄当成 0 */
  if (value === null || value === undefined || typeof value === 'boolean') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/**
 * 客户端带了 rev 才校验；没带就按旧行为合并，升级期间不会把旧客户端挡在门外。
 * 返回 true 表示这次写入已经过期，应该拒绝。
 */
export function isStaleRev(clientRev, currentRev) {
  const incoming = readRev(clientRev)
  if (incoming === null) return false
  return incoming !== (readRev(currentRev) ?? 0)
}

export function nextRev(value) {
  return (readRev(value) ?? 0) + 1
}
