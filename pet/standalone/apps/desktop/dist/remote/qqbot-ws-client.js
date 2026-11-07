// QQ 官方机器人 WebSocket 网关客户端。
//
// 协议（官方 opcode 约定，参考 bot.q.qq.com/wiki 事件订阅文档）：
//   op 10 Hello      —— 连上后第一条，d.heartbeat_interval(ms) 指定心跳周期
//   op 2  Identify   —— 客户端鉴权 {token: "QQBot <access_token>", intents, shard, properties}
//   op 0  Dispatch   —— 服务端事件推送 {t: 事件名, s: 序号, d: 事件体}
//   op 1  Heartbeat  —— 客户端心跳，d = 最近收到的 s
//   op 11 Heartbeat ACK
//   op 7  Reconnect  —— 服务端要求重连（优先 Resume）
//   op 6  Resume     —— 断线恢复 {token, session_id, seq}
//   op 9  Invalid Session —— identify/resume 参数错，d=false 时必须重新 Identify
//
// intents：GROUP_AND_C2C_EVENT = 1<<25，覆盖 C2C_MESSAGE_CREATE /
// GROUP_AT_MESSAGE_CREATE / GROUP_MESSAGE_CREATE（群全量，需群主开启）。
import { WebSocketClient } from './websocket-client.js';
/** 单聊 + 群聊（含群 @）事件 */
export const QQBOT_INTENT_GROUP_AND_C2C = 1 << 25;
const DEFAULT_MAX_BACKOFF_MS = 60_000;
export class QqBotWsClient {
    options;
    ws = null;
    heartbeatTimer = null;
    reconnectTimer = null;
    stopped = false;
    seq = 0;
    sessionId = '';
    ready = false;
    backoffMs = 1_000;
    heartbeatAcked = true;
    /** 连续多少个心跳周期没有 ACK；容忍一次网络抖动，连续两次才判定假死。 */
    heartbeatMisses = 0;
    lastError = null;
    /**
     * 每次 connect 递增。旧 socket 的 close/error 回调晚到时，
     * 只能处理自己那一代，不能把新连接的心跳和重连计划一起清掉。
     */
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
        await this.connect(false);
    }
    async stop() {
        this.stopped = true;
        // 让所有在途连接的回调失效，避免关闭后又被旧 close 拉起重连。
        this.generation += 1;
        this.clearTimers();
        const ws = this.ws;
        this.ws = null;
        if (ws !== null && ws.readyState <= WebSocketClient.OPEN) {
            ws.removeAllListeners();
            try {
                ws.close(1000, 'client shutdown');
            }
            catch {
                // 已断开时 close 会抛错，忽略
            }
        }
        this.setReady(false);
    }
    async connect(resume) {
        if (this.stopped)
            return;
        // 取 token 是异步的；期间可能又来了新的 connect。用代次把旧的那次作废。
        const generation = ++this.generation;
        let token;
        try {
            token = await this.options.getAccessToken();
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            const err = error instanceof Error ? error : new Error(String(error));
            this.lastError = err;
            this.options.onError(err);
            this.scheduleReconnect();
            return;
        }
        if (this.stopped || generation !== this.generation)
            return;
        const ws = this.options.websocketFactory
            ? this.options.websocketFactory(this.options.gatewayUrl)
            : new WebSocketClient(this.options.gatewayUrl);
        this.ws = ws;
        this.heartbeatAcked = true;
        this.heartbeatMisses = 0;
        ws.on('message', (raw) => {
            if (generation !== this.generation)
                return;
            try {
                this.handlePayload(JSON.parse(String(raw)), token, resume);
            }
            catch (error) {
                this.options.onError(error instanceof Error ? error : new Error(String(error)));
            }
        });
        ws.on('error', (error) => {
            if (generation !== this.generation)
                return;
            this.lastError = error;
            this.options.onError(error);
        });
        ws.on('close', () => {
            // 旧连接的 close 不能清掉新连接的心跳，也不能再排一次重连。
            if (generation !== this.generation)
                return;
            this.clearHeartbeat();
            if (this.stopped)
                return;
            // close 后统一走重连；是否可 Resume 由 connect 内决定
            this.setReady(false);
            this.scheduleReconnect();
        });
    }
    handlePayload(payload, token, resume) {
        switch (payload.op) {
            case 10: {
                // Hello：按服务端指定周期发心跳，然后鉴权
                const interval = Number(payload.d?.heartbeat_interval ?? 30_000);
                this.startHeartbeat(interval);
                if (resume && this.sessionId !== '' && this.seq > 0) {
                    this.send({
                        op: 6,
                        d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.seq }
                    });
                }
                else {
                    this.sendIdentify(token);
                }
                break;
            }
            case 0: {
                // Dispatch：记录序号 + 抛事件
                if (typeof payload.s === 'number')
                    this.seq = payload.s;
                const type = (payload.t ?? '');
                const data = (payload.d ?? {});
                if (type === 'READY') {
                    this.sessionId = String(data['session_id'] ?? '');
                    this.backoffMs = 1_000;
                    this.setReady(true);
                }
                else if (type === 'RESUMED') {
                    this.backoffMs = 1_000;
                    this.setReady(true);
                }
                else {
                    this.options.onDispatch(type, data);
                }
                break;
            }
            case 11:
                // Heartbeat ACK
                this.heartbeatAcked = true;
                this.heartbeatMisses = 0;
                break;
            case 7:
                // 服务端要求重连：优先 Resume
                if (this.ws !== null) {
                    try {
                        this.ws.close(4000, 'server requested reconnect');
                    }
                    catch {
                        // 忽略
                    }
                }
                break;
            case 9: {
                // Invalid Session：旧 token/session 已经不可用。重新取 token、关掉旧 socket 再 Identify，
                // 原来直接在旧 socket 上补发 Identify，token 过期时会无限循环断开。
                const invalidResumable = payload.d?.d;
                this.lastError = new Error(`QQ Bot session 无效（${invalidResumable === true ? '可重试' : '需重新鉴权'}），正在重建连接`);
                this.restart();
                break;
            }
            default:
                break;
        }
    }
    sendIdentify(token) {
        this.send({
            op: 2,
            d: {
                token: `QQBot ${token}`,
                intents: this.options.intents ?? QQBOT_INTENT_GROUP_AND_C2C,
                shard: [0, 1],
                properties: { $os: process.platform, $browser: 'cyrene', $device: 'cyrene' }
            }
        });
    }
    /**
     * 放弃当前 socket，重新取 token 再连。
     *
     * op 9（Invalid Session）和 token 过期都需要这条路径：旧 socket 上补发 Identify
     * 只会拿同一个失效 token 再被拒一次，表现为「刚连上就断」的循环。
     */
    restart() {
        this.clearHeartbeat();
        this.sessionId = '';
        this.seq = 0;
        this.backoffMs = 1_000;
        const ws = this.ws;
        this.ws = null;
        // 先把代次推上去，旧 socket 的 close 回调就不会再排重连。
        this.generation += 1;
        if (ws !== null) {
            ws.removeAllListeners();
            try {
                ws.close(4000, 'invalid session');
            }
            catch {
                // 已断开时 close 会抛错，忽略
            }
        }
        this.setReady(false);
        if (this.stopped)
            return;
        void this.connect(false);
    }
    startHeartbeat(intervalMs) {
        this.clearHeartbeat();
        this.heartbeatAcked = true;
        this.heartbeatMisses = 0;
        this.heartbeatTimer = setInterval(() => {
            if (!this.heartbeatAcked) {
                this.heartbeatMisses += 1;
                // 连续两个周期没有 ACK 才判定假死：官方心跳间隔本身就有 40s 左右，
                // 一次网络抖动就断开会让「反复重连」变成常态。
                if (this.heartbeatMisses >= 2) {
                    this.options.onError(new Error('QQ Bot 心跳超时，重连'));
                    try {
                        this.ws?.terminate();
                    }
                    catch {
                        // 忽略
                    }
                    return;
                }
            }
            else {
                this.heartbeatMisses = 0;
            }
            this.heartbeatAcked = false;
            this.send({ op: 1, d: this.seq > 0 ? this.seq : null });
        }, Math.max(1_000, intervalMs));
        // 不因心跳/重连把宿主进程吊住；Electron 主进程另有窗口与托盘维持生命周期。
        this.heartbeatTimer.unref?.();
    }
    send(payload) {
        const ws = this.ws;
        if (ws === null || ws.readyState !== WebSocketClient.OPEN)
            return;
        try {
            ws.send(JSON.stringify(payload));
        }
        catch (error) {
            this.options.onError(error instanceof Error ? error : new Error(String(error)));
        }
    }
    scheduleReconnect() {
        if (this.stopped || this.reconnectTimer !== null)
            return;
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, this.options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS);
        const canResume = this.sessionId !== '' && this.seq > 0;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect(canResume);
        }, delay);
        this.reconnectTimer.unref?.();
    }
    clearHeartbeat() {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    clearTimers() {
        this.clearHeartbeat();
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    setReady(ready) {
        if (this.ready === ready)
            return;
        this.ready = ready;
        this.options.onReadyChange(ready);
    }
}
