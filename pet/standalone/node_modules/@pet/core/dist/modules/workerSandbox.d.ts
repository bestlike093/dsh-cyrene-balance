import type { IPetalModule, PanelSpec } from '@pet/shared';
import type { ModuleLoader } from './moduleLoader.js';
import type { WorkerCapability, WorkerScope } from './workerProtocol.js';
/** 宿主侧看到的 Worker 句柄；测试可传同线程替身。 */
export interface WorkerHandle extends WorkerScope {
    terminate?(): void;
}
export interface WorkerApiCall {
    readonly capability: WorkerCapability;
    readonly args: readonly unknown[];
}
export interface WorkerModuleLoaderOptions {
    /** 模块 id → Worker 入口 URL。 */
    readonly sources: Iterable<readonly [string, string]>;
    readonly createWorker: (url: string) => WorkerHandle;
    /**
     * Worker 发起的能力调用。`registerPanel` 需要返回一个注销函数，
     * 其余能力按原样返回结果。宿主必须在这里再做一次权限与参数校验。
     */
    readonly onApiCall: (call: WorkerApiCall) => unknown | Promise<unknown>;
    readonly timeoutMs?: number;
}
export interface WorkerModuleLoader extends ModuleLoader {
    /** 主动结束某个模块的 Worker；未加载的 id 视为已结束。 */
    terminate(id: string): void;
}
/**
 * Worker 隔离版模块加载器。
 *
 * 模块代码、模块的全局对象、模块里能访问到的 DOM 全在独立线程里；
 * 宿主只通过消息提供 `onApiCall`，不再把端口对象和 ShadowRoot 递过去。
 */
export declare function createWorkerModuleLoader(options: WorkerModuleLoaderOptions): WorkerModuleLoader;
/** 供 Worker 入口复用：把模块 id 与 URL 的映射整理成 loadModule。 */
export declare function urlLoader(sources: ReadonlyMap<string, string>, load: (url: string) => Promise<IPetalModule>): (url: string) => Promise<IPetalModule>;
/** 面板规格类型在此导出，避免 Worker 入口重复依赖 shared。 */
export type WorkerPanelSpec = PanelSpec;
