/**
 * B 站只读接口的请求与响应处理。
 *
 * 只做信息读取：视频详情、分 P 列表、搜索。
 * 写操作策略在 `bilibili.ts`，两处分开，互不干扰。
 *
 * 对应能力：`browse.bilibili.read`。
 */
export declare class BilibiliResponseError extends Error {
    readonly code: number;
    constructor(code: number, message: string);
}
export interface VideoSummary {
    readonly bvid: string;
    readonly aid: number;
    readonly title: string;
    readonly author: string;
    readonly authorId: number;
    /** 秒。 */
    readonly duration: number;
    readonly cover: string;
    readonly description: string;
    readonly publishedAt: number;
    readonly stats: {
        readonly view: number;
        readonly danmaku: number;
        readonly like: number;
        readonly coin: number;
        readonly favorite: number;
        readonly share: number;
    };
    readonly pages: readonly VideoPage[];
}
export interface VideoPage {
    readonly page: number;
    readonly title: string;
    readonly duration: number;
}
export interface SearchItem {
    readonly bvid: string;
    readonly title: string;
    readonly author: string;
    readonly duration: number;
    readonly play: number;
    readonly cover: string;
}
export interface SearchResult {
    readonly page: number;
    readonly total: number;
    readonly items: readonly SearchItem[];
}
/** 视频详情地址。 */
export declare function videoInfoUrl(bvid: string): string;
/** 分 P 列表地址。`bvid` 与 `aid` 二选一。 */
export declare function videoPagesUrl(id: {
    bvid?: string;
    aid?: number;
}): string;
/** 搜索地址。 */
export declare function searchUrl(keyword: string, page?: number): string;
/** 从 BV 号或完整链接里取出 BV 号。 */
export declare function normalizeBvid(input: string): string;
/** 解析 `/x/web-interface/view` 的响应。 */
export declare function parseVideoInfo(raw: unknown): VideoSummary;
/** 解析搜索响应。 */
export declare function parseSearch(raw: unknown): SearchResult;
/** `12:34` 或 `1:02:03` 转成秒。 */
export declare function parseDuration(text: string): number;
/** 秒转 `mm:ss`，超过一小时用 `h:mm:ss`。 */
export declare function formatDuration(seconds: number): string;
