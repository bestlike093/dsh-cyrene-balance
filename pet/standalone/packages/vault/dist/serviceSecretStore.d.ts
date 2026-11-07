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
import type { AuditLog } from './audit/auditLog.js';
import type { VaultLike } from './store/keyRingVaultStore.js';
export declare const SERVICE_SECRET_PREFIX = "service.";
export declare const DEFAULT_SECRET_FIELD = "apiKey";
export interface ServiceSecretStore {
    /** 取明文。没有时返回 null，不抛错。 */
    get(serviceId: string, field?: string): Promise<string | null>;
    set(serviceId: string, value: string, field?: string): Promise<void>;
    clear(serviceId: string, field?: string): Promise<void>;
    /** 清掉某个服务的全部字段。 */
    clearService(serviceId: string): Promise<number>;
    /** 已配置的服务 id，供面板显示「已填 / 未填」。 */
    listConfigured(): Promise<readonly string[]>;
    /**
     * 回显用掩码。UI 只该拿到这个，拿不到明文。
     * 未配置时返回 null。
     */
    getMasked(serviceId: string, field?: string): Promise<string | null>;
}
/**
 * 掩码规则：保留前 3 位与后 4 位，中间固定 4 个星号。
 *
 * 短于 12 位时全掩码——太短的串留头留尾等于没遮。
 * 返回值长度刻意不跟随原文，避免从长度反推密钥长度。
 */
export declare function maskSecret(value: string): string;
/** 校验服务 id 与字段名，防止拼出越界前缀或注入点号。 */
export declare function assertSecretKey(serviceId: string, field: string): void;
export declare class VaultServiceSecretStore implements ServiceSecretStore {
    private readonly vault;
    private readonly audit?;
    constructor(vault: VaultLike, audit?: AuditLog | undefined);
    get(serviceId: string, field?: string): Promise<string | null>;
    set(serviceId: string, value: string, field?: string): Promise<void>;
    clear(serviceId: string, field?: string): Promise<void>;
    clearService(serviceId: string): Promise<number>;
    listConfigured(): Promise<readonly string[]>;
    getMasked(serviceId: string, field?: string): Promise<string | null>;
}
