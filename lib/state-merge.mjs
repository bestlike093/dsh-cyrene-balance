/**
 * 两份写入口共用的状态合并规则。
 *
 * 网页设置与桌宠窗口都只提交自己改动的字段；这里只做整份对象上的浅合并，
 * 缺失字段保留原值，避免「后写的一方把先写的字段抹掉」。
 * rev 只用于发现过期客户端，不参与业务字段合并。
 */

const NESTED_OBJECT_KEYS = ['background', 'appearance', 'intimacy', 'persona', 'schedule', 'vision']

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 把平铺点路径（appearance.palette=value）展开成「只带这条子树」的嵌套补丁。
 * schema 设置页按点路径提交；这里只展开含 '.' 的键，普通嵌套键原样透传。
 * 多个点路径落在同一父对象时（appearance.palette + appearance.skin）合并进同一子树。
 *
 * @param {object} current 当前状态（给子树补丁做同层复制基准）
 * @param {object} body 客户端提交的补丁（可能混有点路径键与嵌套对象）
 * @returns {object} 全部展开成嵌套形态的补丁
 */
export function expandDotPaths(current, body) {
  if (!isPlainObject(body)) return {}
  const out = {}
  for (const [key, value] of Object.entries(body)) {
    if (String(key).includes('.')) {
      const parts = String(key).split('.').filter(Boolean)
      if (parts.length === 0) continue
      /* 父链基准用已累计的 out：同父多条点路径时，后写的不把先写的冲掉 */
      const baseParent = isPlainObject(out[parts[0]]) ? out[parts[0]] : current?.[parts[0]]
      out[parts[0]] = buildBranch(baseParent, parts, 1, value)
    } else {
      out[key] = value
    }
  }
  return out
}

/* 复制 current 的父链（与 index.js patchFromPath 同规则：深合并键之外整块替换，
   父对象必须整份复制，否则会冲掉未提交的兄弟字段） */
function buildBranch(current, parts, index, value) {
  const base = isPlainObject(current) ? { ...current } : {}
  if (index === parts.length - 1) {
    base[parts[index]] = value
    return base
  }
  base[parts[index]] = buildBranch(current?.[parts[index]], parts, index + 1, value)
  return base
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
