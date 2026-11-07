import type { WebSocketClient } from './websocket-client.js';
export interface OneBotMessageSegment {
    readonly type: string;
    readonly data?: Record<string, unknown>;
}
/** 协议端推来的一条聊天消息，已经剥掉协议细节。 */
export interface OneBotInbound {
    readonly chatType: 'private' | 'group';
    /** 投递地址：私聊为对方 QQ 号，群为群号 */
    readonly peerId: string;
    readonly userId: string;
    readonly nickname: string;
    readonly content: string;
    /** 群里是否明确 @ 了机器人；私聊恒为 true。 */
    readonly mentioned: boolean;
    readonly messageId: string;
    readonly images: readonly {
        readonly url: string;
        readonly file: string;
    }[];
}
export interface OneBotClientOptions {
    /** 协议端地址，例如 ws://127.0.0.1:3001 */
    readonly url: string;
    readonly accessToken?: string;
    /** 机器人自己的 QQ 号；用于过滤自己发的消息与识别 @。 */
    readonly selfId?: string;
    readonly onMessage?: (message: OneBotInbound) => void;
    /** 连接可用性变化；宿主据此在设置页显示状态。 */
    readonly onReadyChange?: (ready: boolean) => void;
    readonly onError?: (error: Error) => void;
    readonly onLog?: (message: string) => void;
    readonly maxBackoffMs?: number;
    readonly requestTimeoutMs?: number;
    /** 测试注入 WebSocket 构造器 */
    readonly websocketFactory?: (url: string) => WebSocketClient;
}
/**
 * 正向 WebSocket：由本机主动连到 NapCat。
 * 断线后按 1s → 60s 退避重连；停止后不再重连。
 */
export declare class OneBotClient {
    private readonly options;
    private ws;
    private stopped;
    private ready;
    private backoffMs;
    private echoSeq;
    private lastError;
    private readonly pending;
    /** 每次 connect 递增；旧 socket 的迟到回调不能影响新一代连接。 */
    private generation;
    constructor(options: OneBotClientOptions);
    get isReady(): boolean;
    getLastError(): Error | null;
    start(): Promise<void>;
    stop(): Promise<void>;
    /** 主动发私聊；返回是否确认送达协议端。 */
    sendPrivate(userId: string, text: string): Promise<boolean>;
    /** 主动发群消息；返回是否确认送达协议端。 */
    sendGroup(groupId: string, text: string): Promise<boolean>;
    /**
     * 让 QQ 显示「正在输入」。NapCat 扩展接口，非标准 OneBot；不支持时静默失败。
     * event_type: 1 = 正在输入，0 = 取消。
     */
    setInputStatus(userId: string, typing: boolean): Promise<boolean>;
    private sendText;
    private connect;
    private buildUrl;
    private waitOpen;
    private markDisconnected;
    private scheduleReconnect;
    private handleFailure;
    private handleRaw;
    private settle;
    private handleEvent;
    private call;
    private failPending;
    private log;
}
