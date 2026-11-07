import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { ErrorCode, PetError } from '@pet/shared';
const DEFAULT_API_BASE = 'https://api.sgroup.qq.com';
const DEFAULT_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const ED25519_SPKI_PREFIX = '302a300506032b6570032100';
const ED25519_PKCS8_PREFIX = '302e020100300506032b657004220420';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function header(headers, name) {
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== name)
            continue;
        return Array.isArray(value) ? value[0] : value;
    }
    return undefined;
}
function publicKeyFromHex(hex) {
    const raw = Buffer.from(hex, 'hex');
    if (raw.length !== 32) {
        throw new PetError(ErrorCode.CHANNEL_NOT_CONFIGURED, 'QQ 公钥必须是 32 字节 hex');
    }
    return createPublicKey({
        key: Buffer.concat([Buffer.from(ED25519_SPKI_PREFIX, 'hex'), raw]),
        format: 'der',
        type: 'spki'
    });
}
/** QQ 用 BotSecret 作为 Ed25519 seed；不足 32 字节补零，超出截断。 */
function privateKeyFromSecret(secret) {
    const seed = Buffer.alloc(32);
    Buffer.from(secret, 'utf8').copy(seed, 0, 0, 32);
    return createPrivateKey({
        key: Buffer.concat([Buffer.from(ED25519_PKCS8_PREFIX, 'hex'), seed]),
        format: 'der',
        type: 'pkcs8'
    });
}
/** QQ webhook 里取回复者 openid：C2C 用 user_openid，群聊用 member_openid。 */
function senderOpenId(data) {
    if (data === undefined)
        return undefined;
    const author = data['author'];
    if (!isRecord(author))
        return undefined;
    for (const key of ['user_openid', 'member_openid', 'openid']) {
        const value = author[key];
        if (typeof value === 'string' && value.trim().length > 0)
            return value.trim();
    }
    return undefined;
}
/**
 * QQ 官方机器人通道（v2）。
 * 只走官方 API；未配置凭据时 health 明确返回 CHANNEL_NOT_CONFIGURED。
 */
export class QqOfficialChannel {
    id = 'qq';
    appId;
    clientSecret;
    publicKey;
    target;
    owners;
    apiBase;
    tokenUrl;
    fetchImpl;
    now;
    handlers = new Set();
    token = null;
    constructor(options) {
        this.appId = options.appId;
        this.clientSecret = options.clientSecret;
        this.publicKey = options.publicKey;
        this.target = options.target;
        this.owners = new Set((options.ownerOpenIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0));
        this.apiBase = options.apiBase ?? DEFAULT_API_BASE;
        this.tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.now = options.now ?? Date.now;
    }
    capabilities() {
        return { approval: true, question: true, richCard: false, memorySync: false };
    }
    onReply(handler) {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }
    async send(envelope) {
        if (this.target === undefined) {
            throw new PetError(ErrorCode.CHANNEL_NOT_CONFIGURED, 'QQ 未配置接收目标（QQ_BOT_OPENID）');
        }
        const token = await this.accessToken();
        const url = this.target.kind === 'c2c'
            ? `${this.apiBase}/v2/users/${encodeURIComponent(this.target.openId)}/messages`
            : `${this.apiBase}/v2/groups/${encodeURIComponent(this.target.openId)}/messages`;
        const minutes = Math.max(1, Math.round((envelope.expiresAt - this.now()) / 60_000));
        const content = [
            '【待拍板】',
            envelope.summary.slice(0, 200),
            `允许：allow ${envelope.id}`,
            `拒绝：deny ${envelope.id}`,
            `${minutes} 分钟内有效`
        ].join('\n');
        const response = await this.fetchImpl(url, {
            method: 'POST',
            headers: {
                authorization: `QQBot ${token}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                content,
                msg_type: 0,
                msg_id: envelope.id,
                msg_seq: 1
            })
        });
        if (!response.ok) {
            throw new PetError(ErrorCode.CHANNEL_UNREACHABLE, `QQ 发送失败：HTTP ${response.status}`);
        }
        const data = await response.json();
        const messageId = isRecord(data) && typeof data['id'] === 'string' ? data['id'] : envelope.id;
        return { messageId };
    }
    async health() {
        if (this.appId.length === 0 || this.clientSecret.length === 0) {
            return {
                ok: false,
                code: ErrorCode.CHANNEL_NOT_CONFIGURED,
                message: '未配置 QQ_BOT_APP_ID / QQ_BOT_SECRET'
            };
        }
        if (this.publicKey === undefined || this.publicKey.length === 0) {
            return {
                ok: false,
                code: ErrorCode.CHANNEL_NOT_CONFIGURED,
                message: '未配置 QQ_BOT_PUBLIC_KEY，webhook 无法验签，通道不会启用'
            };
        }
        if (this.owners.size === 0) {
            return {
                ok: false,
                code: ErrorCode.CHANNEL_NOT_CONFIGURED,
                message: '未配置 QQ_BOT_OWNER_OPENID，不会接受任何远程拍板'
            };
        }
        try {
            await this.accessToken();
            return { ok: true, message: 'QQ 通道可用' };
        }
        catch (error) {
            return {
                ok: false,
                code: ErrorCode.CHANNEL_UNREACHABLE,
                message: error instanceof Error ? error.message : String(error)
            };
        }
    }
    /**
     * 处理 QQ webhook。
     * op 13 返回验证签名；消息事件解析 `allow|deny|answer <id>` 并触发回复。
     */
    async handleWebhook(rawBody, headers) {
        // 没有公钥就无法确认来源，一律拒绝。否则任何能连上 webhook 端口的人
        // 都能伪造 allow/deny，等于把远程拍板的决定权交给网络。
        if (this.publicKey === undefined) {
            throw new PetError(ErrorCode.CHANNEL_NOT_CONFIGURED, 'QQ 通道未配置公钥，拒绝处理 webhook');
        }
        const timestamp = header(headers, 'x-signature-timestamp');
        const signature = header(headers, 'x-signature-ed25519');
        if (timestamp === undefined ||
            signature === undefined ||
            !this.verifySignature(timestamp, rawBody, signature)) {
            throw new PetError(ErrorCode.SIGNATURE_INVALID, 'QQ webhook 验签失败');
        }
        let payload;
        try {
            payload = JSON.parse(rawBody);
        }
        catch (error) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, 'QQ webhook 不是合法 JSON', { cause: error });
        }
        if (!isRecord(payload)) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, 'QQ webhook 必须是对象');
        }
        if (payload['op'] === 13 && isRecord(payload['d'])) {
            const eventTs = String(payload['d']['event_ts'] ?? '');
            const plainToken = String(payload['d']['plain_token'] ?? '');
            return {
                plain_token: plainToken,
                signature: this.signPayload(`${eventTs}${plainToken}`)
            };
        }
        const data = isRecord(payload['d']) ? payload['d'] : undefined;
        const content = data !== undefined && typeof data['content'] === 'string' ? data['content'] : undefined;
        // 发到哪里（target）和谁能拍板（ownerOpenIds）是两件事：
        // 目标 openid 只决定投递地址，不能顺带获得决策权。
        const openId = senderOpenId(data);
        if (data !== undefined &&
            content !== undefined &&
            openId !== undefined &&
            this.owners.has(openId)) {
            const parsed = this.parseCommand(content);
            if (parsed !== null) {
                const groupOpenId = data['group_openid'];
                const chatType = typeof groupOpenId === 'string' && groupOpenId.length > 0 ? 'group' : 'private';
                const reply = {
                    envelopeId: parsed.id,
                    action: parsed.action,
                    decidedAt: this.now(),
                    sig: '',
                    sender: { channelId: this.id, id: openId, chatType },
                    ...(parsed.answer === undefined ? {} : { answer: parsed.answer })
                };
                for (const handler of this.handlers)
                    handler(reply);
                return { ok: true, accepted: true };
            }
        }
        return { ok: true, ignored: true };
    }
    /** 供测试与诊断：不联网也能验证签名。 */
    verifySignature(timestamp, rawBody, signatureHex) {
        if (this.publicKey === undefined)
            return false;
        try {
            return verify(null, Buffer.from(`${timestamp}${rawBody}`, 'utf8'), publicKeyFromHex(this.publicKey), Buffer.from(signatureHex, 'hex'));
        }
        catch {
            return false;
        }
    }
    signPayload(data) {
        return sign(null, Buffer.from(data, 'utf8'), privateKeyFromSecret(this.clientSecret)).toString('hex');
    }
    parseCommand(content) {
        const match = /^\s*(allow|deny|answer)\s+([0-9a-f]{6,32})(?:\s+([\s\S]+))?$/i.exec(content.trim());
        if (match === null)
            return null;
        const verb = (match[1] ?? '').toLowerCase();
        const id = match[2] ?? '';
        const rest = match[3]?.trim();
        const action = verb === 'allow' ? 'allow' : verb === 'deny' ? 'deny' : 'answer';
        if (action === 'answer' && (rest === undefined || rest.length === 0))
            return null;
        return { id, action, ...(rest === undefined ? {} : { answer: rest }) };
    }
    async accessToken() {
        if (this.token !== null && this.token.expiresAt > this.now()) {
            return this.token.value;
        }
        const response = await this.fetchImpl(this.tokenUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret })
        });
        if (!response.ok) {
            throw new PetError(ErrorCode.CHANNEL_UNREACHABLE, `QQ token 请求失败：HTTP ${response.status}`);
        }
        const data = await response.json();
        const accessToken = isRecord(data) && typeof data['access_token'] === 'string' ? data['access_token'] : undefined;
        if (accessToken === undefined) {
            throw new PetError(ErrorCode.CHANNEL_UNREACHABLE, 'QQ token 响应缺少 access_token');
        }
        const rawExpires = isRecord(data) ? Number(data['expires_in'] ?? 7200) : 7200;
        const expiresIn = Number.isFinite(rawExpires) && rawExpires > 0 ? rawExpires : 7200;
        this.token = {
            value: accessToken,
            expiresAt: this.now() + Math.max(60, expiresIn - 60) * 1000
        };
        return accessToken;
    }
}
