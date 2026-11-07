/**
 * v2.1 远程决策与通道契约（文档第 9 章）。
 * envelope 只携带摘要与密文，原始上下文不出本机。
 */
import type { DiagResult } from '../types/module.js';
export type DecisionKind = 'approval' | 'question' | 'notice';
export type DecisionAction = 'allow' | 'deny' | 'answer' | 'dismiss';
export declare const DECISION_KINDS: readonly DecisionKind[];
export declare const DECISION_ACTIONS: readonly DecisionAction[];
export interface DecisionEnvelope {
    readonly id: string;
    readonly kind: DecisionKind;
    readonly deviceId: string;
    readonly hlc: string;
    readonly nonce: string;
    readonly expiresAt: number;
    /** 本机装配上下文的摘要，远端可核对，不携带原文 */
    readonly contextDigest?: string;
    readonly summary: string;
    readonly payloadCipher: string;
    readonly sig: string;
    readonly keyEpoch: number;
}
/**
 * 回复来源。远程通道必须填，且必须与订阅它的通道一致。
 *
 * 缺省表示「本机回环」：只有 local-loopback 可以不带。
 * 网关对带 sender 的回复一律走 authorizeReply，未配置就拒绝。
 */
export interface ReplySender {
    /** 来源通道 id，必须等于投递它的通道 */
    readonly channelId: string;
    /** 通道侧用户标识：OneBot 是 QQ 号，QQ 官方是 openid */
    readonly id: string;
    /** 会话类型；未知时不填，授权层按不可信处理 */
    readonly chatType?: 'private' | 'group';
}
export interface DecisionReply {
    readonly envelopeId: string;
    readonly action: DecisionAction;
    readonly answer?: string;
    readonly decidedAt: number;
    readonly sig: string;
    /** 回复者身份；缺省只允许本机回环通道 */
    readonly sender?: ReplySender;
}
export interface ChannelCapabilities {
    readonly approval: boolean;
    readonly question: boolean;
    readonly richCard: boolean;
    readonly memorySync: boolean;
}
export interface ChannelSendResult {
    readonly messageId: string;
    /** 发送没有真正完成、已进入待发队列；调用方不应把它当成已送达。 */
    readonly queued?: boolean;
}
export type ChannelId = 'local-loopback' | 'qq' | 'wechat' | 'webhook';
export declare const CHANNEL_IDS: readonly ChannelId[];
export interface IChannelAdapter {
    readonly id: string;
    capabilities(): ChannelCapabilities;
    send(envelope: DecisionEnvelope): Promise<ChannelSendResult>;
    /** 返回取消订阅函数 */
    onReply(handler: (reply: DecisionReply) => void): () => void;
    /** 「未配置」用 ⚠️，「连通失败」用 ❌，诊断据 ok/code 区分 */
    health(): Promise<DiagResult>;
}
/** 超时策略：到点回退本地弹窗，或直接拒绝。 */
export type TimeoutPolicy = 'fallback-local' | 'block';
export interface DecisionGatewayOptions {
    readonly timeoutMs: number;
    readonly timeoutPolicy: TimeoutPolicy;
    /** 同一 envelope 重发上限，配合 nonce 去重 */
    readonly maxRetries: number;
}
