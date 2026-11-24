/**
 * 记忆台与可见性。
 *
 * 主人的记忆台可以选两种视图：
 * - owner：只看主人自己这条线（默认，最省心）；
 * - all：主人这一条线 + 所有私聊 + 所有群，只有主人能开。
 *
 * 非主人永远看不到 all；群聊与私聊各自成桶，只有在主人明确打开
 * bridge 时，主人才能在自己的私聊里把两边串起来看。
 *
 * 这个模块只做纯数据整理，不读写磁盘、不碰 Electron。
 */
import { MEMORY } from '../standard.mjs'

export const VIEW_MODES = MEMORY.viewModes

export function normalizeViewMode(mode) {
  return VIEW_MODES.includes(mode) ? mode : MEMORY.defaultViewMode
}

export function isOwnerView(mode) {
  return normalizeViewMode(mode) === 'all'
}

/** 一条记忆属于哪个物理桶：owner / private:<id> / group:<id>。 */
export function bucketKeyOf(item = {}) {
  const scope = item.scope ?? 'owner'
  if (scope === 'owner') return 'owner'
  const id = String(item.scopeId ?? '').trim()
  return id === '' ? scope : `${scope}:${id}`
}

/** 只有主人能开 all；非主人请求 all 时静默回落到 owner。 */
export function resolveViewMode(mode, { isOwner = false } = {}) {
  const wanted = normalizeViewMode(mode)
  if (wanted === 'all' && isOwner !== true) return 'owner'
  return wanted
}

/**
 * 记忆台视图。
 * limit 只作用于返回条目，不影响统计；统计永远按过滤后的全集算。
 */
export function buildMemoryConsole(items, {
  mode = MEMORY.defaultViewMode,
  /* 默认按「不是主人」处理：调用方必须显式证明身份，漏传不会意外开台。 */
  isOwner = false,
  query = '',
  enabledSlots = null,
  limit = MEMORY.console.defaultLimit,
} = {}) {
  const source = Array.isArray(items) ? items : []
  /* 非主人没有任何记忆台视图；连 owner 线也不给，避免把回退当成授权。 */
  if (isOwner !== true) {
    return {
      mode: 'owner',
      isOwner: false,
      total: 0,
      visible: 0,
      buckets: [],
      items: [],
      truncated: false,
    }
  }
  const view = resolveViewMode(mode, { isOwner })
  const keyword = String(query ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const slots = Array.isArray(enabledSlots) ? new Set(enabledSlots) : null

  const visible = source.filter((item) => {
    if (slots !== null && !slots.has(item.slot)) return false
    const scope = item.scope ?? 'owner'
    if (view === 'owner' && scope !== 'owner') return false
    if (keyword !== '' && !String(item.text ?? '').toLowerCase().includes(keyword)) return false
    return true
  })

  const buckets = new Map()
  for (const item of visible) {
    const key = bucketKeyOf(item)
    if (!buckets.has(key)) {
      buckets.set(key, { key, scope: item.scope ?? 'owner', scopeId: item.scopeId ?? '', count: 0 })
    }
    buckets.get(key).count += 1
  }

  const sorted = visible.slice().sort((a, b) =>
    (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0) ||
    Number(b.lastAt ?? b.at ?? 0) - Number(a.lastAt ?? a.at ?? 0) ||
    String(a.text ?? '').localeCompare(String(b.text ?? ''), 'zh-CN'),
  )

  const cap = Math.max(
    MEMORY.console.minLimit,
    Math.min(MEMORY.console.maxLimit, Math.trunc(Number(limit) || MEMORY.console.defaultLimit)),
  )

  return {
    mode: view,
    isOwner: isOwner === true,
    total: source.length,
    visible: visible.length,
    buckets: [...buckets.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    items: sorted.slice(0, cap),
    truncated: sorted.length > cap,
  }
}

/**
 * 受控互通：默认两边都不通；只有主人显式打开对应开关才合并。群聊与私聊仍各自成桶。
 * 这个函数只回答「这条能不能出现在当前来源」，不负责写入隔离。
 */
export function bridgeAllows(
  item,
  source,
  { isOwner = false, ownerPrivate = MEMORY.bridge.ownerPrivate, ownerGroup = MEMORY.bridge.ownerGroup } = {},
) {
  const scope = item?.scope ?? 'owner'
  if (scope === 'owner') {
    if (source === null || typeof source !== 'object') return isOwner === true
    if (source.channel !== 'qq') return isOwner === true
    if (source.chatType === 'group') return ownerGroup === true && source.isOwner === true
    return source.isOwner === true && ownerPrivate === true
  }
  if (source === null || typeof source !== 'object' || source.channel !== 'qq') return false
  const id = String(source.openId ?? source.senderOpenId ?? '')
  if (source.chatType === 'group') return scope === 'group' && item.scopeId === id
  return scope === 'private' && item.scopeId === id
}
