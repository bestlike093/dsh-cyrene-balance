/**
 * v2.2 宿主适配契约（文档第 9 章端口层、第 16 章 ①）。
 *
 * 铁律 3：失败必须可见。探测失败抛 `HostProbeError`；
 * 返回空 `available` 只表示「探测成功，宿主确实没有声明任何能力」。
 */
import type { HostCapability } from '../types/module.js';
/**
 * 宿主能力快照。
 *
 * 三态语义，不可混用：
 * - `available` 含该项 → 宿主确实具备；
 * - `notApplicable` 含该项 → 该宿主形态下本就不存在这个概念（如纯插件形态的 `tray`）；
 * - 两者都不含 → 本该具备但缺失，触发降级。
 *
 * `available` 为空是合法结果（宿主在线但零能力），
 * 探测本身失败必须走 `HostProbeError`，三者不可混用。
 */
export interface HostCapabilitySnapshot {
    readonly version: string;
    readonly available: readonly HostCapability[];
    /** 该宿主形态下不适用的能力。省略等同于空数组。 */
    readonly notApplicable?: readonly HostCapability[];
}
export type HostProbeFailureCode = 'HOST_NOT_FOUND' | 'VERSION_UNREADABLE' | 'DECLARATION_INVALID' | 'PROBE_FAILED';
/** 探测失败的唯一表达形式。调用方按 code 决定降级路径。 */
export declare class HostProbeError extends Error {
    readonly code: HostProbeFailureCode;
    constructor(code: HostProbeFailureCode, message: string, options?: {
        readonly cause?: unknown;
    });
}
export interface AskRequest {
    readonly id: string;
    readonly question: string;
    readonly options?: readonly string[];
    readonly timeoutMs?: number;
}
export interface AskResponse {
    readonly id: string;
    readonly answer: string;
    readonly source: 'pet' | 'web';
}
export interface ApprovalRequest {
    readonly id: string;
    readonly title: string;
    readonly detail?: string;
    readonly risk: 'low' | 'medium' | 'high';
}
export interface TaskProgress {
    readonly id: string;
    readonly label: string;
    readonly ratio: number;
    readonly state: 'running' | 'done' | 'failed';
}
/**
 * 宿主能力调用接口。由 apps/desktop 注入真实实现；
 * core 及以下任何包都不得直接 import electron 或 dsh 内部模块。
 */
export interface HostAdapter {
    readonly version: string;
    ask?(request: AskRequest): Promise<AskResponse>;
    approve?(request: ApprovalRequest): Promise<boolean>;
    reportTask?(progress: TaskProgress): void;
}
/**
 * 宿主适配器。`LocalHostAdapter` 是第一个实现者。
 *
 * 实现约束：
 * - 成功必须返回带 version 的快照；
 * - 失败必须抛 `HostProbeError`，禁止用空数组表示失败。
 */
export interface IHostAdapter extends HostAdapter {
    detect(): Promise<HostCapabilitySnapshot>;
}
