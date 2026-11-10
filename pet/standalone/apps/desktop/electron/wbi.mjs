/**
 * B 站 WBI 签名。
 *
 * B 站从 2023 年起对 /x/web-interface/search、/x/web-interface/view、
 * /x/player/wbi/v2 等读接口加了风控：不带 wts + w_rid 直接回 HTTP 412。
 * 这里按官方算法拼 w_rid。纯函数、不碰网络，方便单独验证。
 */

import { createHash } from 'node:crypto'

/** 固定映射表：把 img_key + sub_key 压成 32 位 mixin_key。 */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

/** img_key + sub_key 拼起来，按映射表取字符，截前 32 位。 */
export function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n] ?? '').join('').slice(0, 32)
}

/** 对一组查询参数做 WBI 签名，返回 { wts, wRid }。wts 参与排序与签名。 */
export function encWbi(params, imgKey, subKey) {
  const mixinKey = getMixinKey(`${imgKey}${subKey}`)
  const wts = Math.round(Date.now() / 1000)
  const chrFilter = /[!'()*]/g
  const withWts = { ...params, wts: String(wts) }
  const query = Object.keys(withWts)
    // undefined/null 的值拼进签名会让两次签名对不上（发送端会丢掉空键），直接跳过。
    .filter((key) => withWts[key] !== undefined && withWts[key] !== null)
    .sort()
    .map((key) => {
      const value = String(withWts[key]).replace(chrFilter, '')
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    })
    .join('&')
  const wRid = createHash('md5').update(`${query}${mixinKey}`).digest('hex')
  return { wts, wRid }
}

/** 对完整 URL 的 query 做签名，返回带 wts + w_rid 的新 URL。 */
export function signWbiUrl(url, imgKey, subKey) {
  const target = new URL(url)
  const params = {}
  for (const [key, value] of target.searchParams) params[key] = value
  const { wts, wRid } = encWbi(params, imgKey, subKey)
  target.searchParams.set('wts', String(wts))
  target.searchParams.set('w_rid', wRid)
  return target.toString()
}
