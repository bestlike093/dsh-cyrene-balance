import { WebSocketClient as Socket } from './websocket-client.js';
const DEFAULT_MAX_BACKOFF_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function idOf(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (typeof value === 'string')
        return value.trim();
    return '';
}
/** 消息段既可能是数组（标准格式），也可能是一段纯文本（string 格式）。 */
function segmentsOf(message) {
    if (typeof message === 'string') {
        return message === '' ? [] : [{ type: 'text', data: { text: message } }];
    }
    if (!Array.isArray(message))
        return [];
    const segments = [];
    for (const item of message) {
        if (!isRecord(item))
            continue;
        const type = typeof item.type === 'string' ? item.type : '';
        if (type === '')
            continue;
        const data = isRecord(item.data) ? item.data : undefined;
        segments.push(data === undefined ? { type } : { type, data });
    }
    return segments;
}
function textOf(segments) {
    let text = '';
    for (const segment of segments) {
        if (segment.type !== 'text')
            continue;
        const value = segment.data?.text;
        if (typeof value === 'string')
            text += value;
    }
    return text.trim();
}
function imagesOf(segments) {
    const images = [];
    for (const segment of segments) {
        if (segment.type !== 'image')
            continue;
        const url = segment.data?.url;
        const file = segment.data?.file;
        images.push({
            url: typeof url === 'string' ? url : '',
            file: typeof file === 'string' ? file : ''
        });
    }
    return images;
}
function atSelf(segments, selfId) {
    if (selfId === '')
        return false;
    for (const segment of segments) {
        if (segment.type !== 'at')
            continue;
        if (idOf(segment.data?.qq) === selfId)
            return true;
    }
    return false;
}
/**
 * 正向 WebSocket：由本机主动连到 NapCat。
 * 断线后按 1s → 60s 退避重连；停止后不再重连。
 */
export class OneBotClient {
    options;
    ws = null;
    stopped = false;
    ready = false;
    backoffMs = 1_000;
    echoSeq = 0;
    lastError = null;
    pending = new Map();
    /** 每次 connect 递增；旧 socket 的迟到回调不能影响新一代连接。 */
    generation = 0;
    constructor(options) {
        this.options = options;
    }
    get isReady() {
        return this.ready;
    }
    getLastError() {
        return this.lastError;
    }
    async start() {
        this.stopped = false;
        await this.connect();
    }
    async stop() {
        this.stopped = true;
        this.ready = false;
        this.options.onReadyChange?.(false);
        this.failPending(new Error('OneBot 客户端已停止'));
        const ws = this.ws;
        this.ws = null;
        if (ws !== null)
            ws.close();
    }
    /** 主动发私聊；返回是否确认送达协议端。 */
    async sendPrivate(userId, text) {
        return this.sendText('private', userId, text);
    }
    /** 主动发群消息；返回是否确认送达协议端。 */
    async sendGroup(groupId, text) {
        return this.sendText('group', groupId, text);
    }
    /**
     * 让 QQ 显示「正在输入」。NapCat 扩展接口，非标准 OneBot；不支持时静默失败。
     * event_type: 1 = 正在输入，0 = 取消。
     */
    async setInputStatus(userId, typing) {
        if (this.options.selfId === undefined || this.options.selfId === '')
            return false;
        try {
            await this.call('set_input_status', {
                user_id: userId,
                event_type: typing ? 1 : 0
            });
            return true;
        }
        catch {
            return false;
        }
    }
    async sendText(chatType, peerId, content) {
        const text = content.trim();
        if (text === '' || peerId === '')
            return false;
        try {
            await this.call(chatType === 'private' ? 'send_private_msg' : 'send_group_msg', {
                [chatType === 'private' ? 'user_id' : 'group_id']: peerId,
                message: text
            });
            return true;
        }
        catch (error) {
            this.log(`[onebot] ${chatType === 'private' ? '私聊' : '群'}消息发送失败：${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    async connect() {
        if (this.stopped)
            return;
        const generation = this.generation + 1;
        this.generation = generation;
        const factory = this.options.websocketFactory ?? ((url) => new Socket(url));
        let ws;
        try {
            ws = factory(this.buildUrl());
        }
        catch (error) {
            this.handleFailure(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        this.ws = ws;
        ws.on('message', (raw) => {
            if (generation !== this.generation)
                return;
            this.handleRaw(raw);
        });
        ws.on('error', (error) => {
            if (generation !== this.generation)
                return;
            this.handleFailure(error);
        });
        ws.on('close', () => {
            if (generation !== this.generation)
                return;
            this.markDisconnected();
            this.scheduleReconnect();
        });
        // WebSocketClient 构造即开始握手；等它进入 OPEN 再宣告可用。
        try {
            await this.waitOpen(generation);
            if (generation !== this.generation || this.stopped)
                return;
            this.ready = true;
            this.backoffMs = 1_000;
            this.lastError = null;
            this.options.onReadyChange?.(true);
            this.log('[onebot] 已连接');
        }
        catch (error) {
            this.handleFailure(error instanceof Error ? error : new Error(String(error)));
        }
    }
    buildUrl() {
        const token = this.options.accessToken?.trim() ?? '';
        if (token === '')
            return this.options.url;
        const separator = this.options.url.includes('?') ? '&' : '?';
        return `${this.options.url}${separator}access_token=${encodeURIComponent(token)}`;
    }
    waitOpen(generation) {
        const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        const deadline = Date.now() + timeoutMs;
        return new Promise((resolve, reject) => {
            const tick = () => {
                if (generation !== this.generation) {
                    reject(new Error('OneBot 连接已被新的连接取代'));
                    return;
                }
                const ws = this.ws;
                if (ws === null) {
                    reject(new Error('OneBot WebSocket 已断开'));
                    return;
                }
                if (ws.readyState === Socket.OPEN) {
                    resolve();
                    return;
                }
                if (ws.readyState === Socket.CLOSED) {
                    reject(new Error('OneBot WebSocket 连接失败'));
                    return;
                }
                if (Date.now() > deadline) {
                    reject(new Error('OneBot WebSocket 连接超时'));
                    return;
                }
                setTimeout(tick, 50);
            };
            tick();
        });
    }
    markDisconnected() {
        if (!this.ready)
            return;
        this.ready = false;
        this.options.onReadyChange?.(false);
    }
    scheduleReconnect() {
        if (this.stopped)
            return;
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, this.options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS);
        this.log(`[onebot] 连接断开，${delay}ms 后重连`);
        setTimeout(() => {
            if (this.stopped)
                return;
            void this.connect();
        }, delay);
    }
    handleFailure(error) {
        this.lastError = error;
        this.options.onError?.(error);
        this.log(`[onebot] ${error.message}`);
        this.markDisconnected();
        const ws = this.ws;
        this.ws = null;
        if (ws !== null)
            ws.close();
        this.scheduleReconnect();
    }
    handleRaw(raw) {
        let payload;
        try {
            payload = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (!isRecord(payload))
            return;
        // 先处理 API 回包，再处理事件；回包里也可能带 post_type，但 echo 优先。
        const echo = payload.echo;
        if (echo !== undefined && echo !== null) {
            this.settle(String(echo), payload);
            return;
        }
        this.handleEvent(payload);
    }
    settle(echo, response) {
        const pending = this.pending.get(echo);
        if (pending === undefined)
            return;
        this.pending.delete(echo);
        clearTimeout(pending.timer);
        if (response.status === 'failed' || (typeof response.retcode === 'number' && response.retcode !== 0)) {
            const reason = response.wording ?? response.msg ?? `retcode=${response.retcode ?? 'unknown'}`;
            pending.reject(new Error(`OneBot API 返回失败：${reason}`));
            return;
        }
        pending.resolve(response.data);
    }
    handleEvent(event) {
        if (event.post_type !== 'message')
            return;
        const selfId = this.options.selfId ?? idOf(event.self_id);
        const segments = segmentsOf(event.message);
        const content = textOf(segments) || (event.raw_message ?? '');
        const images = imagesOf(segments);
        const userId = idOf(event.user_id);
        if (event.message_type === 'private') {
            if (userId === '' || userId === selfId)
                return;
            this.options.onMessage?.({
                chatType: 'private',
                peerId: userId,
                userId,
                nickname: event.sender?.nickname ?? '',
                content,
                mentioned: true,
                messageId: idOf(event.message_id),
                images
            });
            return;
        }
        if (event.message_type === 'group') {
            const groupId = idOf(event.group_id);
            if (groupId === '' || userId === '')
                return;
            // 自己说的话不回流，避免自问自答。
            if (userId === selfId)
                return;
            this.options.onMessage?.({
                chatType: 'group',
                peerId: groupId,
                userId,
                nickname: event.sender?.card ?? event.sender?.nickname ?? '',
                content,
                mentioned: atSelf(segments, selfId),
                messageId: idOf(event.message_id),
                images
            });
        }
    }
    async call(action, params) {
        await this.waitOpen(this.generation);
        const ws = this.ws;
        if (ws === null || ws.readyState !== Socket.OPEN) {
            throw new Error('OneBot 未连接');
        }
        const echo = String((this.echoSeq += 1));
        const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(echo);
                reject(new Error(`OneBot API 超时：${action}`));
            }, timeoutMs);
            this.pending.set(echo, { resolve, reject, timer });
            ws.send(JSON.stringify({ action, params, echo }));
        });
    }
    failPending(error) {
        for (const [echo, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(echo);
        }
    }
    log(message) {
        this.options.onLog?.(message);
    }
}
