import type { ChannelCapabilities, ChannelSendResult, DecisionEnvelope, DecisionReply, DiagResult, IChannelAdapter } from '@pet/shared';
export interface QqTarget {
    readonly kind: 'c2c' | 'group';
    readonly openId: string;
}
export interface QqChannelOptions {
    readonly appId: string;
    readonly clientSecret: string;
    /** 开放平台配置的 Ed25519 公钥，hex（32 字节） */
    readonly publicKey?: string;
    readonly target?: QqTarget;
    /**
     * 允许拍板的主人 openid。
     * 与投递目标 `target.openId` 分开：发到哪里和谁能拍板是两件事。
     * 为空时任何远程消息都不会转成 DecisionReply（fail-closed）。
     */
    readonly ownerOpenIds?: readonly string[];
    readonly apiBase?: string;
    readonly tokenUrl?: string;
    readonly fetchImpl?: typeof fetch;
    readonly now?: () => number;
}
type HeadersLike = Record<string, string | string[] | undefined>;
/**
 * QQ 官方机器人通道（v2）。
 * 只走官方 API；未配置凭据时 health 明确返回 CHANNEL_NOT_CONFIGURED。
 */
export declare class QqOfficialChannel implements IChannelAdapter {
    readonly id = "qq";
    private readonly appId;
    private readonly clientSecret;
    private readonly publicKey;
    private readonly target;
    private readonly owners;
    private readonly apiBase;
    private readonly tokenUrl;
    private readonly fetchImpl;
    private readonly now;
    private readonly handlers;
    private token;
    constructor(options: QqChannelOptions);
    capabilities(): ChannelCapabilities;
    onReply(handler: (reply: DecisionReply) => void): () => void;
    send(envelope: DecisionEnvelope): Promise<ChannelSendResult>;
    health(): Promise<DiagResult>;
    /**
     * 处理 QQ webhook。
     * op 13 返回验证签名；消息事件解析 `allow|deny|answer <id>` 并触发回复。
     */
    handleWebhook(rawBody: string, headers: HeadersLike): Promise<Record<string, unknown>>;
    /** 供测试与诊断：不联网也能验证签名。 */
    verifySignature(timestamp: string, rawBody: string, signatureHex: string): boolean;
    signPayload(data: string): string;
    private parseCommand;
    private accessToken;
}
export {};
