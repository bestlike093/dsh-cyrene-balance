/**
 * 外部服务密钥的 Vault 落点。
 *
 * 和 `llmSecretStore` 同一套规矩：明文只允许存在加密文件里，
 * 禁止进 settings.json、环境变量、命令行参数、日志。
 *
 * 区别在结构：LLM 只有一个 key，外部服务有多个（天气、汇率、翻译），
 * 每个还可能不止一个字段。所以按 `service.<id>.<field>` 存成扁平键，
 * 清一个服务时按前缀扫，不会误伤别的。
 *
 * 审计只记「哪个服务的哪一项被写入 / 清除」，不记值本身。
 */
import { ErrorCode, PetError } from '@pet/shared';
export const SERVICE_SECRET_PREFIX = 'service.';
export const DEFAULT_SECRET_FIELD = 'apiKey';
/**
 * 掩码规则：保留前 3 位与后 4 位，中间固定 4 个星号。
 *
 * 短于 12 位时全掩码——太短的串留头留尾等于没遮。
 * 返回值长度刻意不跟随原文，避免从长度反推密钥长度。
 */
export function maskSecret(value) {
    const trimmed = value.trim();
    if (trimmed.length === 0)
        return '';
    if (trimmed.length < 12)
        return '********';
    return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}
/** 校验服务 id 与字段名，防止拼出越界前缀或注入点号。 */
export function assertSecretKey(serviceId, field) {
    if (!isSafeSegment(serviceId)) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `服务 id 不合法：${serviceId}`);
    }
    if (!isSafeSegment(field)) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `字段名不合法：${field}`);
    }
}
function isSafeSegment(value) {
    return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
}
function secretKey(serviceId, field) {
    assertSecretKey(serviceId, field);
    return `${SERVICE_SECRET_PREFIX}${serviceId}.${field}`;
}
export class VaultServiceSecretStore {
    vault;
    audit;
    constructor(vault, audit) {
        this.vault = vault;
        this.audit = audit;
    }
    async get(serviceId, field = DEFAULT_SECRET_FIELD) {
        const key = secretKey(serviceId, field);
        const data = await this.vault.load();
        const value = data?.[key];
        return typeof value === 'string' && value.length > 0 ? value : null;
    }
    async set(serviceId, value, field = DEFAULT_SECRET_FIELD) {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '密钥不能为空');
        }
        const key = secretKey(serviceId, field);
        const data = (await this.vault.load()) ?? {};
        await this.vault.save({ ...data, [key]: value.trim() });
        await this.audit?.append('service_key_stored', {
            source: 'user',
            note: `${serviceId}.${field} 已写入 Vault`
        });
    }
    async clear(serviceId, field = DEFAULT_SECRET_FIELD) {
        const key = secretKey(serviceId, field);
        const data = await this.vault.load();
        if (data === null || !(key in data))
            return;
        const next = { ...data };
        delete next[key];
        await this.vault.save(next);
        await this.audit?.append('service_key_cleared', {
            source: 'user',
            note: `${serviceId}.${field} 已从 Vault 移除`
        });
    }
    async clearService(serviceId) {
        assertSecretKey(serviceId, DEFAULT_SECRET_FIELD);
        const prefix = `${SERVICE_SECRET_PREFIX}${serviceId}.`;
        const data = await this.vault.load();
        if (data === null)
            return 0;
        const next = {};
        let removed = 0;
        for (const [key, value] of Object.entries(data)) {
            if (key.startsWith(prefix)) {
                removed += 1;
                continue;
            }
            next[key] = value;
        }
        if (removed === 0)
            return 0;
        await this.vault.save(next);
        await this.audit?.append('service_key_cleared', {
            source: 'user',
            note: `${serviceId} 的全部密钥已从 Vault 移除（${removed} 项）`
        });
        return removed;
    }
    async listConfigured() {
        const data = await this.vault.load();
        if (data === null)
            return [];
        const ids = new Set();
        for (const key of Object.keys(data)) {
            if (!key.startsWith(SERVICE_SECRET_PREFIX))
                continue;
            const rest = key.slice(SERVICE_SECRET_PREFIX.length);
            const dot = rest.indexOf('.');
            if (dot > 0)
                ids.add(rest.slice(0, dot));
        }
        return [...ids].sort();
    }
    async getMasked(serviceId, field = DEFAULT_SECRET_FIELD) {
        const value = await this.get(serviceId, field);
        return value === null ? null : maskSecret(value);
    }
}
