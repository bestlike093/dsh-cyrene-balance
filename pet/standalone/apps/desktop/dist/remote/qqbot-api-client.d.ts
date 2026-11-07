export interface QqBotTokenProviderConfig {
    readonly appId: string;
    readonly clientSecret: string;
}
/** 可注入的 fetch（测试用）。签名与全局 fetch 一致。 */
export type QqBotFetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface QqBotSendTarget {
    /** private: 用户 openid；group: 群 openid */
    readonly openid: string;
    readonly chatType: 'private' | 'group';
}
export interface QqBotSendOptions {
    /** 被动回复必须携带的入站消息 id */
    readonly msgId: string;
    /** 同一 msg_id 的第几次回复（1 起，单聊上限 4 / 群上限 5） */
    readonly msgSeq: number;
}
/** 待上传的图片字节；contentType 只用于调用方判断，协议本身只认图片。 */
export interface QqBotImagePayload {
    readonly contentType: string;
    readonly bytes: Uint8Array;
}
export declare class QqBotApiError extends Error {
    readonly status: number;
    readonly code?: unknown | undefined;
    constructor(message: string, status: number, code?: unknown | undefined);
}
export declare class QqBotApiClient {
    private readonly config;
    private readonly fetchFn;
    private token;
    private tokenExpiresAt;
    private tokenPromise;
    constructor(config: QqBotTokenProviderConfig, fetchFn?: QqBotFetch);
    /** 拿一个有效 token（过期前 5 分钟自动刷新；并发调用共享同一次刷新）。 */
    getAccessToken(): Promise<string>;
    private refreshToken;
    /** 查询 WebSocket 网关地址。 */
    getGatewayUrl(): Promise<string>;
    /**
     * 被动回复一张图片：先上传富媒体拿 file_info，再发 msg_type 7。
     * 图片上限 5MB（腾讯限制），调用方应先自行检查；这里只负责协议。
     */
    sendImage(target: QqBotSendTarget, image: QqBotImagePayload, options: QqBotSendOptions): Promise<void>;
    /**
     * 被动回复一条文本消息。
     * msg_type 0 = 文本。富媒体需先走富媒体上传接口，当前版本只发文本。
     */
    sendText(target: QqBotSendTarget, content: string, options: QqBotSendOptions): Promise<void>;
    private request;
}
