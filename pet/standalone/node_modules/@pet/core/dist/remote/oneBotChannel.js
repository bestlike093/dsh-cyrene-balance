import { ErrorCode, PetError } from '@pet/shared';
const SOCKET_OPEN = 1;
const DEFAULT_RECONNECT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_ID = 'qq';
function defaultSocketFactory(url) {
    const ctor = globalThis.WebSocket;
    if (ctor === undefined) {
        throw new PetError(ErrorCode.CHANNEL_NOT_CONFIGURED, '当前运行时没有内置 WebSocket');
    }
    return new ctor(url);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function segmentsOf(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        if (!isRecord(item))
            continue;
        const type = item['type'];
        if (typeof type !== 'string')
            continue;
        const data = item['data'];
        out.push({ type, data: isRecord(data) ? data : undefined });
    }
    return out;
}
function segmentText(segments) {
    let text = '';
    for (const segment of segments) {
        if (segment.type !== 'text')
            continue;
        const value = segment.data?.['text'];
        if (typeof value === 'string')
            text += value;
    }
    return text;
}
/** 取引用消息的 message_id，用于把回复对回原信封。 */
function quotedMessageId(segments) {
    for (const segment of segments) {
        if (segment.type !== 'reply')
            continue;
        const value = segment.data?.['id'];
        if (typeof value === 'string' && value.length > 0)
            return value;
        if (typeof value === 'number')
            return String(value);
    }
    return undefined;
}
/** 文本首部的 #信封号，Second chance 给不引用直接回的场合。 */
function hashEnvelopeId(text) {
    const match = /^#([0-9a-z]{4,32})\b/i.exec(text.trim());
    return match?.[1];
}
function parseAction(text) {
    const normalized = text.trim();
    if (normalized.length === 0)
        return undefined;
    const head = normalized.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    const rest = normalized.slice(head.length).trim();
    if (head === 'allow' || head === 'y' || normalized === '同意')
        return { action: 'allow' };
    if (head === 'deny' || head === 'n' || normalized === '拒绝')
        return { action: 'deny' };
    if (head === 'dismiss' || normalized === '忽略')
        return { action: 'dismiss' };
    if (head === 'answer') {
        return rest.length === 0 ? undefined : { action: 'answer', answer: rest };
    }
    return undefined;
}
/**
 * OneBot 11 通道：把决策信封投递到 QQ，并把回复收回。
 *
 * 形态：本机做 WebSocket 客户端，连协议端开放的 WS 服务端口。
 * 协议端只管收发消息，不参与决策。
 */
export class OneBotChannel {
    id;
    url;
    target;
    accessToken;
    now;
    reconnectMs;
    requestTimeoutMs;
    socketFactory;
    handlers = new Set();
    /** message_id → envelopeId，回复靠引用反查 */
    messageIndex = new Map();
    pending = new Map();
    socket;
    reconnectTimer;
    disposed = false;
    lastError;
    echoSeq = 0;
    constructor(options) {
        if (typeof options.url !== 'string' || options.url.length === 0) {
            throw new PetError(ErrorCode.CHANNEL_NOT_CONFIGURED, 'OneBot 通道缺少 url');
        }
        if (options.target.id.length === 0) {
            throw new PetError(ErrorCode.CHANNEL_NOT_CONFIGURED, 'OneBot 通道缺少投递目标');
        }
        this.id = options.id ?? DEFAULT_ID;
        this.url = options.url;
        this.target = options.target;
        this.accessToken = options.accessToken;
        this.now = options.now ?? Date.now;
        this.reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    }
    capabilities() {
        return { approval: true, question: true, richCard: false, memorySync: false };
    }
    /** 建立连接；重复调用是幂等的。 */
    connect() {
        if (this.disposed || this.socket !== undefined)
            return;
        let socket;
        try {
            socket = this.socketFactory(this.url);
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;
        socket.addEventListener('open', () => {
            this.lastError = undefined;
        });
        socket.addEventListener('message', (event) => {
            this.handleFrame(event);
        });
        socket.addEventListener('close', () => {
            this.socket = undefined;
            this.rejectAll(new PetError(ErrorCode.CHANNEL_UNREACHABLE, 'OneBot 连接已断开'));
            this.scheduleReconnect();
        });
        socket.addEventListener('error', (event) => {
            this.lastError = event instanceof Error ? event.message : 'OneBot 连接异常';
        });
    }
    async send(envelope) {
        if (this.disposed) {
            throw new PetError(ErrorCode.NOT_SUPPORTED, 'OneBot 通道已释放');
        }
        this.connect();
        const socket = this.socket;
        if (socket === undefined || socket.readyState !== SOCKET_OPEN) {
            throw new PetError(ErrorCode.CHANNEL_UNREACHABLE, 'OneBot 通道未连通');
        }
        const action = this.target.type === 'group' ? 'send_group_msg' : 'send_private_msg';
        const idField = this.target.type === 'group' ? 'group_id' : 'user_id';
        const message = [{ type: 'text', data: { text: this.render(envelope) } }];
        const data = await this.request(socket, {
            action,
            params: { [idField]: this.target.id, message },
            echo: this.nextEcho()
        });
        const messageId = isRecord(data) && typeof data['message_id'] !== 'undefined'
            ? String(data['message_id'])
            : envelope.id;
        this.messageIndex.set(messageId, envelope.id);
        // 只留最近一批映射，避免长跑内存涨
        while (this.messageIndex.size > 128) {
            const oldest = this.messageIndex.keys().next();
            if (oldest.done === true)
                break;
            this.messageIndex.delete(oldest.value);
        }
        return { messageId };
    }
    onReply(handler) {
        this.handlers.add(handler);
        // 有人听回复就应该连上，否则消息永远进不来
        this.connect();
        return () => {
            this.handlers.delete(handler);
        };
    }
    async health() {
        if (this.url.length === 0) {
            return { ok: false, code: ErrorCode.CHANNEL_NOT_CONFIGURED, message: 'OneBot 通道未配置' };
        }
        this.connect();
        const socket = this.socket;
        if (socket !== undefined && socket.readyState === SOCKET_OPEN) {
            return { ok: true, message: 'OneBot 通道已连通', details: { url: this.url } };
        }
        return {
            ok: false,
            code: ErrorCode.CHANNEL_UNREACHABLE,
            message: this.lastError ?? 'OneBot 通道未连通',
            details: { url: this.url }
        };
    }
    dispose() {
        this.disposed = true;
        if (this.reconnectTimer !== undefined) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.socket?.close();
        this.socket = undefined;
        this.rejectAll(new PetError(ErrorCode.NOT_SUPPORTED, 'OneBot 通道已释放'));
        this.handlers.clear();
        this.messageIndex.clear();
    }
    /** 投递正文：只带摘要，原文不出本机。 */
    render(envelope) {
        const lines = [
            `【DSH 待决】${envelope.summary}`,
            `编号 #${envelope.id}`,
            '回复：allow / deny / answer <内容>'
        ];
        return lines.join('\n');
    }
    nextEcho() {
        this.echoSeq += 1;
        return `dsh-${this.echoSeq}`;
    }
    request(socket, payload) {
        const echo = String(payload['echo']);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(echo);
                reject(new PetError(ErrorCode.CHANNEL_UNREACHABLE, 'OneBot 请求超时'));
            }, this.requestTimeoutMs);
            this.pending.set(echo, { resolve, reject, timer });
            try {
                const frame = { ...payload };
                if (this.accessToken !== undefined)
                    frame['access_token'] = this.accessToken;
                socket.send(JSON.stringify(frame));
            }
            catch (error) {
                clearTimeout(timer);
                this.pending.delete(echo);
                reject(new PetError(ErrorCode.CHANNEL_UNREACHABLE, 'OneBot 发送失败'));
            }
        });
    }
    handleFrame(event) {
        const raw = isRecord(event) ? event['data'] : undefined;
        if (typeof raw !== 'string')
            return;
        let frame;
        try {
            frame = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (!isRecord(frame))
            return;
        const echo = frame['echo'];
        if (typeof echo === 'string') {
            const pending = this.pending.get(echo);
            if (pending !== undefined) {
                clearTimeout(pending.timer);
                this.pending.delete(echo);
                const retcode = frame['retcode'];
                if (typeof retcode === 'number' && retcode !== 0) {
                    pending.reject(new PetError(ErrorCode.CHANNEL_UNREACHABLE, `OneBot 返回 ${retcode}`));
                }
                else {
                    pending.resolve(frame['data']);
                }
                return;
            }
        }
        if (frame['post_type'] === 'message')
            this.handleMessage(frame);
    }
    handleMessage(frame) {
        // 没有 user_id 就无法确定回复者是谁，宁可丢弃，也不生成匿名回复。
        const rawUserId = frame['user_id'];
        if (typeof rawUserId !== 'string' && typeof rawUserId !== 'number')
            return;
        const userId = String(rawUserId).trim();
        if (userId.length === 0)
            return;
        const rawType = frame['message_type'];
        const chatType = rawType === 'private' || rawType === 'group' ? rawType : undefined;
        const segments = segmentsOf(frame['message']);
        const text = segmentText(segments);
        const quoted = quotedMessageId(segments);
        const envelopeId = (quoted === undefined ? undefined : this.messageIndex.get(quoted)) ?? hashEnvelopeId(text);
        if (envelopeId === undefined)
            return;
        const parsed = parseAction(text.replace(/^#[0-9a-z]{4,32}\s*/i, ''));
        if (parsed === undefined)
            return;
        const reply = {
            envelopeId,
            action: parsed.action,
            decidedAt: this.now(),
            sig: '',
            sender: {
                channelId: this.id,
                id: userId,
                ...(chatType === undefined ? {} : { chatType })
            },
            ...(parsed.answer === undefined ? {} : { answer: parsed.answer })
        };
        for (const handler of this.handlers)
            handler(reply);
    }
    scheduleReconnect() {
        if (this.disposed || this.reconnectTimer !== undefined)
            return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect();
        }, this.reconnectMs);
    }
    rejectAll(error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
