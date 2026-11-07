import { ErrorCode, PetError, isPetError } from '@pet/shared';
import { createDisposerRegistry } from './disposer.js';
import { installRealmNetworkGuard } from './moduleSandbox.js';
import { isWorkerMessage, toErrorCode } from './workerProtocol.js';
function workerError(error) {
    if (isPetError(error))
        return { code: error.code, message: error.message };
    return {
        code: ErrorCode.LOAD_FAILED,
        message: error instanceof Error ? error.message : String(error)
    };
}
/**
 * Worker 线程里的模块运行时。
 *
 * 与主 realm 的 `createSandboxContext` 同构：能力按权限逐项挂载，
 * 差别是每个能力都变成一次 RPC，模块拿不到宿主端口本体，也没有 DOM。
 *
 * 全局网络在这里**无条件**遮蔽：即使模块声明了 net.egress，出网也必须
 * 经 `api.net.fetch → 宿主 onApiCall`，由宿主决定放不放行。
 */
export function runModuleInWorker(options) {
    const { scope, loadModule } = options;
    const pending = new Map();
    let module;
    let nextCallId = 1;
    installRealmNetworkGuard({
        allowNetwork: false,
        ...(options.networkTarget === undefined ? {} : { target: options.networkTarget })
    });
    const callHost = (capability, args) => {
        const callId = nextCallId++;
        return new Promise((resolve, reject) => {
            pending.set(callId, { resolve: resolve, reject });
            scope.postMessage({ type: 'api-call', callId, capability, args });
        });
    };
    const failAll = (error) => {
        for (const [callId, entry] of pending) {
            pending.delete(callId);
            entry.reject(error);
        }
    };
    const send = (message) => scope.postMessage(message);
    const buildApi = (granted) => {
        const api = {};
        if (granted.has('net.egress')) {
            api.net = Object.freeze({
                fetch: (input, init) => callHost('fetch', [input, init])
            });
        }
        if (granted.has('fs.user-assets.read')) {
            api.fs = Object.freeze({
                readAsset: (path) => callHost('readAsset', [path])
            });
        }
        if (granted.has('memory.read') || granted.has('memory.write')) {
            const memory = {};
            if (granted.has('memory.read')) {
                memory.read = (key) => callHost('readMemory', [key]);
            }
            if (granted.has('memory.write')) {
                memory.write = (key, value) => callHost('writeMemory', [key, value]);
            }
            api.memory = Object.freeze(memory);
        }
        if (granted.has('ui.render') || granted.has('ui.panel')) {
            const ui = {};
            if (granted.has('ui.render')) {
                ui.render = (html) => {
                    void callHost('render', [html]);
                };
            }
            if (granted.has('ui.panel')) {
                ui.panel = Object.freeze({
                    register: (spec) => {
                        // 面板注销句柄不能跨线程，Worker 侧只保留一个 token 的 Promise。
                        const token = callHost('registerPanel', [spec]);
                        return () => {
                            void token.then((value) => callHost('releasePanel', [value])).catch(() => undefined);
                        };
                    }
                });
            }
            api.ui = Object.freeze(ui);
        }
        return api;
    };
    const handleInit = async (url) => {
        try {
            module = await loadModule(url);
            send({ type: 'ready', meta: module.meta });
        }
        catch (error) {
            send({ type: 'failed', ...workerError(error) });
        }
    };
    const handleBootstrap = async (config, permissions) => {
        if (module === undefined) {
            send({ type: 'failed', code: ErrorCode.LOAD_FAILED, message: '模块尚未加载' });
            return;
        }
        const granted = new Set(permissions);
        const api = buildApi(granted);
        const context = Object.freeze({
            // Worker 没有 DOM；模块只能通过 ui.render / ui.panel 交 HTML 给宿主。
            root: undefined,
            config: Object.freeze({ ...config }),
            disposers: createDisposerRegistry(),
            granted: Object.freeze([...granted]),
            api
        });
        try {
            await module.bootstrap(context);
            send({ type: 'bootstrapped' });
        }
        catch (error) {
            send({ type: 'failed', ...workerError(error) });
        }
    };
    const handleTeardown = async () => {
        try {
            await module?.teardown();
            send({ type: 'torn-down' });
        }
        catch (error) {
            send({ type: 'failed', ...workerError(error) });
        }
        finally {
            failAll(new PetError(ErrorCode.LOAD_FAILED, 'Worker 已停止'));
        }
    };
    const onMessage = (event) => {
        const message = isWorkerMessage(event.data)
            ? event.data
            : undefined;
        if (message === undefined)
            return;
        switch (message.type) {
            case 'init':
                void handleInit(message.url);
                break;
            case 'bootstrap':
                void handleBootstrap(message.config, message.granted);
                break;
            case 'teardown':
                void handleTeardown();
                break;
            case 'api-result': {
                const entry = pending.get(message.callId);
                if (entry === undefined)
                    return;
                pending.delete(message.callId);
                if (message.ok) {
                    entry.resolve(message.value);
                }
                else {
                    entry.reject(new PetError(toErrorCode(message.code), message.message ?? '宿主能力调用失败'));
                }
                break;
            }
            default:
                break;
        }
    };
    scope.addEventListener('message', onMessage);
}
