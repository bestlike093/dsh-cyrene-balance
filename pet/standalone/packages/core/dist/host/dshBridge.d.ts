import type { ApprovalRequest, AskRequest, AskResponse, HostAdapter, HostCapabilitySnapshot, TaskProgress } from '@pet/shared';
/** 宿主能力快照。只有这里为 true 的能力，上层才允许调用对应接口。 */
export interface DshCapabilities {
    readonly version: string;
    readonly ask: boolean;
    readonly approval: boolean;
    readonly taskProgress: boolean;
    readonly settings: boolean;
    readonly tray: boolean;
    readonly window: boolean;
}
/**
 * 宿主调用契约已上移到 `@pet/shared` 的 contracts/host.ts，
 * 与 `IHostAdapter` / `HostCapabilitySnapshot` 共用同一份定义；
 * 此处 re-export 保持既有导入路径可用。
 */
export type { ApprovalRequest, AskRequest, AskResponse, HostAdapter, TaskProgress };
/**
 * 全项目唯一允许接触宿主的入口。
 * 宿主缺失时统一降级为 NOT_SUPPORTED，而不是抛底层错误让调用方崩掉。
 */
export declare class DshBridge {
    private readonly host;
    private readonly caps;
    private constructor();
    static connect(host?: HostAdapter, snapshot?: HostCapabilitySnapshot): DshBridge;
    capabilities(): DshCapabilities;
    isAvailable(cap: Exclude<keyof DshCapabilities, 'version'>): boolean;
    ask(request: AskRequest): Promise<AskResponse>;
    approve(request: ApprovalRequest): Promise<boolean>;
    reportTask(progress: TaskProgress): void;
    /** 诊断面板用：把能力快照压成一行，方便贴日志。 */
    describe(): string;
}
