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
import type { BilibiliWriteAction } from './bilibili';
export interface ActionRequest {
    readonly action: BilibiliWriteAction;
    readonly url: string;
    readonly method: 'POST';
    /** 表单字段，已转成字符串。 */
    readonly form: Readonly<Record<string, string>>;
    /** 是否必须带 csrf（也就是 Cookie 里的 bili_jct）。 */
    readonly requiresCsrf: boolean;
    /** 给界面看的一句话，确认框直接用。 */
    readonly summary: string;
}
export declare class ActionParamsError extends Error {
    readonly action: string;
    readonly field: string;
    constructor(action: string, field: string, message: string);
}
export interface VideoTarget {
    readonly aid: number;
    readonly bvid?: string;
}
export interface ActionParams {
    /** 点赞 / 投币 / 收藏 / 评论都要。 */
    readonly video?: VideoTarget;
    /** 点赞传 true 表示取消。 */
    readonly like?: boolean;
    /** 投币枚数，1 到 2。 */
    readonly coinCount?: number;
    /** 投币时顺带点赞。 */
    readonly alsoLike?: boolean;
    /** 收藏夹 id 列表；空数组表示只取消收藏。 */
    readonly addToFavorites?: readonly number[];
    readonly removeFromFavorites?: readonly number[];
    /** 评论正文。 */
    readonly message?: string;
}
/** 评论最长 1000 字，和 B 站前端限制一致。 */
export declare const MAX_COMMENT_LENGTH = 1000;
/**
 * 拼一次写操作请求。
 *
 * 参数不对当场抛错，不等到发出去被服务端拒。
 */
export declare function buildActionRequest(action: BilibiliWriteAction, params: ActionParams): ActionRequest;
export interface ActionResponse {
    readonly ok: boolean;
    readonly code: number;
    readonly message: string;
}
/**
 * 解析写操作的响应。
 *
 * B 站用 `code` 表达业务结果：0 成功，其余都要把 message 原样带出来，
 * 这样用户能看到「已经赞过了」「硬币不足」这类具体原因。
 */
export declare function parseActionResponse(raw: unknown): ActionResponse;
/**
 * 把一次写操作的完整流程走一遍：判策略 → 拼请求 → 校验响应。
 *
 * 网络由 `send` 注入，测试里换成假的即可。
 */
export declare function performAction(action: BilibiliWriteAction, params: ActionParams, deps: {
    readonly allowed: (action: BilibiliWriteAction) => boolean;
    readonly send: (request: ActionRequest) => Promise<unknown>;
}): Promise<ActionResponse>;
