/**
 * 表情包小偷：把 QQ 消息里的图片捞出来，交给待审核队列。
 *
 * 分工：
 *   - 这里只负责「下载 + 尺寸闸门 + 交给 inbox」；
 *   - 「像不像表情包」由 sticker-inbox 的 screenSticker 判定，
 *     像的自动进 qq-auto 素材包，不像的留在 .inbox 等人看一眼。
 *
 * 所有外部依赖（fetch、大小上限、超时）都能注入，测试不需要真的联网。
 */

/** 超过这个大小连下载都不做：表情包不会这么大，照片才会。 */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024

const KNOWN_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'])

function normalizeType(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim()
}

function readContentLength(response) {
  const raw = response?.headers?.get?.('content-length')
  const size = Number(raw ?? 0)
  return Number.isFinite(size) && size > 0 ? size : 0
}

export function createStickerPickup(options = {}) {
  const inbox = options.inbox ?? null
  if (inbox === null || typeof inbox.add !== 'function') {
    throw new Error('表情包小偷需要 sticker-inbox')
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('当前环境没有 fetch')
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10_000
  const log = typeof options.log === 'function' ? options.log : () => {}
  /* 收下之后的后处理（比如让视觉模型起标签）：不阻塞下一张，失败只记账。 */
  const onSaved = typeof options.onSaved === 'function' ? options.onSaved : null

  async function download(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, controller === null ? {} : { signal: controller.signal })
      if (!response.ok) return { ok: false, reason: `http-${response.status}` }

      const declared = readContentLength(response)
      if (declared > maxBytes) return { ok: false, reason: 'too-large' }

      const type = normalizeType(response.headers?.get?.('content-type'))
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length === 0) return { ok: false, reason: 'empty' }
      if (bytes.length > maxBytes) return { ok: false, reason: 'too-large' }
      return { ok: true, bytes, contentType: type }
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      return { ok: false, reason: aborted ? 'timeout' : 'download-failed' }
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  /**
   * 收一批图。
   *
   * 单张失败不影响下一张：群里刷图时不该因为一张 404 就整批停掉。
   */
  async function pick(images, meta = {}) {
    const list = Array.isArray(images) ? images : []
    const saved = []
    const skipped = []

    for (const image of list) {
      const url = String(image?.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) {
        skipped.push({ url, reason: 'bad-url' })
        continue
      }
      const declaredSize = Number(image?.size ?? 0)
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        skipped.push({ url, reason: 'too-large' })
        continue
      }

      const fetched = await download(url)
      if (!fetched.ok) {
        skipped.push({ url, reason: fetched.reason })
        log('[sticker] 跳过一张图：', fetched.reason)
        continue
      }

      const hinted = normalizeType(image?.contentType)
      const contentType = KNOWN_TYPES.has(fetched.contentType) ? fetched.contentType : hinted
      if (!KNOWN_TYPES.has(contentType)) {
        skipped.push({ url, reason: 'unsupported-type' })
        continue
      }

      try {
        const item = await inbox.add({
          buffer: fetched.bytes,
          contentType,
          filename: String(image?.filename ?? '').trim(),
          source: 'qq',
          chatType: String(meta.chatType ?? ''),
          senderOpenId: String(meta.senderOpenId ?? ''),
          groupOpenId: String(meta.groupOpenId ?? ''),
          autoApprove: meta.autoApprove !== false
        })
        saved.push(item)
        if (onSaved !== null) {
          void Promise.resolve()
            .then(() => onSaved(item, { buffer: fetched.bytes, contentType }))
            .catch((error) => log('[sticker] 收图后处理失败：', String(error?.message ?? error)))
        }
      } catch (error) {
        skipped.push({ url, reason: String(error?.message ?? error) })
      }
    }

    return { ok: true, saved, skipped }
  }

  /** 从 QQ 事件里直接收图；没有图就原样返回空结果。 */
  function pickFromEvent(event) {
    if (event === null || typeof event !== 'object') return Promise.resolve({ ok: true, saved: [], skipped: [] })
    return pick(event.images, {
      chatType: String(event.kind ?? ''),
      senderOpenId: String(event.userId ?? ''),
      groupOpenId: String(event.groupId ?? '')
    })
  }

  return { pick, pickFromEvent }
}
