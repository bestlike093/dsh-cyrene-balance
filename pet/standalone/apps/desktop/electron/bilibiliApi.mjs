/**
 * B 站只读接口的请求与响应处理。
 *
 * 只做信息读取：视频详情、分 P 列表、搜索。
 * 写操作策略在 `bilibili.mjs`，两处分开，互不干扰。
 */

const API = 'https://api.bilibili.com'

export class BilibiliResponseError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BilibiliResponseError'
    this.code = code
  }
}

/** 视频详情地址。 */
export function videoInfoUrl(bvid) {
  return `${API}/x/web-interface/view?bvid=${encodeURIComponent(normalizeBvid(bvid))}`
}

/** 分 P 列表地址。`bvid` 与 `aid` 二选一。 */
export function videoPagesUrl(id) {
  if (id.bvid !== undefined) {
    return `${API}/x/player/pagelist?bvid=${encodeURIComponent(normalizeBvid(id.bvid))}`
  }
  if (id.aid !== undefined) {
    return `${API}/x/player/pagelist?aid=${id.aid}`
  }
  throw new Error('需要 bvid 或 aid')
}

/** 搜索地址。 */
export function searchUrl(keyword, page = 1) {
  const query = keyword.trim()
  if (query.length === 0) throw new Error('搜索词不能为空')
  return `${API}/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=${page}`
}

/** 从 BV 号或完整链接里取出 BV 号。非字符串（null/undefined 等）返回空串，让上层按「没有 BV 号」处理。 */
export function normalizeBvid(input) {
  if (typeof input !== 'string') return ''
  const text = input.trim()
  const match = /BV[0-9A-Za-z]{10}/.exec(text)
  if (match !== null) return match[0]

  if (/^\d+$/.test(text)) {
    throw new Error(`这是 av 号，请用 aid 接口：${text}`)
  }

  throw new Error(`认不出 BV 号：${input}`)
}

/** 解析 `/x/web-interface/view` 的响应。 */
export function parseVideoInfo(raw) {
  const data = unwrap(raw, '视频信息')
  const owner = asRecord(data.owner)
  const stat = asRecord(data.stat)
  const pages = Array.isArray(data.pages) ? data.pages : []

  return {
    bvid: String(data.bvid ?? ''),
    aid: Number(data.aid ?? 0),
    title: String(data.title ?? ''),
    author: String(owner.name ?? ''),
    authorId: Number(owner.mid ?? 0),
    duration: Number(data.duration ?? 0),
    cover: String(data.pic ?? ''),
    description: String(data.desc ?? ''),
    publishedAt: Number(data.pubdate ?? 0),
    stats: {
      view: Number(stat.view ?? 0),
      danmaku: Number(stat.danmaku ?? 0),
      like: Number(stat.like ?? 0),
      coin: Number(stat.coin ?? 0),
      favorite: Number(stat.favorite ?? 0),
      share: Number(stat.share ?? 0)
    },
    pages: pages.map((page) => {
      const p = asRecord(page)
      return {
        page: Number(p.page ?? 0),
        title: String(p.part ?? ''),
        duration: Number(p.duration ?? 0),
        cid: Number(p.cid ?? 0)
      }
    })
  }
}

/** 解析搜索响应。 */
export function parseSearch(raw) {
  const data = unwrap(raw, '搜索结果')
  const list = Array.isArray(data.result) ? data.result : []

  return {
    page: Number(data.page ?? 1),
    total: Number(data.numResults ?? 0),
    items: list.map((item) => {
      const entry = asRecord(item)
      return {
        bvid: String(entry.bvid ?? ''),
        title: stripTags(String(entry.title ?? '')),
        author: String(entry.author ?? ''),
        duration: parseDuration(String(entry.duration ?? '0:0')),
        play: Number(entry.play ?? 0),
        cover: normalizeCover(String(entry.pic ?? ''))
      }
    })
  }
}

/**
 * `12:34` 或 `1:02:03` 转成秒。
 *
 * 超过三段（如 `1:02:03:04`）只读前三段 h:m:s，多出的段忽略——
 * 之前会落到「返回第一段」的分支，把 1 小时静默读成 1 秒。
 * 任何一段不是数字都算非法，返回 null，别用假秒数糊弄上层。
 */
export function parseDuration(text) {
  if (typeof text !== 'string') return null
  const parts = text
    .trim()
    .split(':')
    .map((p) => Number.parseInt(p, 10))

  if (parts.some((n) => Number.isNaN(n))) return null

  const [h = 0, m = 0, s = 0] = parts
  if (parts.length === 2) return h * 60 + m
  if (parts.length >= 3) return h * 3600 + m * 60 + s
  return h
}

/** 秒转 `mm:ss`，超过一小时用 `h:mm:ss`。 */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function unwrap(raw, what) {
  if (raw === null || typeof raw !== 'object') {
    throw new BilibiliResponseError(-1, `${what}响应不是对象`)
  }

  const root = raw
  const code = Number(root.code ?? 0)

  if (code !== 0) {
    throw new BilibiliResponseError(code, `${what}接口返回 ${code}：${String(root.message ?? '')}`)
  }

  return asRecord(root.data)
}

function asRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

/** 搜索结果的标题带 `<em class="keyword">` 高亮标签，要剥掉。 */
function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

/** 搜索结果里的封面常是 `//i0.hdslb.com/...`，补上协议。 */
function normalizeCover(url) {
  return url.startsWith('//') ? `https:${url}` : url
}

/** 播放信息地址（拿字幕轨列表 / 播放 URL）。需要 WBI 签名 + 登录态。 */
export function playerUrl(bvid, cid) {
  return `${API}/x/player/wbi/v2?bvid=${encodeURIComponent(normalizeBvid(bvid))}&cid=${Number(cid)}`
}

/** 协议相对的地址（//xx）补成 https。 */
function toHttps(url) {
  return url.startsWith('//') ? `https:${url}` : url
}

/** 解析 /x/player/wbi/v2 里的字幕轨列表。 */
export function parseSubtitleList(raw) {
  const data = unwrap(raw, '播放信息')
  const subtitles = Array.isArray(data?.subtitle?.subtitles) ? data.subtitle.subtitles : []
  return subtitles.map((item) => {
    const s = asRecord(item)
    return {
      lan: String(s.lan ?? ''),
      lanDoc: String(s.lan_doc ?? ''),
      url: toHttps(String(s.subtitle_url ?? ''))
    }
  })
}

/** 解析字幕 JSON（subtitle_url 下载的内容），拼成带时间戳的全文。 */
export function parseTranscript(raw) {
  const body = Array.isArray(raw?.body) ? raw.body : []
  const lines = body
    .map((item) => {
      const seg = asRecord(item)
      return {
        from: Number(seg.from ?? 0),
        to: Number(seg.to ?? 0),
        text: String(seg.content ?? '').trim()
      }
    })
    .filter((seg) => seg.text.length > 0)
  const fullText = lines.map((seg) => seg.text).join('')
  return { lines, fullText }
}
