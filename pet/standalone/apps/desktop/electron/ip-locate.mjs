/**
 * 主人位置 IP 定位：尽力而为，失败静默。
 *
 * 只负责「拿一次 IP 定位结果」，不写文件、不碰 settings、不重试。
 * 调用方决定要不要写回、要不要回落。独立成模块方便单测与复用。
 *
 * 双数据源 fallback：ip-api.com（http，无密钥）→ ipwho.is（https，无密钥）。
 * 注意：IP 定位拿到的是「公网出口 IP 归属地」，可能与用户实际所在地不一致
 * （例如运营商 NAT 或代理），所以必须允许用户手动覆盖。
 */

const IP_SOURCES = [
  {
    url: 'http://ip-api.com/json',
    parse: (b) => (b?.status === 'success'
      ? {
          city: String(b.city ?? '').trim(),
          region: String(b.regionName ?? '').trim(),
          country: String(b.country ?? '').trim(),
          ip: String(b.query ?? '').trim()
        }
      : null)
  },
  {
    url: 'https://ipwho.is/',
    parse: (b) => (b?.success === true
      ? {
          city: String(b.city ?? '').trim(),
          region: String(b.region ?? '').trim(),
          country: String(b.country ?? '').trim(),
          ip: String(b.ip ?? '').trim()
        }
      : null)
  }
]

/**
 * @param {{ fetchImpl?: Function, timeoutMs?: number }} options
 * @returns {Promise<{ ok: boolean, reason?: string, city?: string, region?: string, country?: string, ip?: string }>}
 */
export async function locateOwnerByIp(options) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = options ?? {}
  for (const source of IP_SOURCES) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(
        source.url,
        controller === null ? {} : { signal: controller.signal }
      )
      if (!response.ok) continue
      const body = await response.json()
      const parsed = source.parse(body)
      if (parsed && (parsed.city !== '' || parsed.region !== '' || parsed.country !== '')) {
        return { ok: true, ...parsed }
      }
    } catch (error) {
      // 这个源失败，试下一个。
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }
  return { ok: false, reason: 'all-sources-failed' }
}
