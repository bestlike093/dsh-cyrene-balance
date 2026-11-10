import { ErrorCode, PetError } from '@pet/shared';
const DEFAULT_LOAD_TIMEOUT_MS = 5_000;
/** 超时后迟到的模块同样要 teardown，清理失败不能盖住原始超时。 */
function disposeQuietly(module) {
    void Promise.resolve()
        .then(() => module.teardown())
        .catch(() => undefined);
}
/**
 * 注册表式懒加载：静态映射 + 首次实例化，无代码分割。
 * 接口与真 import() 版本保持一致，S3 的 DoD 不依赖打包器。
 */
export function createRegistryModuleLoader(sources, options = {}) {
    const registry = new Map(sources);
    const cache = new Map();
    const inflight = new Map();
    /**
     * 每个 id 的 epoch。超时或取消时递增，用来让「判定失败之后才回来的结果」失效。
     * 没有这道闸，迟到的模块会被当成正常结果写入缓存或继续 attach。
     */
    const generations = new Map();
    const defaultTimeout = options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    const currentGeneration = (id) => generations.get(id) ?? 0;
    const bumpGeneration = (id) => {
        generations.set(id, currentGeneration(id) + 1);
    };
    const loadOnce = (id, timeoutMs, externalSignal) => {
        const source = registry.get(id);
        if (source === undefined) {
            return Promise.reject(new PetError(ErrorCode.LOAD_FAILED, `模块不存在：${id}`));
        }
        const generation = currentGeneration(id);
        const controller = new AbortController();
        const onExternalAbort = () => {
            controller.abort();
        };
        if (externalSignal?.aborted === true) {
            controller.abort();
        }
        else {
            externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            let cancelled = false;
            const cleanup = () => {
                clearTimeout(timer);
                externalSignal?.removeEventListener('abort', onExternalAbort);
                controller.signal.removeEventListener('abort', onAbort);
            };
            const finish = (action) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                action();
            };
            const onAbort = () => {
                cancelled = true;
                bumpGeneration(id);
                finish(() => reject(new PetError(ErrorCode.LOAD_FAILED, `模块加载已取消：${id}`)));
            };
            const timer = setTimeout(() => {
                cancelled = true;
                bumpGeneration(id);
                finish(() => reject(new PetError(ErrorCode.LOAD_TIMEOUT, `模块加载超时（${timeoutMs}ms）：${id}`)));
                controller.abort();
            }, Math.max(0, Math.trunc(timeoutMs)));
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (controller.signal.aborted)
                onAbort();
            Promise.resolve()
                .then(() => source(id))
                .then((module) => {
                // 判定失败之后再回来的结果一律丢弃：不写缓存、不注册、只清理。
                if (cancelled || controller.signal.aborted || currentGeneration(id) !== generation) {
                    disposeQuietly(module);
                    return;
                }
                finish(() => resolve(module));
            }, (error) => {
                finish(() => reject(error));
            });
        });
    };
    const load = async (id, loadOptions = {}) => {
        const cached = cache.get(id);
        if (cached !== undefined)
            return cached;
        const pending = inflight.get(id);
        if (pending !== undefined)
            return pending;
        const generation = currentGeneration(id);
        const promise = loadOnce(id, loadOptions.timeoutMs ?? defaultTimeout, loadOptions.signal);
        inflight.set(id, promise);
        try {
            const module = await promise;
            // 写缓存前再比一次：resolve 与写入之间若发生超时递增，旧结果不落地。
            if (currentGeneration(id) !== generation) {
                disposeQuietly(module);
                throw new PetError(ErrorCode.LOAD_FAILED, `模块加载结果已过期：${id}`);
            }
            cache.set(id, module);
            return module;
        }
        finally {
            inflight.delete(id);
        }
    };
    return {
        kind: 'registry',
        load,
        /** 只表示「已加载并持有实例」；已知但未加载的源请看 ids()。 */
        has: (id) => cache.has(id),
        ids: () => [...new Set([...registry.keys(), ...cache.keys()])],
        get size() {
            return cache.size;
        }
    };
}
