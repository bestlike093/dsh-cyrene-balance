/*
 * 看人只看来源，不看调用方传进来的会话 scope。
 * 这个映射一旦写错，群聊会拿到主人的人格段，或主人桌面拿不到自己的事实。
 */
export function personaScopeOf(_scope, source) {
  if (source?.channel === 'qq') {
    if (source.chatType === 'group') return 'guest'
    return source.isOwner === true ? 'owner' : 'guest'
  }
  return 'owner'
}
