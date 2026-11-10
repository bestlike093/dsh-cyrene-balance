import { ErrorCode, PetError } from '@pet/shared';
import { isWorkerMessage, toErrorCode } from './workerProtocol.js';
const DEFAULT_TIMEOUT_MS = 5_000;
/**
 * Worker 隔离版模块加载器。
 *
 * 模块代码、模块的全局对象、模块里能访问到的 DOM 全在独立线程里；
 * 宿主只通过消息提供 `onApiCall`，不再把端口对象和 ShadowRoot 递过去。
 */
export function createWorkerModuleLoader(options) {
    const sources = new Map(options.sources);
    const loaded = new Map();
    const inflight = new Map();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const load = async (id) => {
        const cached = loaded.get(id);
        if (cached !== undefined)
            return cached;
        const pending = inflight.get(id);
        if (pending !== undefined)
            return pending;
        const url = sources.get(id);
        if (url === undefined) {
            throw new PetError(ErrorCode.LOAD_FAILED, `模块不存在：${id}`);
        }
        const promise = WorkerModule.create(id, url, options, timeoutMs).then((module) => {
            loaded.set(id, module);
            return module;
        });
        inflight.set(id, promise);
        try {
            return await promise;
        }
        finally {
            inflight.delete(id);
        }
    };
    return {
        kind: 'worker',
        load,
        has: (id) => loaded.has(id),
        ids: () => [...new Set([...sources.keys(), ...loaded.keys()])],
        get size() {
            return loaded.size;
        },
        terminate(id) {
            const module = loaded.get(id);
            module?.terminate();
            loaded.delete(id);
        }
    };
}
class WorkerModule {
    meta;
    id;
    worker;
    timeoutMs;
    onApiCall;
    /** 同一时刻只有一个生命周期动作在等待：ready / bootstrapped / torn-down。 */
    waiter;
    panelTokens = new Map();
    nextPanelToken = 1;
    terminated = false;
    onMessage = (event) => {
        this.handleMessage(event.data);
    };
    constructor(id, worker, meta, options, timeoutMs) {
        this.id = id;
        this.worker = worker;
        this.meta = meta;
        this.onApiCall = options.onApiCall;
        this.timeoutMs = timeoutMs;
        worker.addEventListener('message', this.onMessage);
    }
    static async create(id, url, options, timeoutMs) {
        const worker = options.createWorker(url);
        const metaPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new PetError(ErrorCode.LOAD_TIMEOUT, `Worker 加载超时：${id}`));
            }, timeoutMs);
            const cleanup = () => {
                clearTimeout(timer);
                worker.removeEventListener('message', listener);
            };
            const listener = (event) => {
                if (!isWorkerMessage(event.data))
                    return;
                const message = event.data;
                if (message.type === 'ready') {
                    cleanup();
                    resolve(message.meta);
                }
                else if (message.type === 'failed') {
                    cleanup();
                    reject(new PetError(toErrorCode(message.code), message.message));
                }
            };
            worker.addEventListener('message', listener);
        });
        worker.postMessage({ type: 'init', url });
        try {
            const meta = await metaPromise;
            return new WorkerModule(id, worker, meta, options, timeoutMs);
        }
        catch (error) {
            worker.terminate?.();
            throw error;
        }
    }
    async bootstrap(ctx) {
        const sandbox = ctx;
        const wait = this.waitFor('bootstrapped');
        this.worker.postMessage({
            type: 'bootstrap',
            config: sandbox.config,
            granted: sandbox.granted
        });
        await wait;
    }
    async teardown() {
        if (this.terminated)
            return;
        const wait = this.waitFor('torn-down');
        this.worker.postMessage({ type: 'teardown' });
        await wait;
        this.terminate();
    }
    terminate() {
        if (this.terminated)
            return;
        this.terminated = true;
        this.worker.removeEventListener('message', this.onMessage);
        if (this.waiter !== undefined) {
            clearTimeout(this.waiter.entry.timer);
            this.waiter.entry.reject(new PetError(ErrorCode.LOAD_FAILED, `Worker 已停止：${this.id}`));
            this.waiter = undefined;
        }
        for (const dispose of this.panelTokens.values())
            dispose();
        this.panelTokens.clear();
        this.worker.terminate?.();
    }
    waitFor(type) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiter = undefined;
                reject(new PetError(ErrorCode.LOAD_TIMEOUT, `Worker 消息超时：${type}`));
            }, this.timeoutMs);
            this.waiter = { type, entry: { resolve, reject, timer } };
        });
    }
    settle(message) {
        const waiter = this.waiter;
        if (waiter === undefined)
            return;
        // failed 不属于某个生命周期消息，但必须唤醒当前的等待者。
        if (message.type !== waiter.type && message.type !== 'failed')
            return;
        clearTimeout(waiter.entry.timer);
        this.waiter = undefined;
        if (message.type === 'failed') {
            waiter.entry.reject(new PetError(toErrorCode(message.code), message.message));
        }
        else {
            waiter.entry.resolve(message);
        }
    }
    handleMessage(value) {
        if (!isWorkerMessage(value))
            return;
        const message = value;
        if (message.type === 'api-call') {
            void this.runApiCall(message);
            return;
        }
        this.settle(message);
    }
    async runApiCall(message) {
        try {
            const result = await this.onApiCall({
                capability: message.capability,
                args: message.args
            });
            let value = result;
            if (message.capability === 'registerPanel') {
                if (typeof result !== 'function') {
                    throw new PetError(ErrorCode.NOT_SUPPORTED, 'registerPanel 必须返回注销函数');
                }
                const token = this.nextPanelToken++;
                this.panelTokens.set(token, result);
                value = token;
            }
            else if (message.capability === 'releasePanel') {
                const token = Number(message.args[0]);
                this.panelTokens.get(token)?.();
                this.panelTokens.delete(token);
                value = undefined;
            }
            this.worker.postMessage({ type: 'api-result', callId: message.callId, ok: true, value });
        }
        catch (error) {
            this.worker.postMessage({
                type: 'api-result',
                callId: message.callId,
                ok: false,
                code: error instanceof PetError ? error.code : ErrorCode.NOT_SUPPORTED,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }
}
/** 供 Worker 入口复用：把模块 id 与 URL 的映射整理成 loadModule。 */
export function urlLoader(sources, load) {
    const byUrl = new Map();
    for (const [id, url] of sources)
        byUrl.set(url, id);
    return (url) => load(byUrl.get(url) ?? url);
}
