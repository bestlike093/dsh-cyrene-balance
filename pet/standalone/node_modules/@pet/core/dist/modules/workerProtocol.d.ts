import { ErrorCode } from '@pet/shared';
import type { ModuleConfig, ModuleMeta, Permission } from '@pet/shared';
/**
 * 模块 Worker 协议。
 *
 * 消息只走结构化克隆，不含函数、DOM 节点或宿主对象。
 * 能力调用一律由 Worker 发起、宿主执行，Worker 侧拿不到端口本体。
 */
export type WorkerCapability = 'fetch' | 'readAsset' | 'readMemory' | 'writeMemory' | 'render' | 'registerPanel' | 'releasePanel';
export type WorkerModuleMessage = {
    readonly type: 'init';
    readonly url: string;
} | {
    readonly type: 'ready';
    readonly meta: ModuleMeta;
} | {
    readonly type: 'bootstrap';
    readonly config: ModuleConfig;
    readonly granted: readonly Permission[];
} | {
    readonly type: 'bootstrapped';
} | {
    readonly type: 'teardown';
} | {
    readonly type: 'torn-down';
} | {
    readonly type: 'failed';
    readonly code: string;
    readonly message: string;
} | {
    readonly type: 'api-call';
    readonly callId: number;
    readonly capability: WorkerCapability;
    readonly args: readonly unknown[];
} | {
    readonly type: 'api-result';
    readonly callId: number;
    readonly ok: boolean;
    readonly value?: unknown;
    readonly code?: string;
    readonly message?: string;
};
/** Worker 运行态主动发给宿主的消息子集。 */
export type WorkerRuntimeMessage = Extract<WorkerModuleMessage, {
    type: 'ready' | 'bootstrapped' | 'torn-down' | 'failed' | 'api-call';
}>;
/** Worker 线程一侧能用的最小 scope 形状，便于在单测里用替身。 */
export interface WorkerScope {
    postMessage(message: WorkerModuleMessage): void;
    addEventListener(type: 'message', listener: (event: {
        data: unknown;
    }) => void): void;
    removeEventListener(type: 'message', listener: (event: {
        data: unknown;
    }) => void): void;
}
export declare function isWorkerMessage(value: unknown): value is WorkerModuleMessage;
/** 把跨线程传来的字符串错误码收回成 ErrorCode，未知值统一按 LOAD_FAILED。 */
export declare function toErrorCode(code: string | undefined): ErrorCode;
