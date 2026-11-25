/**
 * 记忆读取授权三档。
 *
 * 分工：
 *   - memory-console.bridgeAllows 管「这条能不能出现在这个来源」的物理隔离；
 *   - 这里管「这一档一次能拿多少、能翻多深」。两者一起用，缺一条都不够。
 *
 * 三档：
 *   owner  主人：全部桶，12 条；
 *   peer   私聊访客：只读自己的私聊桶，熟悉度决定能拿多少（3 / 5 / 8）；
 *   group  群聊：只读本群桶，固定 3 条。
 *
 * 群聊读不到私聊与主人桶，这条是红线，不随 bridge 开关变化。
 */

import { MEMORY } from '../standard.mjs'
import { bridgeAllows } from './memory-console.mjs'

export const ACCESS_TIERS = Object.freeze(['owner', 'peer', 'group'])

/**
 * 解析一次读取的授权。
 * @param {{ isOwner?: boolean, chatType?: string, familiarity?: number }} [viewer]
 */
export function resolveMemoryAccess({ isOwner = false, chatType = 'desktop', familiarity = 0 } = {}) {
  if (isOwner === true) {
    return {
      tier: 'owner',
      items: MEMORY.access.owner.items,
      depth: MEMORY.access.owner.depth,
      allBuckets: true,
    }
  }

  if (chatType === 'group') {
    return {
      tier: 'group',
      items: MEMORY.access.group.items,
      depth: MEMORY.access.group.depth,
      allBuckets: false,
    }
  }

  const familiar = Number.isFinite(Number(familiarity)) ? Math.max(0, Number(familiarity)) : 0
  let items = MEMORY.access.peer.items
  for (const band of MEMORY.access.peer.bands) {
    if (familiar >= band.minFamiliarity) {
      items = band.items
      break
    }
  }
  return {
    tier: 'peer',
    items,
    depth: MEMORY.access.peer.depth,
    allBuckets: false,
  }
}

/** 这一档能不能读这个作用域的桶。 */
export function accessAllows(access, scope) {
  const tier = access?.tier ?? 'peer'
  const bucket = scope ?? 'owner'
  if (bucket === 'owner') return tier === 'owner'
  if (bucket === 'group') return tier === 'owner' || tier === 'group'
  return tier === 'owner' || tier === 'peer'
}

/**
 * 从检索结果里挑出这一档能看的条目，并截到条数上限。
 * 主人直接全通；其余档位还要过 bridgeAllows，防止同号看到别的群/别人的私聊。
 */
export function visibleMemories(access, items = [], source = null) {
  const tier = access?.tier ?? 'peer'
  const limit = Number.isFinite(access?.items) ? Math.max(1, Math.floor(access.items)) : 1
  const list = Array.isArray(items) ? items : []
  const visible = []
  for (const item of list) {
    if (tier === 'owner') {
      visible.push(item)
    } else if (accessAllows(access, item?.scope) && bridgeAllows(item, source, { isOwner: false }) === true) {
      visible.push(item)
    }
    if (visible.length >= limit) break
  }
  return visible
}
