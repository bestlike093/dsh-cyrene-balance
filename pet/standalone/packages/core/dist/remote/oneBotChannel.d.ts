import type { ChannelCapabilities, ChannelSendResult, DecisionEnvelope, DecisionReply, DiagResult, IChannelAdapter } from '@pet/shared';
/**
 * OneBot 11 最小 socket 面。
 * 只用可注入的四个成员，测试时不需要真连网。
 */
export interface OneBotSocket {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: 'open' | 'message' | 'close' | 'error', handler: (event: unknown) => void): void;
}
export interface OneBotChannelOptions {
    /** 协议端 WS 服务地址，例如 ws://127.0.0.1:3001 */
    readonly url: string;
    /** 投递目标：群或私聊 */
    readonly target: {
        readonly type: 'group' | 'private';
        readonly id: string;
    };
    readonly accessToken?: string;
    /** 通道标识，默认 qq */
    readonly id?: string;
    readonly now?: () => number;
    readonly reconnectMs?: number;
    readonly requestTimeoutMs?: number;
    /** 注入点，缺省用全局 WebSocket */
    readonly socketFactory?: (url: string) => OneBotSocket;
}
/**
 * OneBot 11 通道：把决策信封投递到 QQ，并把回复收回。
 *
 * 形态：本机做 WebSocket 客户端，连协议端开放的 WS 服务端口。
 * 协议端只管收发消息，不参与决策。
 */
export declare class OneBotChannel implements IChannelAdapter {
    readonly id: string;
    private readonly url;
    private readonly target;
    private readonly accessToken;
    private readonly now;
    private readonly reconnectMs;
    private readonly requestTimeoutMs;
    private readonly socketFactory;
    private readonly handlers;
    /** message_id → envelopeId，回复靠引用反查 */
    private readonly messageIndex;
    private readonly pending;
    private socket;
    private reconnectTimer;
    private disposed;
    private lastError;
    private echoSeq;
    constructor(options: OneBotChannelOptions);
    capabilities(): ChannelCapabilities;
    /** 建立连接；重复调用是幂等的。 */
    connect(): void;
    send(envelope: DecisionEnvelope): Promise<ChannelSendResult>;
    onReply(handler: (reply: DecisionReply) => void): () => void;
    health(): Promise<DiagResult>;
    dispose(): void;
    /** 投递正文：只带摘要，原文不出本机。 */
    private render;
    private nextEcho;
    private request;
    private handleFrame;
    private handleMessage;
    private scheduleReconnect;
    private rejectAll;
}
