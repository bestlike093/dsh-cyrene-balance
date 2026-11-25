/*
 * 记忆台的入口守卫。
 *
 * 页面由宿主同源加载，只会把主人标记交给同源 fetch；跨站请求带不上这个头。
 * 这不是密码，只是一道「别让别的网页顺手读记忆」的门。
 *
 * 头和值必须与 lib/client.js 的 api() 保持一致；客户端是独立脚本，
 * 不能 import 这个模块，所以这里用命名常量把服务端口径收成一处。
 */
import { resolve, sep } from 'node:path'

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

/* QQ 原文落记忆的闸门：隐私模式开着时，非主人只留节奏与印象计数，
   原文不进记忆库；主人自己的话不受影响。 */
export function qqMemoryGate({ privacyMode = true, isOwner = false } = {}) {
  const privacyOn = privacyMode !== false
  return {
    peerText: !privacyOn,
    storeGroup: !privacyOn || isOwner,
    storePrivate: !privacyOn && !isOwner,
    storeOwner: isOwner
  }
}

/* 批量收图的目录白名单：只认插件表情目录与设置里显式允许的根。
   返回解析后的绝对路径；越界或空输入返回 null。 */
export function resolveImportRoot(sourceDir, roots = []) {
  const dir = String(sourceDir ?? '').trim()
  if (dir === '') return null
  const target = resolve(dir)
  for (const root of roots) {
    const base = String(root ?? '').trim()
    if (base === '') continue
    const prefix = resolve(base)
    if (target === prefix || target.startsWith(prefix + sep)) return target
  }
  return null
}

export const BOOT_NONCE_HEADER = 'x-cyrene-nonce'

/** 主人名单收敛：数组照收，字符串按行/逗号/分号拆（schema area 与手写页签同口径）。 */
export function parseOwnerList(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,，;；]+/)
      : []
  return [...new Set(list.map((item) => String(item ?? '').trim()).filter((item) => item !== ''))]
}

/* per-boot nonce：状态变更类请求必须带上本次启动发放的标记。
   它挡跨源网页与顺手 CSRF；同机同用户进程仍在本地信任边界内（审计 P1-6 残余风险）。 */
export function requireBootNonce(req, nonce) {
  const got = String(req?.headers?.[BOOT_NONCE_HEADER] ?? '').trim()
  if (typeof nonce === 'string' && nonce !== '' && got === nonce) return
  const error = new Error('缺少本次启动的通行标记')
  error.statusCode = 401
  throw error
}
