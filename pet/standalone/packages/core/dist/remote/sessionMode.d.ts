import type { Permission } from '@pet/shared';
import type { PermissionBroker } from '../modules/permissionBroker.js';
/**
 * 会话模式：先决定「谁在说话」，再决定「她此刻能做什么」。
 *
 * 同一条 QQ 消息，来自主人私聊还是群友，工具面必须不同。
 * 这层不替代 PermissionBroker，而是它的输入源：模式 → 权限集 → broker.replace()。
 *
 * - `chat`：群友场景。能渲染、能读记忆，不能写记忆、不能联网、不能替你拍板。
 * - `closed-agent`：主人私聊。完整权限，对应「在 QQ 上远程指挥」。
 *
 * 默认 `chat`：没明确说「这是主人」之前，一律按最小集处理。
 */
export type SessionMode = 'chat' | 'closed-agent';
/** 切换原因。自动降权要和手动切换分开记，否则事后分不清是忘了还是系统收的。 */
export type SwitchReason = 'manual' | 'idle-timeout';
export declare function isSessionMode(value: string): value is SessionMode;
/**
 * 未知模式直接抛错，不回退到任何默认集。
 *
 * 这里必须硬失败：把拼错的模式名悄悄当成 `chat` 会让权限静默降级，
 * 当成 `closed-agent` 则是更糟的提权。
 */
export declare function permissionsForMode(mode: SessionMode): readonly Permission[];
export interface ModeSwitchEntry {
    readonly from: SessionMode | null;
    readonly to: SessionMode;
    readonly at: number;
    readonly reason: SwitchReason;
}
export interface SessionModeGateOptions {
    readonly broker: PermissionBroker;
    readonly initial?: SessionMode;
    readonly now?: () => number;
    /** 提权后的空闲降权窗口，默认 5 分钟；0 关闭。 */
    readonly idleTimeoutMs?: number;
}
/**
 * 会话模式闸门。
 *
 * 切换模式时用 `replace()` 覆盖式下发：升权与降权走同一条路径，
 * 从 `closed-agent` 切回 `chat` 时多余权限会被逐项收回并留审计。
 *
 * 提权是有代价的状态，所以带空闲降权：切过去之后长时间没人说话，
 * 下一轮 `tick()` 会自己收回来，不需要谁记得手动切。
 */
export declare class SessionModeGate {
    private readonly broker;
    private readonly now;
    private readonly idleTimeoutMs;
    private readonly history;
    private readonly listeners;
    private modeValue;
    private lastActivityAt;
    constructor(options: SessionModeGateOptions);
    get mode(): SessionMode;
    get idleMs(): number;
    /** 当前模式是否允许某权限。给运行时裁决用，不抛错。 */
    can(permission: Permission): boolean;
    /** 记录一次活动，把空闲计时归零。每收到一条属于主人的消息调一次。 */
    touch(now?: number): void;
    /**
     * 宿主定时调用：检查是否该自动降权。
     *
     * 返回 true 表示这一轮发生了降权，调用方可以据此提示一句。
     * 不在类内部起定时器，是为了让测试完全可控，不依赖真实时钟。
     */
    tick(now?: number): boolean;
    /**
     * 切换模式。
     *
     * 同一模式重复切换直接返回，不产生重复审计项——
     * 高频轮询里反复写「chat → chat」会把真正的切换淹掉。
     */
    switchTo(mode: SessionMode, reason?: SwitchReason): void;
    /** 订阅模式切换。返回取消函数。 */
    onChange(listener: (entry: ModeSwitchEntry) => void): () => void;
    audit(): readonly ModeSwitchEntry[];
    snapshot(): {
        readonly mode: SessionMode;
        readonly permissions: readonly Permission[];
    };
}
