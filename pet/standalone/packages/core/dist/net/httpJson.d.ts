/**
 * 网络请求的最小封装：只要 JSON，错误归一，超时可取消。
 *
 * 宿主里每个小工具各自写了一遍 fetch + 超时 + 错误处理，写多了就开始不一致：
 * 有人超时 8 秒，有人不设超时；有人把 404 当成功，有人拿 HTML 去 JSON.parse。
 * 这里收成一处，让上层只关心「拿到数据」或「拿不到，原因是哪一类」。
 *
 * 不引 Node 专用 API。fetch 由调用方注入，core 在浏览器环境里也能跑。
 */
export type HttpErrorKind = 'timeout' | 'network' | 'status' | 'parse' | 'too-large';
export declare class HttpError extends Error {
    readonly kind: HttpErrorKind;
    readonly status?: number;
    readonly url: string;
    constructor(kind: HttpErrorKind, url: string, message: string, status?: number);
}
export interface HttpJsonOptions {
    readonly timeoutMs?: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
    /** 默认 8 秒。外部接口偶发慢，但超过这个数通常已经不可用。 */
    readonly defaultTimeoutMs?: number;
    /** 响应体上限，默认 2 MiB。超过就中止，避免恶意端点把内存吃满。 */
    readonly maxResponseBytes?: number;
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export declare const DEFAULT_TIMEOUT_MS = 8000;
export declare const DEFAULT_MAX_RESPONSE_BYTES: number;
/**
 * 请求并解析 JSON。
 *
 * 四类失败分开报，是因为调用方的处置方式不同：
 * - `timeout`：可以重试，也可以降级成「稍后再问」
 * - `network`：多半是断网或 DNS，重试通常无用
 * - `status`：接口明确拒绝，重试无用，需要看 status
 * - `parse`：收到了东西但不是 JSON，往往是被重定向到登录页或验证页
 *
 * 把 `parse` 单独拎出来，是为了避免把「登录页 HTML」当成空数据静默吞掉。
 */
export declare function httpJson<T>(url: string, fetchImpl: FetchLike, options?: HttpJsonOptions): Promise<T>;
