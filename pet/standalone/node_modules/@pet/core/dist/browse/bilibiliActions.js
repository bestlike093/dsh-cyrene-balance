/**
 * B 站写操作：把「想做什么」翻译成一次具体请求。
 *
 * 策略判定在 `bilibili.ts`，这里只负责两件事：
 *
 * 1. 拼出请求（地址、方法、表单字段、要不要 csrf）
 * 2. 读懂响应（业务码、错误信息、成功与否）
 *
 * 不做网络请求，也不碰 Cookie 明文——这些由宿主注入。
 * 对应能力：`browse.bilibili.like` / `.favorite` / `.comment` / `.coin` / `.share`。
 */
import { MAX_COIN_COUNT } from './bilibili';
const API = 'https://api.bilibili.com';
export class ActionParamsError extends Error {
    action;
    field;
    constructor(action, field, message) {
        super(`${action}.${field}：${message}`);
        this.name = 'ActionParamsError';
        this.action = action;
        this.field = field;
    }
}
/** 评论最长 1000 字，和 B 站前端限制一致。 */
export const MAX_COMMENT_LENGTH = 1000;
/**
 * 拼一次写操作请求。
 *
 * 参数不对当场抛错，不等到发出去被服务端拒。
 */
export function buildActionRequest(action, params) {
    switch (action) {
        case 'like':
            return buildLike(params);
        case 'coin':
            return buildCoin(params);
        case 'favorite':
            return buildFavorite(params);
        case 'comment':
            return buildComment(params);
        case 'share':
            return buildShare(params);
    }
}
function requireAid(action, params) {
    const aid = params.video?.aid;
    if (aid === undefined || !Number.isInteger(aid) || aid <= 0) {
        throw new ActionParamsError(action, 'aid', '需要一个正整数 aid');
    }
    return aid;
}
function buildLike(params) {
    const aid = requireAid('like', params);
    const wanted = params.like ?? true;
    return {
        action: 'like',
        url: `${API}/x/web-interface/archive/like`,
        method: 'POST',
        form: { aid: String(aid), like: wanted ? '1' : '0' },
        requiresCsrf: true,
        summary: wanted ? '给这条视频点赞' : '取消点赞'
    };
}
function buildCoin(params) {
    const aid = requireAid('coin', params);
    const count = params.coinCount ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > MAX_COIN_COUNT) {
        throw new ActionParamsError('coin', 'coinCount', `只能是 1 到 ${MAX_COIN_COUNT}`);
    }
    return {
        action: 'coin',
        url: `${API}/x/web-interface/coin/add`,
        method: 'POST',
        form: {
            aid: String(aid),
            multiply: String(count),
            select_like: params.alsoLike === true ? '1' : '0'
        },
        requiresCsrf: true,
        summary: `投 ${count} 枚硬币${params.alsoLike === true ? '，顺带点赞' : ''}`
    };
}
function buildFavorite(params) {
    const aid = requireAid('favorite', params);
    const add = params.addToFavorites ?? [];
    const remove = params.removeFromFavorites ?? [];
    if (add.length === 0 && remove.length === 0) {
        throw new ActionParamsError('favorite', 'addToFavorites', '至少指定一个收藏夹');
    }
    for (const id of [...add, ...remove]) {
        if (!Number.isInteger(id) || id <= 0) {
            throw new ActionParamsError('favorite', 'folderId', '收藏夹 id 需要正整数');
        }
    }
    return {
        action: 'favorite',
        url: `${API}/x/v3/fav/resource/deal`,
        method: 'POST',
        form: {
            rid: String(aid),
            type: '2',
            add_media_ids: add.join(','),
            del_media_ids: remove.join(',')
        },
        requiresCsrf: true,
        summary: add.length > 0 ? `收藏到 ${add.length} 个收藏夹` : `从 ${remove.length} 个收藏夹移除`
    };
}
function buildComment(params) {
    const aid = requireAid('comment', params);
    const message = (params.message ?? '').trim();
    if (message.length === 0) {
        throw new ActionParamsError('comment', 'message', '评论不能为空');
    }
    if (message.length > MAX_COMMENT_LENGTH) {
        throw new ActionParamsError('comment', 'message', `最多 ${MAX_COMMENT_LENGTH} 字，当前 ${message.length}`);
    }
    return {
        action: 'comment',
        url: `${API}/x/v2/comment/add`,
        method: 'POST',
        form: { oid: String(aid), type: '1', message },
        requiresCsrf: true,
        summary: `发表评论：${message.slice(0, 20)}${message.length > 20 ? '…' : ''}`
    };
}
function buildShare(params) {
    const bvid = params.video?.bvid;
    if (bvid === undefined || !/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
        throw new ActionParamsError('share', 'bvid', '需要合法的 BV 号');
    }
    return {
        action: 'share',
        url: `${API}/x/web-interface/share/add`,
        method: 'POST',
        form: { bvid },
        requiresCsrf: true,
        summary: '转发到动态'
    };
}
/**
 * 解析写操作的响应。
 *
 * B 站用 `code` 表达业务结果：0 成功，其余都要把 message 原样带出来，
 * 这样用户能看到「已经赞过了」「硬币不足」这类具体原因。
 */
export function parseActionResponse(raw) {
    if (raw === null || typeof raw !== 'object') {
        return { ok: false, code: -1, message: '响应不是对象' };
    }
    const root = raw;
    const code = Number(root.code ?? -1);
    const message = String(root.message ?? '');
    return {
        ok: code === 0,
        code,
        message: code === 0 ? '成功' : message.length > 0 ? message : `接口返回 ${code}`
    };
}
/**
 * 把一次写操作的完整流程走一遍：判策略 → 拼请求 → 校验响应。
 *
 * 网络由 `send` 注入，测试里换成假的即可。
 */
export async function performAction(action, params, deps) {
    if (!deps.allowed(action)) {
        return { ok: false, code: -2, message: '这个操作没有开启' };
    }
    const request = buildActionRequest(action, params);
    const raw = await deps.send(request);
    return parseActionResponse(raw);
}
