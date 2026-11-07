import type { ChannelCapabilities, ChannelSendResult, DecisionEnvelope, DecisionReply, DiagResult, IChannelAdapter } from '@pet/shared';
import type { WebSocketClient } from './websocket-client.js';
import type { QqBotImagePayload, QqBotSendOptions, QqBotSendTarget } from './qqbot-api-client.js';
export interface QqGatewayApi {
    getAccessToken: () => Promise<string>;
    getGatewayUrl: () => Promise<string>;
    sendText: (target: QqBotSendTarget, content: string, options: QqBotSendOptions) => Promise<void>;
    /** 可选：发图能力。测试桩不实现时，replyImage 直接回 false。 */
    sendImage?: (target: QqBotSendTarget, image: QqBotImagePayload, options: QqBotSendOptions) => Promise<void>;
}
/** 一条入站消息的发送者信息；观察模式靠它把 openid 交给宿主。 */
export interface QqGatewayInbound {
    readonly chatType: 'private' | 'group';
    /** 投递地址：C2C 为用户 openid，群为 group_openid */
    readonly openId: string;
    readonly senderOpenId: string;
    /**
     * 可选原文：只有需要判断「这句话是不是在叫我」时才带。
     * 只存在内存里，不落盘、不写日志；图片消息为空串。
     */
    readonly content?: string;
    readonly msgId?: string;
    /** 群里的 @ 消息：平台只会在明确叫到机器人时推这个事件。 */
    readonly mentioned?: boolean;
    /** 发送者是否在主人名单里；宿主据此区分主人的私聊和群里的任何人。 */
    readonly isOwner?: boolean;
}
/** QQ 消息里的一张图片；URL 有效期很短，宿主拿到后要立刻下载。 */
export interface QqGatewayImage {
    readonly url: string;
    readonly contentType: string;
    readonly filename: string;
    readonly size: number;
}
/** 主人发来的一条普通消息；宿主用它走聊天回复，不参与拍板解析。 */
export interface QqGatewayMessage extends QqGatewayInbound {
    readonly content: string;
    readonly msgId: string;
    readonly images: readonly QqGatewayImage[];
}
/** 只留在内存里的近期消息，用来学一群人的说话方式；不落盘、不外传。 */
export interface QqObservedMessage {
    readonly speaker: string;
    readonly text: string;
    readonly at: number;
    /** 这条是否明确 @ 了机器人（平台只把这类群消息推成 GROUP_AT_MESSAGE_CREATE）。 */
    readonly mentioned?: boolean;
    /** 图片 / 表情包数量，只用来估计表情包使用率。 */
    readonly imageCount?: number;
}
/**
 * 群生命周期事件：机器人被拉进群、被移出群。
 *
 * 消息突然收不到时，靠这一条区分「平台没推」和「人已经不在群里」。
 * 只用于诊断，不参与权限判断。
 */
export interface QqGroupLifecycle {
    readonly type: 'GROUP_ADD_ROBOT' | 'GROUP_DEL_ROBOT';
    readonly groupOpenId: string;
    /** 拉人 / 踢人的群成员；平台不提供时为空串。 */
    readonly operatorOpenId: string;
    readonly at: number;
}
export interface QqGatewayChannelOptions {
    readonly appId: string;
    readonly clientSecret: string;
    /** 允许拍板的主人 openid；空集合时任何消息都不会变成 DecisionReply。 */
    readonly ownerOpenIds?: readonly string[];
    /** 可选投递目标；空串/未设置时回复最近一次入站会话。 */
    readonly targetOpenId?: string;
    readonly api?: QqGatewayApi;
    readonly gatewayUrl?: string;
    readonly websocketFactory?: (url: string) => WebSocketClient;
    readonly maxBackoffMs?: number;
    readonly now?: () => number;
    readonly onLog?: (message: string) => void;
    /** 连接层的最后一次错误，交给宿主展示；重连成功后会由 onReadyChange 清掉。 */
    readonly onError?: (error: Error) => void;
    /**
     * 每条入站消息都会回调一次，且不受主人名单限制。
     * 观察模式靠它把发送者 openid 交回宿主，让用户在设置页一键绑定。
     */
    readonly onInbound?: (info: QqGatewayInbound) => void;
    /**
     * 主人发来的普通文本。与 onInbound 分开：onInbound 只负责观察与绑定，
     * onMessage 才允许宿主生成回复，避免把任何陌生人都接进聊天链路。
     */
    readonly onMessage?: (info: QqGatewayMessage) => void;
    /** 机器人进群 / 退群时回调一次，用来把「突然收不到群消息」的原因留进日志。 */
    readonly onSystemEvent?: (event: QqGroupLifecycle) => void;
}
export declare class QqGatewayChannel implements IChannelAdapter {
    private readonly options;
    readonly id = "qq";
    private readonly owners;
    private readonly api;
    private readonly now;
    private readonly log;
    private readonly handlers;
    private readonly readyHandlers;
    private readonly sessions;
    private readonly pending;
    /** 每个会话最近若干条文本，只用于统计语气和找重复出现的说法。 */
    private readonly observed;
    /** 200 条样本：活跃群一天就能刷满，样本太少画像会抖。 */
    private static readonly OBSERVED_LIMIT;
    private ws;
    private started;
    private lastInboundKey;
    private lastError;
    private ready;
    constructor(options: QqGatewayChannelOptions);
    capabilities(): ChannelCapabilities;
    /**
     * 最近几条消息，只给「这群人怎么说话」做统计。
     * 只存在内存里，重启就清空；调用方不该把它写进记忆或日志。
     */
    recentMessages(key: string, limit?: number): readonly QqObservedMessage[];
    /** 记一条观察样本；超出上限时丢最旧的。 */
    private observe;
    onReply(handler: (reply: DecisionReply) => void): () => void;
    /** 订阅连接就绪状态；只在状态真正变化时触发。 */
    onReadyChange(handler: (ready: boolean) => void): () => void;
    get isReady(): boolean;
    /** 建立网关连接；重复调用不会叠第二条。 */
    start(): Promise<void>;
    stop(): Promise<void>;
    send(envelope: DecisionEnvelope): Promise<ChannelSendResult>;
    /**
     * 用当前被动回复窗口发一条普通文本。
     * 只对已有入站会话有效；窗口过期或次数用尽时返回 false，不排队。
     */
    replyText(chatType: 'private' | 'group', openId: string, content: string): Promise<boolean>;
    /**
     * 用当前被动回复窗口发一张图片。
     * 失败原因会写日志并回 false；调用方据此给用户一句人话。
     */
    replyImage(contentType: string, bytes: Uint8Array): Promise<boolean>;
    health(): Promise<DiagResult>;
    /** 供诊断与测试：当前排队的卡片数量。 */
    pendingCount(): number;
    private handleDispatch;
    private upsertSession;
    private resolveSession;
    private fallbackQueueKey;
    private windowMs;
    private maxReplies;
    private canReply;
    private deliver;
    private flush;
    private parseCommand;
}
