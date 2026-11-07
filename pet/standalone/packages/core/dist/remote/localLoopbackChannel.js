/** 本地回环：不联网，用于桌面弹窗与端到端测试。 */
export class LocalLoopbackChannel {
    id = 'local-loopback';
    handlers = new Set();
    sent = [];
    now;
    constructor(now = Date.now) {
        this.now = now;
    }
    capabilities() {
        return { approval: true, question: true, richCard: false, memorySync: false };
    }
    async send(envelope) {
        this.sent.push(envelope);
        return { messageId: envelope.id };
    }
    onReply(handler) {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }
    /** 测试或本地 UI 用：模拟用户按下按钮。 */
    reply(envelopeId, action, answer) {
        const reply = {
            envelopeId,
            action,
            decidedAt: this.now(),
            sig: '',
            ...(answer === undefined ? {} : { answer })
        };
        for (const handler of this.handlers)
            handler(reply);
    }
    get sentCount() {
        return this.sent.length;
    }
    lastSent() {
        return this.sent.at(-1);
    }
    async health() {
        return { ok: true, message: '本地回环可用' };
    }
}
