/**
 * 网络请求的最小封装：只要 JSON，错误归一，超时可取消。
 *
 * 宿主里每个小工具各自写了一遍 fetch + 超时 + 错误处理，写多了就开始不一致：
 * 有人超时 8 秒，有人不设超时；有人把 404 当成功，有人拿 HTML 去 JSON.parse。
 * 这里收成一处，让上层只关心「拿到数据」或「拿不到，原因是哪一类」。
 *
 * 不引 Node 专用 API。fetch 由调用方注入，core 在浏览器环境里也能跑。
 */
export class HttpError extends Error {
    kind;
    status;
    url;
    constructor(kind, url, message, status) {
        super(message);
        this.name = 'HttpError';
        this.kind = kind;
        this.url = url;
        if (status !== undefined)
            this.status = status;
    }
}
export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** 只允许 http/https；file://、gopher:// 等协议一律拒绝。 */
function assertHttpUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new HttpError('network', url, 'URL 不合法');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new HttpError('network', url, `不支持的协议：${parsed.protocol}`);
    }
}
/** 读取响应体并解析 JSON；流式累计，超限立即中止。 */
async function readJsonBody(response, url, maxBytes, timeoutMs) {
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new HttpError('too-large', url, `响应超过 ${maxBytes} 字节上限`);
    }
    let text;
    if (response.body === null) {
        try {
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength > maxBytes) {
                throw new HttpError('too-large', url, `响应超过 ${maxBytes} 字节上限`);
            }
            text = new TextDecoder().decode(buffer);
        }
        catch (error) {
            if (error instanceof HttpError)
                throw error;
            if (isAbortError(error)) {
                throw new HttpError('timeout', url, `请求超时（${timeoutMs}ms）`);
            }
            throw new HttpError('parse', url, `读取响应失败：${describe(error)}`);
        }
    }
    else {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value === undefined)
                    continue;
                total += value.byteLength;
                if (total > maxBytes) {
                    await reader.cancel().catch(() => undefined);
                    throw new HttpError('too-large', url, `响应超过 ${maxBytes} 字节上限`);
                }
                chunks.push(value);
            }
        }
        catch (error) {
            if (error instanceof HttpError)
                throw error;
            if (isAbortError(error)) {
                throw new HttpError('timeout', url, `请求超时（${timeoutMs}ms）`);
            }
            throw new HttpError('parse', url, `读取响应失败：${describe(error)}`);
        }
        finally {
            try {
                reader.releaseLock();
            }
            catch {
                // 已取消或已释放时忽略。
            }
        }
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }
        text = new TextDecoder().decode(merged);
    }
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new HttpError('parse', url, `响应不是合法 JSON：${describe(error)}`);
    }
}
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
export async function httpJson(url, fetchImpl, options = {}) {
    assertHttpUrl(url);
    const timeoutMs = options.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await fetchImpl(url, {
                headers: options.headers,
                signal: controller.signal
            });
        }
        catch (error) {
            const aborted = isAbortError(error);
            throw new HttpError(aborted ? 'timeout' : 'network', url, aborted ? `请求超时（${timeoutMs}ms）` : `网络请求失败：${describe(error)}`);
        }
        if (!response.ok) {
            throw new HttpError('status', url, `接口返回 ${response.status}`, response.status);
        }
        try {
            return await readJsonBody(response, url, maxResponseBytes, timeoutMs);
        }
        finally {
            // 读取阶段被 abort 时 reader 会抛错，错误已由 readJsonBody 归一。
        }
    }
    finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
    }
}
function isAbortError(error) {
    return (typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError');
}
function describe(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
