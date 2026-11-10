import type { ChannelCapabilities, ChannelSendResult, DecisionAction, DecisionEnvelope, DecisionReply, DiagResult, IChannelAdapter } from '@pet/shared';
/** 本地回环：不联网，用于桌面弹窗与端到端测试。 */
export declare class LocalLoopbackChannel implements IChannelAdapter {
    readonly id = "local-loopback";
    private readonly handlers;
    private readonly sent;
    private readonly now;
    constructor(now?: () => number);
    capabilities(): ChannelCapabilities;
    send(envelope: DecisionEnvelope): Promise<ChannelSendResult>;
    onReply(handler: (reply: DecisionReply) => void): () => void;
    /** 测试或本地 UI 用：模拟用户按下按钮。 */
    reply(envelopeId: string, action: DecisionAction, answer?: string): void;
    get sentCount(): number;
    lastSent(): DecisionEnvelope | undefined;
    health(): Promise<DiagResult>;
}
