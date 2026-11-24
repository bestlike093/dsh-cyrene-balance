/*
 * 记忆台的入口守卫。
 *
 * 页面由宿主同源加载，只会把主人标记交给同源 fetch；跨站请求带不上这个头。
 * 这不是密码，只是一道「别让别的网页顺手读记忆」的门。
 *
 * 头和值必须与 lib/client.js 的 api() 保持一致；客户端是独立脚本，
 * 不能 import 这个模块，所以这里用命名常量把服务端口径收成一处。
 */

const OWNER_MARKER_HEADER = 'x-cyrene-owner'
const OWNER_MARKER_VALUE = '1'
const SAME_ORIGIN_SITES = new Set(['', 'same-origin', 'none'])
const OWNER_ONLY_STATUS = 403

export function isOwnerConsoleRequest(req) {
  const marker = String(req?.headers?.[OWNER_MARKER_HEADER] ?? '').trim()
  if (marker !== OWNER_MARKER_VALUE) return false
  const site = String(req?.headers?.['sec-fetch-site'] ?? '').trim()
  return SAME_ORIGIN_SITES.has(site)
}

export function requireOwnerConsole(req) {
  if (isOwnerConsoleRequest(req)) return
  const error = new Error('记忆台只对主人开放')
  error.statusCode = OWNER_ONLY_STATUS
  throw error
}
