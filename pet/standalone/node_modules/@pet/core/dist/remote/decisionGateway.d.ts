import { HybridClock } from '@pet/shared';
import type { DecisionAction, DecisionEnvelope, DecisionKind, DecisionReply, IChannelAdapter, TimeoutPolicy } from '@pet/shared';
export interface DecisionRequest {
    readonly kind: DecisionKind;
    readonly summary: string;
    readonly payload?: unknown;
    readonly ttlMs?: number;
    /** 本机上下文摘要，远端可核对，不携带原文 */
    readonly contextDigest?: string;
}
export interface DecisionOutcome {
    readonly status: 'allowed' | 'denied' | 'answered' | 'dismissed' | 'timeout';
    readonly envelope: DecisionEnvelope;
    readonly reply?: DecisionReply;
    /** 超时后回退本地弹窗时为 true */
    readonly usedFallback: boolean;
}
export interface DecisionGatewayOptions {
    readonly deviceId: string;
    readonly channels: readonly IChannelAdapter[];
    readonly timeoutMs?: number;
    readonly timeoutPolicy?: TimeoutPolicy;
    readonly clock?: HybridClock;
    readonly now?: () => number;
    readonly signer?: (payload: string) => Promise<string>;
    readonly nonce?: () => string;
    readonly id?: () => string;
    /**
     * 远程回复授权。带 sender 的回复必须过这一关，未配置一律拒绝。
     * 抛错按拒绝处理，避免把异常当放行。
     */
    readonly authorizeReply?: (reply: DecisionReply, envelope: DecisionEnvelope, channelId: string) => boolean;
}
/**
 * 决策网关：创建 envelope、分发到所有通道、等待任意一个回复。
 * 最小版本 payload 以 `plain:` 前缀承载，Vault 接入后替换为密文。
 */
export declare class DecisionGateway {
    private readonly deviceId;
    private readonly channels;
    private readonly timeoutMs;
    private readonly timeoutPolicy;
    private readonly clock;
    private readonly now;
    private readonly signer;
    private readonly nonce;
    private readonly id;
    private readonly authorizeReply;
    private readonly pending;
    /** 已结算结果短暂保留，避免「回复先到、wait 后到」被误判为不存在。 */
    private readonly settled;
    private readonly settledLimit;
    private readonly unsubscribers;
    private disposed;
    constructor(options: DecisionGatewayOptions);
    get pendingIds(): readonly string[];
    prepare(request: DecisionRequest): Promise<DecisionEnvelope>;
    wait(id: string): Promise<DecisionOutcome>;
    ask(request: DecisionRequest): Promise<DecisionOutcome>;
    /** 本地 UI / 测试直接提交决定。 */
    resolve(id: string, action: DecisionAction, answer?: string): DecisionOutcome;
    dispose(): void;
    private handleReply;
    /**
     * 回复来源校验。
     *
     * - 没有 sender：只允许本机回环。远程通道漏填 sender 时不会被当成主人。
     * - sender.channelId 与订阅通道不一致：拒绝，防止跨通道冒用身份。
     * - 其余情况：必须由 authorizeReply 明确放行；未配置、抛错都按拒绝处理。
     */
    private isAuthorized;
    private settle;
}
