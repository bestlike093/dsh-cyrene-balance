// QQ 官方机器人（QQ 开放平台 API v2）REST 客户端。
//
// 职责：
//   1) access_token 生命周期管理（getAppAccessToken + 过期前刷新 + 并发去重）
//   2) 被动回复消息发送（/v2/users/{openid}/messages 与 /v2/groups/{group_openid}/messages）
//   3) 网关地址查询（GET /gateway）
//
// 协议要点（官方文档 bot.q.qq.com/wiki api-v2）：
//   - token 端点：POST https://bots.qq.com/app/getAppAccessToken {appId, clientSecret}
//     → {access_token, expires_in}（秒，一般 7200）。无需 Basic Auth。
//   - 业务 API base：https://api.sgroup.qq.com，鉴权头 `Authorization: QQBot <token>`。
//   - 2025-04-21 后官方不再提供主动推送，所有发送都必须携带 msg_id（被动回复）。
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const API_BASE = 'https://api.sgroup.qq.com';
/** token 过期前 5 分钟刷新，避免边界抖动 */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
export class QqBotApiError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'QqBotApiError';
    }
}
export class QqBotApiClient {
    config;
    fetchFn;
    token = '';
    tokenExpiresAt = 0;
    tokenPromise = null;
    constructor(config, fetchFn = (url, init) => fetch(url, init)) {
        this.config = config;
        this.fetchFn = fetchFn;
    }
    /** 拿一个有效 token（过期前 5 分钟自动刷新；并发调用共享同一次刷新）。 */
    async getAccessToken() {
        const now = Date.now();
        if (this.token !== '' && now < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
            return this.token;
        }
        if (this.tokenPromise === null) {
            this.tokenPromise = this.refreshToken().finally(() => {
                this.tokenPromise = null;
            });
        }
        return this.tokenPromise;
    }
    async refreshToken() {
        const res = await this.fetchFn(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appId: this.config.appId,
                clientSecret: this.config.clientSecret
            })
        });
        if (!res.ok) {
            throw new QqBotApiError(`获取 access_token 失败 (HTTP ${res.status})`, res.status);
        }
        const data = (await res.json());
        if (data.access_token === undefined || data.access_token === '') {
            throw new QqBotApiError('access_token 响应缺少 access_token', 200);
        }
        const expiresInSec = Number(data.expires_in ?? 7200);
        this.token = data.access_token;
        this.tokenExpiresAt =
            Date.now() + (Number.isFinite(expiresInSec) ? expiresInSec : 7200) * 1000;
        return this.token;
    }
    /** 查询 WebSocket 网关地址。 */
    async getGatewayUrl() {
        const data = await this.request('/gateway');
        if (data.url === undefined || data.url === '') {
            throw new QqBotApiError('gateway 响应缺少 url', 200);
        }
        return data.url;
    }
    /**
     * 被动回复一张图片：先上传富媒体拿 file_info，再发 msg_type 7。
     * 图片上限 5MB（腾讯限制），调用方应先自行检查；这里只负责协议。
     */
    async sendImage(target, image, options) {
        const filesPath = target.chatType === 'group'
            ? `/v2/groups/${encodeURIComponent(target.openid)}/files`
            : `/v2/users/${encodeURIComponent(target.openid)}/files`;
        const uploaded = await this.request(filesPath, {
            method: 'POST',
            body: JSON.stringify({
                file_type: 1,
                // 官方接口接受 base64 的 file_data；不依赖图片有公网地址。
                file_data: Buffer.from(image.bytes).toString('base64'),
                srv_send_msg: false
            })
        });
        if (uploaded.file_info === undefined || uploaded.file_info === '') {
            throw new QqBotApiError('富媒体上传响应缺少 file_info', 200);
        }
        const messagesPath = target.chatType === 'group'
            ? `/v2/groups/${encodeURIComponent(target.openid)}/messages`
            : `/v2/users/${encodeURIComponent(target.openid)}/messages`;
        await this.request(messagesPath, {
            method: 'POST',
            body: JSON.stringify({
                msg_type: 7,
                media: { file_info: uploaded.file_info },
                content: '',
                msg_id: options.msgId,
                msg_seq: options.msgSeq
            })
        });
    }
    /**
     * 被动回复一条文本消息。
     * msg_type 0 = 文本。富媒体需先走富媒体上传接口，当前版本只发文本。
     */
    async sendText(target, content, options) {
        const path = target.chatType === 'group'
            ? `/v2/groups/${encodeURIComponent(target.openid)}/messages`
            : `/v2/users/${encodeURIComponent(target.openid)}/messages`;
        await this.request(path, {
            method: 'POST',
            body: JSON.stringify({
                msg_type: 0,
                content,
                msg_id: options.msgId,
                msg_seq: options.msgSeq
            })
        });
    }
    async request(path, init) {
        const token = await this.getAccessToken();
        const res = await this.fetchFn(`${API_BASE}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `QQBot ${token}`,
                ...(init?.headers ?? {})
            }
        });
        if (!res.ok) {
            let detail = '';
            try {
                const body = (await res.json());
                detail =
                    body.message !== undefined
                        ? ` ${String(body.message)} (code ${String(body.code)})`
                        : '';
            }
            catch {
                // 非 JSON 错误体，忽略
            }
            throw new QqBotApiError(`QQ Bot API ${path} 失败 (HTTP ${res.status})${detail}`, res.status);
        }
        // 204 / 空 body 场景
        const text = await res.text();
        return (text !== '' ? JSON.parse(text) : {});
    }
}
