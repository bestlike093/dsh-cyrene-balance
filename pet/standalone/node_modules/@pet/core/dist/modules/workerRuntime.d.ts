import type { IPetalModule } from '@pet/shared';
import type { WorkerScope } from './workerProtocol.js';
export interface WorkerRuntimeOptions {
    readonly scope: WorkerScope;
    /** 由具体 Worker 入口注入，负责把 url 变成模块实例。 */
    readonly loadModule: (url: string) => Promise<IPetalModule>;
    /** 网络遮蔽目标；默认 globalThis，单测可传替身避免影响测试进程。 */
    readonly networkTarget?: Record<string, unknown>;
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
export declare function runModuleInWorker(options: WorkerRuntimeOptions): void;
