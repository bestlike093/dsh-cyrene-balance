/**
 * 注入前的可见性过滤。
 *
 * 隐私模式只决定 QQ 内容能不能落进记忆，不决定已经落下的记忆能不能跨来源出现。
 * 这里永远按来源隔离：桌面只拿主人桶，群里只拿这个群，陌生私聊只拿这段私聊；
 * 主人自己的 QQ 私聊才额外带上主人桶；群聊默认永远不带主人桶，
 * 除非主人显式打开 bridge.ownerGroup。
 */
import { MEMORY } from '../standard.mjs'

function ownerItems(items) {
  return items.filter((item) => (item.scope ?? 'owner') === 'owner')
}

/** 只有主人自己的 QQ 私聊 / 群聊才能打开主人桶；桌面不经过这道门。 */
export function ownerBridgeAllowsFor(
  source,
  { ownerPrivate = MEMORY.bridge.ownerPrivate, ownerGroup = MEMORY.bridge.ownerGroup } = {},
) {
  if (source === null || typeof source !== 'object' || source.channel !== 'qq') return true
  if (source.isOwner !== true) return false
  if (source.chatType === 'group') return ownerGroup === true
  return ownerPrivate === true
}

export function filterMemoryItemsForSource(
  items,
  source,
  enabledSlots = null,
  {
    ownerPrivate = MEMORY.bridge.ownerPrivate,
    ownerGroup = MEMORY.bridge.ownerGroup,
    ownerAll = false,
  } = {},
) {
  let list = Array.isArray(items) ? items : []
  if (Array.isArray(enabledSlots)) {
    list = list.filter((item) => enabledSlots.includes(item.slot))
  }
  /*
   * 桌面是主人自己的窗口：默认只展开主人桶；
   * 主人在记忆台选了「全部记忆」后，才把私聊与群聊一起摊开。
   */
  if (source === null || typeof source !== 'object' || source.channel !== 'qq') {
    return ownerAll === true ? list : ownerItems(list)
  }
  if (source.chatType === 'group') {
    const groupId = String(source.openId ?? '').trim()
    /* 没有群 id 时不匹配任何群，免得空字符串把无主条目串进来。 */
    const own = groupId === ''
      ? []
      : list.filter((item) => item.scope === 'group' && item.scopeId === groupId)
    /* 群聊默认不与主人桶互通；只有主人显式打开时才并进来。 */
    if (source.isOwner === true && ownerGroup === true) {
      return [...ownerItems(list), ...own]
    }
    return own
  }
  const peerId = String(source.openId ?? source.senderOpenId ?? '').trim()
  const own = peerId === ''
    ? []
    : list.filter((item) => item.scope === 'private' && item.scopeId === peerId)
  if (source.isOwner === true && ownerPrivate === true) {
    return [...ownerItems(list), ...own]
  }
  return own
}
