import { ErrorCode, HybridClock, PetError } from '@pet/shared';
function encodePayload(payload) {
    const json = JSON.stringify(payload ?? null);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + 0x8000)));
    }
    return `plain:${btoa(binary)}`;
}
function defaultId() {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}
function defaultNonce() {
    return globalThis.crypto.randomUUID();
}
/**
 * 决策网关：创建 envelope、分发到所有通道、等待任意一个回复。
 * 最小版本 payload 以 `plain:` 前缀承载，Vault 接入后替换为密文。
 */
export class DecisionGateway {
    deviceId;
    channels;
    timeoutMs;
    timeoutPolicy;
    clock;
    now;
    signer;
    nonce;
    id;
    authorizeReply;
    pending = new Map();
    /** 已结算结果短暂保留，避免「回复先到、wait 后到」被误判为不存在。 */
    settled = new Map();
    settledLimit = 32;
    unsubscribers = [];
    disposed = false;
    constructor(options) {
        if (options.channels.length === 0) {
            throw new PetError(ErrorCode.CHANNEL_NOT_CONFIGURED, '至少需要一个决策通道');
        }
        this.deviceId = options.deviceId;
        this.channels = options.channels;
        this.timeoutMs = options.timeoutMs ?? 300_000;
        this.timeoutPolicy = options.timeoutPolicy ?? 'fallback-local';
        this.clock = options.clock ?? new HybridClock(options.deviceId);
        this.now = options.now ?? Date.now;
        this.signer = options.signer;
        this.nonce = options.nonce ?? defaultNonce;
        this.id = options.id ?? defaultId;
        this.authorizeReply = options.authorizeReply;
        for (const channel of this.channels) {
            this.unsubscribers.push(channel.onReply((reply) => {
                this.handleReply(reply, channel.id);
            }));
        }
    }
    get pendingIds() {
        return [...this.pending.keys()];
    }
    async prepare(request) {
        if (this.disposed)
            throw new PetError(ErrorCode.NOT_SUPPORTED, '决策网关已释放');
        if (typeof request.summary !== 'string' || request.summary.trim().length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '决策摘要不能为空');
        }
        const id = this.id();
        const ttlMs = request.ttlMs ?? this.timeoutMs;
        const envelope = {
            id,
            kind: request.kind,
            deviceId: this.deviceId,
            hlc: this.clock.now(),
            nonce: this.nonce(),
            expiresAt: this.now() + ttlMs,
            summary: request.summary,
            payloadCipher: encodePayload(request.payload),
            sig: '',
            keyEpoch: 0,
            ...(request.contextDigest === undefined ? {} : { contextDigest: request.contextDigest })
        };
        const canonical = JSON.stringify([
            envelope.id,
            envelope.kind,
            envelope.deviceId,
            envelope.nonce,
            envelope.expiresAt,
            envelope.contextDigest ?? null,
            envelope.summary,
            envelope.payloadCipher
        ]);
        const sig = this.signer === undefined ? '' : await this.signer(canonical);
        let resolveFn;
        let rejectFn;
        const promise = new Promise((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = reject;
        });
        const timer = setTimeout(() => {
            const pending = this.pending.get(id);
            if (pending === undefined)
                return;
            if (this.timeoutPolicy === 'block') {
                this.pending.delete(id);
                pending.reject(new PetError(ErrorCode.DECISION_TIMEOUT, '等待决策超时'));
                return;
            }
            this.settle(id, { status: 'timeout', envelope, usedFallback: true });
        }, ttlMs);
        this.pending.set(id, {
            envelope: { ...envelope, sig },
            promise,
            resolve: resolveFn,
            reject: rejectFn,
            timer
        });
        const results = await Promise.allSettled(this.channels.map((channel) => channel.send(envelope)));
        if (results.every((result) => result.status === 'rejected')) {
            clearTimeout(timer);
            this.pending.delete(id);
            const reasons = results
                .filter((result) => result.status === 'rejected')
                .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));
            throw new PetError(ErrorCode.CHANNEL_NOT_CONFIGURED, '没有可用的决策通道', {
                details: { reasons }
            });
        }
        return { ...envelope, sig };
    }
    wait(id) {
        const pending = this.pending.get(id);
        if (pending !== undefined)
            return pending.promise;
        const settled = this.settled.get(id);
        if (settled !== undefined)
            return Promise.resolve(settled);
        return Promise.reject(new PetError(ErrorCode.DECISION_NOT_FOUND, `没有待决事项：${id}`));
    }
    async ask(request) {
        const envelope = await this.prepare(request);
        return this.wait(envelope.id);
    }
    /** 本地 UI / 测试直接提交决定。 */
    resolve(id, action, answer) {
        const pending = this.pending.get(id);
        if (pending === undefined) {
            throw new PetError(ErrorCode.DECISION_NOT_FOUND, `没有待决事项：${id}`);
        }
        const reply = {
            envelopeId: id,
            action,
            decidedAt: this.now(),
            sig: '',
            ...(answer === undefined ? {} : { answer })
        };
        const status = action === 'allow'
            ? 'allowed'
            : action === 'deny'
                ? 'denied'
                : action === 'answer'
                    ? 'answered'
                    : 'dismissed';
        const outcome = {
            status,
            envelope: pending.envelope,
            reply,
            usedFallback: false
        };
        this.settle(id, outcome);
        return outcome;
    }
    dispose() {
        this.disposed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new PetError(ErrorCode.NOT_SUPPORTED, '决策网关已释放'));
        }
        this.pending.clear();
        this.settled.clear();
        for (const unsubscribe of this.unsubscribers)
            unsubscribe();
        this.unsubscribers.length = 0;
    }
    handleReply(reply, channelId) {
        const pending = this.pending.get(reply.envelopeId);
        if (pending === undefined)
            return;
        if (!this.isAuthorized(reply, pending.envelope, channelId))
            return;
        const status = reply.action === 'allow'
            ? 'allowed'
            : reply.action === 'deny'
                ? 'denied'
                : reply.action === 'answer'
                    ? 'answered'
                    : 'dismissed';
        this.settle(reply.envelopeId, {
            status,
            envelope: pending.envelope,
            reply,
            usedFallback: false
        });
    }
    /**
     * 回复来源校验。
     *
     * - 没有 sender：只允许本机回环。远程通道漏填 sender 时不会被当成主人。
     * - sender.channelId 与订阅通道不一致：拒绝，防止跨通道冒用身份。
     * - 其余情况：必须由 authorizeReply 明确放行；未配置、抛错都按拒绝处理。
     */
    isAuthorized(reply, envelope, channelId) {
        if (reply.sender === undefined)
            return channelId === 'local-loopback';
        if (reply.sender.channelId !== channelId)
            return false;
        if (this.authorizeReply === undefined)
            return false;
        try {
            return this.authorizeReply(reply, envelope, channelId) === true;
        }
        catch {
            return false;
        }
    }
    settle(id, outcome) {
        const pending = this.pending.get(id);
        if (pending === undefined)
            return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        this.settled.set(id, outcome);
        while (this.settled.size > this.settledLimit) {
            const oldest = this.settled.keys().next();
            if (oldest.done === true)
                break;
            this.settled.delete(oldest.value);
        }
        pending.resolve(outcome);
    }
}
