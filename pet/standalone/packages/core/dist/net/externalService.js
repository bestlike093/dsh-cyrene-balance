/**
 * 外部服务的接入接口。
 *
 * 原则：不内置任何服务商与密钥。桌宠发出去给别人用，写死一家、
 * 或者带一个默认 key，都会变成「作者替使用者做了决定」——既不合适，
 * 也让换服务变成改代码。
 *
 * 所以这里只定义三样东西：
 *
 * 1. 用户要填什么（`ServiceCredential`）
 * 2. 没填时怎么报（`resolveService` 返回缺哪几项，而不是抛一个模糊错误）
 * 3. 填了之后怎么跑（`defineService` 把请求拼装、解析、缓存串起来）
 *
 * 具体请求长什么样由调用方定义，core 不猜接口格式。
 */
import { httpJson } from './httpJson.js';
import { TtlCache } from './ttlCache.js';
export const SERVICE_IDS = ['weather', 'exchangeRate', 'translate', 'llm'];
/**
 * 判断某个服务能不能用。
 *
 * 两项都缺时按「还差什么」的顺序列出来，让人一次填完，
 * 避免填了 key 之后再被告诉「还缺地址」。
 */
export function resolveService(config, id, definition) {
    const credential = config[id];
    const missing = [];
    const hasApiKey = isNonEmpty(credential?.apiKey);
    if (!hasApiKey)
        missing.push('apiKey');
    const hasEndpoint = isNonEmpty(credential?.endpoint) ||
        isNonEmpty(credential?.baseUrl) ||
        isNonEmpty(definition?.endpoint);
    if (!hasEndpoint)
        missing.push('endpoint');
    // 大模型还多一项：不知道模型名就没法发请求。
    if (id === 'llm' && !isNonEmpty(credential?.model))
        missing.push('model');
    return { id, configured: missing.length === 0, missing };
}
/** 一次报出所有服务的状态，面板可以照着标红字。 */
export function resolveAll(config, definitions = {}) {
    return SERVICE_IDS.map((id) => resolveService(config, id, definitions[id]));
}
export class ServiceNotConfiguredError extends Error {
    id;
    missing;
    constructor(id, missing) {
        super(`服务 ${id} 还没配置：缺少 ${missing.join('、')}`);
        this.name = 'ServiceNotConfiguredError';
        this.id = id;
        this.missing = missing;
    }
}
/**
 * 把定义和配置绑成一个可调用的东西。
 *
 * 没配置时返回 `null` 而不是抛错——调用方据此在面板上提示用户去填，
 * 而不是在业务逻辑里到处 try/catch。
 */
export function createServiceRunner(definition, config, options) {
    const id = definition.id;
    const status = resolveService(config, id, definition);
    if (!status.configured)
        return null;
    const credential = config[id];
    const cache = options.cache ??
        new TtlCache(options.now ?? (() => Date.now()));
    const fetchImpl = options.fetchImpl;
    const normalized = {
        apiKey: credential.apiKey,
        endpoint: credential.endpoint ?? credential.baseUrl ?? definition.endpoint,
        baseUrl: credential.baseUrl ?? credential.endpoint ?? definition.endpoint,
        model: credential.model,
        proxy: credential.proxy,
        extras: credential.extras
    };
    return async (input) => {
        const request = definition.buildRequest(input, normalized);
        const cacheKey = `${id}:${request.url}`;
        return cache.remember(cacheKey, definition.ttlMs, async () => {
            const raw = await httpJson(request.url, fetchImpl, {
                ...options.http,
                headers: { ...options.http?.headers, ...request.headers }
            });
            return definition.parse(raw);
        });
    };
}
function isNonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
