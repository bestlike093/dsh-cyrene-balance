import { WebSocketClient } from './websocket-client.js';
/** 单聊 + 群聊（含群 @）事件 */
export declare const QQBOT_INTENT_GROUP_AND_C2C: number;
export type QqBotEventType = 'C2C_MESSAGE_CREATE' | 'GROUP_AT_MESSAGE_CREATE' | 'GROUP_MESSAGE_CREATE'
/** 机器人被拉进群 / 被移出群：只用来解释「群里为什么突然收不到消息」。 */
 | 'GROUP_ADD_ROBOT' | 'GROUP_DEL_ROBOT' | 'READY' | 'RESUMED';
export interface QqBotWsEvents {
    onDispatch: (type: QqBotEventType, data: Record<string, unknown>) => void;
    /** 连接状态变化（true = 已通过鉴权收到 READY/RESUMED） */
    onReadyChange: (ready: boolean) => void;
    onError: (error: Error) => void;
}
export interface QqBotWsClientOptions extends QqBotWsEvents {
    /** 网关地址（wss://api.sgroup.qq.com/websocket） */
    readonly gatewayUrl: string;
    /** 返回有效 access_token（过期自动刷新由 ApiClient 负责） */
    readonly getAccessToken: () => Promise<string>;
    /** 只订阅的事件集合，默认单聊 + 群 @ */
    readonly intents?: number;
    /** 重连退避上限（ms），测试可调小 */
    readonly maxBackoffMs?: number;
    /** 测试注入 WebSocket 构造器 */
    readonly websocketFactory?: (url: string) => WebSocketClient;
}
export declare class QqBotWsClient {
    private readonly options;
    private ws;
    private heartbeatTimer;
    private reconnectTimer;
    private stopped;
    private seq;
    private sessionId;
    private ready;
    private backoffMs;
    private heartbeatAcked;
    /** 连续多少个心跳周期没有 ACK；容忍一次网络抖动，连续两次才判定假死。 */
    private heartbeatMisses;
    private lastError;
    /**
     * 每次 connect 递增。旧 socket 的 close/error 回调晚到时，
     * 只能处理自己那一代，不能把新连接的心跳和重连计划一起清掉。
     */
    private generation;
    constructor(options: QqBotWsClientOptions);
    get isReady(): boolean;
    getLastError(): Error | null;
    start(): Promise<void>;
    stop(): Promise<void>;
    private connect;
    private handlePayload;
    private sendIdentify;
    /**
     * 放弃当前 socket，重新取 token 再连。
     *
     * op 9（Invalid Session）和 token 过期都需要这条路径：旧 socket 上补发 Identify
     * 只会拿同一个失效 token 再被拒一次，表现为「刚连上就断」的循环。
     */
    private restart;
    private startHeartbeat;
    private send;
    private scheduleReconnect;
    private clearHeartbeat;
    private clearTimers;
    private setReady;
}
