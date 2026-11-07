// 最小 RFC6455 WebSocket 客户端（仅客户端、文本帧、wss/ws）。
//
// 项目契约禁止 apps/desktop 引入非 workspace 运行时依赖，因此这里不依赖 ws。
// 只实现 QQ 网关需要的能力：握手、掩码发送、分片重组、ping/pong、close。
// 协议参考 RFC 6455；不支持的扩展（permessage-deflate 等）不会在握手时声明。
import { createHash, randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 10_000;
export class WebSocketClient {
    url;
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = WebSocketClient.CONNECTING;
    listeners = new Map();
    socket = null;
    handshakeBuffer = Buffer.alloc(0);
    frameBuffer = Buffer.alloc(0);
    handshaked = false;
    handshakeKey = '';
    closeEmitted = false;
    handshakeTimer = null;
    fragmentOpcode = 0;
    fragments = [];
    constructor(url) {
        this.url = url;
        this.open();
    }
    on(event, listener) {
        const set = this.listeners.get(event) ?? new Set();
        set.add(listener);
        this.listeners.set(event, set);
        return this;
    }
    removeAllListeners() {
        this.listeners.clear();
        return this;
    }
    send(data) {
        if (this.readyState !== WebSocketClient.OPEN)
            return;
        this.writeFrame(0x1, Buffer.from(data, 'utf8'));
    }
    close(code = 1000, reason = '') {
        if (this.readyState === WebSocketClient.CLOSED)
            return;
        if (this.readyState === WebSocketClient.OPEN) {
            const reasonBytes = Buffer.from(reason, 'utf8').subarray(0, 123);
            const payload = Buffer.alloc(2 + reasonBytes.length);
            payload.writeUInt16BE(code, 0);
            reasonBytes.copy(payload, 2);
            this.writeFrame(0x8, payload);
        }
        this.readyState = WebSocketClient.CLOSING;
        const socket = this.socket;
        if (socket !== null)
            socket.end();
        setTimeout(() => this.terminate(), 1_000).unref?.();
    }
    terminate() {
        const socket = this.socket;
        this.socket = null;
        this.readyState = WebSocketClient.CLOSED;
        if (socket !== null)
            socket.destroy();
        this.emitClose();
    }
    open() {
        let parsed;
        try {
            parsed = new URL(this.url);
        }
        catch {
            this.fail(new Error(`WebSocket URL 无效：${this.url}`));
            return;
        }
        if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
            this.fail(new Error(`WebSocket 只支持 ws/wss：${parsed.protocol}`));
            return;
        }
        const host = parsed.hostname;
        const port = parsed.port === '' ? (parsed.protocol === 'wss:' ? 443 : 80) : Number(parsed.port);
        const socket = parsed.protocol === 'wss:'
            ? tlsConnect({ host, port, servername: host })
            : netConnect({ host, port });
        this.socket = socket;
        this.handshakeTimer = setTimeout(() => {
            this.fail(new Error('WebSocket 握手超时'));
        }, HANDSHAKE_TIMEOUT_MS);
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (error) => this.fail(error));
        socket.on('close', () => {
            this.readyState = WebSocketClient.CLOSED;
            this.emitClose();
        });
        const key = randomBytes(16).toString('base64');
        this.handshakeKey = key;
        const path = `${parsed.pathname === '' ? '/' : parsed.pathname}${parsed.search}`;
        socket.write([
            `GET ${path} HTTP/1.1`,
            `Host: ${parsed.host}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${key}`,
            'Sec-WebSocket-Version: 13',
            'User-Agent: CyreneDesktop/2.0',
            '',
            ''
        ].join('\r\n'));
    }
    onData(chunk) {
        if (!this.handshaked) {
            this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
            const headerEnd = this.handshakeBuffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                if (this.handshakeBuffer.length > 16 * 1024)
                    this.fail(new Error('WebSocket 握手响应过大'));
                return;
            }
            const header = this.handshakeBuffer.subarray(0, headerEnd).toString('latin1');
            const rest = this.handshakeBuffer.subarray(headerEnd + 4);
            this.handshakeBuffer = Buffer.alloc(0);
            if (!this.acceptHandshake(header))
                return;
            this.clearHandshakeTimer();
            this.handshaked = true;
            this.readyState = WebSocketClient.OPEN;
            if (rest.length > 0)
                this.onData(rest);
            return;
        }
        this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
        this.parseFrames();
    }
    acceptHandshake(header) {
        const lines = header.split('\r\n');
        const status = lines[0] ?? '';
        if (!/^HTTP\/1\.1 101\b/.test(status)) {
            this.fail(new Error(`WebSocket 握手失败：${status}`));
            return false;
        }
        let accept = '';
        let upgrade = '';
        for (const line of lines.slice(1)) {
            const index = line.indexOf(':');
            if (index < 0)
                continue;
            const name = line.slice(0, index).trim().toLowerCase();
            const value = line.slice(index + 1).trim();
            if (name === 'sec-websocket-accept')
                accept = value;
            if (name === 'upgrade')
                upgrade = value.toLowerCase();
        }
        if (upgrade !== 'websocket') {
            this.fail(new Error('WebSocket 握手缺少 Upgrade: websocket'));
            return false;
        }
        // 服务端 Accept 必须是客户端 key + 固定 GUID 的 SHA-1，防止握手被中间人误导。
        const expected = createHash('sha1')
            .update(`${this.handshakeKey}${WS_GUID}`)
            .digest('base64');
        if (accept !== expected) {
            this.fail(new Error('WebSocket 握手 Sec-WebSocket-Accept 不匹配'));
            return false;
        }
        return true;
    }
    parseFrames() {
        for (;;) {
            const buffer = this.frameBuffer;
            if (buffer.length < 2)
                return;
            const first = buffer[0] ?? 0;
            const second = buffer[1] ?? 0;
            const fin = (first & 0x80) !== 0;
            const rsv = first & 0x70;
            const opcode = first & 0x0f;
            const masked = (second & 0x80) !== 0;
            let length = second & 0x7f;
            let offset = 2;
            if (rsv !== 0) {
                this.fail(new Error('WebSocket 帧使用了未协商的扩展'));
                return;
            }
            if (length === 126) {
                if (buffer.length < 4)
                    return;
                length = buffer.readUInt16BE(2);
                offset = 4;
            }
            else if (length === 127) {
                if (buffer.length < 10)
                    return;
                const high = buffer.readUInt32BE(2);
                const low = buffer.readUInt32BE(6);
                length = high * 2 ** 32 + low;
                offset = 10;
            }
            if (length > MAX_PAYLOAD_BYTES) {
                this.fail(new Error(`WebSocket 帧过大：${length} 字节`));
                return;
            }
            const maskLength = masked ? 4 : 0;
            if (buffer.length < offset + maskLength + length)
                return;
            let payload = buffer.subarray(offset + maskLength, offset + maskLength + length);
            if (masked) {
                const mask = buffer.subarray(offset, offset + 4);
                const unmasked = Buffer.alloc(length);
                for (let i = 0; i < length; i += 1) {
                    unmasked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
                }
                payload = unmasked;
            }
            this.frameBuffer = buffer.subarray(offset + maskLength + length);
            this.handleFrame(fin, opcode, payload);
            if (this.readyState === WebSocketClient.CLOSED)
                return;
        }
    }
    handleFrame(fin, opcode, payload) {
        if (opcode === 0x8) {
            this.handleCloseFrame(payload);
            return;
        }
        if (opcode === 0x9) {
            this.writeFrame(0x0a, payload);
            return;
        }
        if (opcode === 0x0a)
            return;
        if (opcode === 0x0) {
            if (this.fragmentOpcode === 0) {
                this.fail(new Error('WebSocket 收到无起始帧的续帧'));
                return;
            }
            this.fragments.push(payload);
            if (fin)
                this.finishFragments();
            return;
        }
        if (opcode === 0x1 || opcode === 0x2) {
            if (this.fragmentOpcode !== 0) {
                this.fail(new Error('WebSocket 分片未结束就收到新帧'));
                return;
            }
            if (fin) {
                this.emitMessage(opcode, payload);
            }
            else {
                this.fragmentOpcode = opcode;
                this.fragments = [payload];
            }
        }
    }
    finishFragments() {
        const opcode = this.fragmentOpcode;
        const payload = Buffer.concat(this.fragments);
        this.fragmentOpcode = 0;
        this.fragments = [];
        if (opcode !== 0)
            this.emitMessage(opcode, payload);
    }
    emitMessage(opcode, payload) {
        if (opcode !== 0x1)
            return;
        this.emit('message', payload.toString('utf8'));
    }
    handleCloseFrame(payload) {
        if (this.readyState === WebSocketClient.OPEN) {
            const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
            this.writeFrame(0x8, payload.subarray(0, Math.min(payload.length, 125)));
            this.readyState = WebSocketClient.CLOSING;
            this.socket?.end();
            setTimeout(() => this.terminate(), 200).unref?.();
            if (code === 1000)
                return;
        }
        this.terminate();
    }
    writeFrame(opcode, payload) {
        const socket = this.socket;
        if (socket === null || this.readyState !== WebSocketClient.OPEN)
            return;
        const length = payload.length;
        let header;
        if (length < 126) {
            header = Buffer.alloc(2);
            header[1] = 0x80 | length;
        }
        else if (length < 65_536) {
            header = Buffer.alloc(4);
            header[1] = 0x80 | 126;
            header.writeUInt16BE(length, 2);
        }
        else {
            header = Buffer.alloc(10);
            header[1] = 0x80 | 127;
            header.writeUInt32BE(0, 2);
            header.writeUInt32BE(length, 6);
        }
        header[0] = 0x80 | opcode;
        const mask = randomBytes(4);
        const masked = Buffer.alloc(length);
        for (let i = 0; i < length; i += 1) {
            masked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
        }
        try {
            socket.write(Buffer.concat([header, mask, masked]));
        }
        catch (error) {
            this.fail(error instanceof Error ? error : new Error(String(error)));
        }
    }
    fail(error) {
        this.emit('error', error);
        this.terminate();
    }
    emitClose() {
        if (this.closeEmitted)
            return;
        this.closeEmitted = true;
        this.clearHandshakeTimer();
        this.emit('close');
    }
    clearHandshakeTimer() {
        if (this.handshakeTimer !== null) {
            clearTimeout(this.handshakeTimer);
            this.handshakeTimer = null;
        }
    }
    emit(event, ...args) {
        const set = this.listeners.get(event);
        if (set === undefined)
            return;
        for (const listener of set) {
            try {
                listener(...args);
            }
            catch {
                // 监听器异常不应打断帧解析
            }
        }
    }
}
