/**
 * B 站只读接口的请求与响应处理。
 *
 * 只做信息读取：视频详情、分 P 列表、搜索。
 * 写操作策略在 `bilibili.ts`，两处分开，互不干扰。
 *
 * 对应能力：`browse.bilibili.read`。
 */
const API = 'https://api.bilibili.com';
export class BilibiliResponseError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'BilibiliResponseError';
        this.code = code;
    }
}
/** 视频详情地址。 */
export function videoInfoUrl(bvid) {
    return `${API}/x/web-interface/view?bvid=${encodeURIComponent(normalizeBvid(bvid))}`;
}
/** 分 P 列表地址。`bvid` 与 `aid` 二选一。 */
export function videoPagesUrl(id) {
    if (id.bvid !== undefined) {
        return `${API}/x/player/pagelist?bvid=${encodeURIComponent(normalizeBvid(id.bvid))}`;
    }
    if (id.aid !== undefined) {
        return `${API}/x/player/pagelist?aid=${id.aid}`;
    }
    throw new Error('需要 bvid 或 aid');
}
/** 搜索地址。 */
export function searchUrl(keyword, page = 1) {
    const query = keyword.trim();
    if (query.length === 0)
        throw new Error('搜索词不能为空');
    return `${API}/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=${page}`;
}
/** 从 BV 号或完整链接里取出 BV 号。 */
export function normalizeBvid(input) {
    const text = input.trim();
    const match = /BV[0-9A-Za-z]{10}/.exec(text);
    if (match !== null)
        return match[0];
    if (/^\d+$/.test(text)) {
        throw new Error(`这是 av 号，请用 aid 接口：${text}`);
    }
    throw new Error(`认不出 BV 号：${input}`);
}
/** 解析 `/x/web-interface/view` 的响应。 */
export function parseVideoInfo(raw) {
    const data = unwrap(raw, '视频信息');
    const owner = asRecord(data.owner);
    const stat = asRecord(data.stat);
    const pages = Array.isArray(data.pages) ? data.pages : [];
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
            const p = asRecord(page);
            return {
                page: Number(p.page ?? 0),
                title: String(p.part ?? ''),
                duration: Number(p.duration ?? 0)
            };
        })
    };
}
/** 解析搜索响应。 */
export function parseSearch(raw) {
    const data = unwrap(raw, '搜索结果');
    const list = Array.isArray(data.result) ? data.result : [];
    return {
        page: Number(data.page ?? 1),
        total: Number(data.numResults ?? 0),
        items: list.map((item) => {
            const entry = asRecord(item);
            return {
                bvid: String(entry.bvid ?? ''),
                title: stripTags(String(entry.title ?? '')),
                author: String(entry.author ?? ''),
                duration: parseDuration(String(entry.duration ?? '0:0')),
                play: Number(entry.play ?? 0),
                cover: normalizeCover(String(entry.pic ?? ''))
            };
        })
    };
}
/** `12:34` 或 `1:02:03` 转成秒。 */
export function parseDuration(text) {
    const parts = text
        .trim()
        .split(':')
        .map((p) => Number.parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n)))
        return 0;
    if (parts.length === 2)
        return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    if (parts.length === 3) {
        return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
    }
    return parts[0] ?? 0;
}
/** 秒转 `mm:ss`，超过一小时用 `h:mm:ss`。 */
export function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function unwrap(raw, what) {
    if (raw === null || typeof raw !== 'object') {
        throw new BilibiliResponseError(-1, `${what}响应不是对象`);
    }
    const root = raw;
    const code = Number(root.code ?? 0);
    if (code !== 0) {
        throw new BilibiliResponseError(code, `${what}接口返回 ${code}：${String(root.message ?? '')}`);
    }
    return asRecord(root.data);
}
function asRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
/** 搜索结果的标题带 `<em class="keyword">` 高亮标签，要剥掉。 */
function stripTags(html) {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
}
/** 搜索结果里的封面常是 `//i0.hdslb.com/...`，补上协议。 */
function normalizeCover(url) {
    return url.startsWith('//') ? `https:${url}` : url;
}
