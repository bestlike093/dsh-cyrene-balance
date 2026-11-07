/**
 * LLM API Key 的 Vault 落点。
 *
 * 只允许存在 VaultStore 的加密文件里；禁止进 settings.json、环境变量、
 * 命令行参数。旧版明文字段由 migrateLegacyLlmKey 迁移，调用方拿到
 * scrubbedField 后必须从配置里删除并保存。
 */
import type { AuditLog } from './audit/auditLog.js';
import type { VaultLike } from './store/keyRingVaultStore.js';
export declare const LLM_API_KEY_FIELD = "llmApiKey";
export interface LlmSecretStore {
    getApiKey(): Promise<string | null>;
    setApiKey(key: string): Promise<void>;
    clearApiKey(): Promise<void>;
}
/** 明文只在这一层短暂出现，调用方不得回显、记日志或放入剪贴板。 */
export declare class VaultLlmSecretStore implements LlmSecretStore {
    private readonly vault;
    private readonly audit?;
    constructor(vault: VaultLike, audit?: AuditLog | undefined);
    getApiKey(): Promise<string | null>;
    setApiKey(key: string): Promise<void>;
    clearApiKey(): Promise<void>;
}
export interface LegacyKeyMigrationResult {
    readonly migrated: boolean;
    /** 调用方需要从旧配置里删除的字段；null 表示没有可迁移的明文。 */
    readonly scrubbedField: string | null;
}
/** 纯函数：返回删掉旧明文字段的配置副本，不改入参。 */
export declare function scrubLegacyLlmKey(settings: Readonly<Record<string, unknown>>): Record<string, unknown>;
/**
 * 把旧配置里的明文 Key 迁进 Vault，并返回待擦除字段。
 * 审计只记事件与来源，不记 Key 本身。
 */
export declare function migrateLegacyLlmKey(legacy: Readonly<Record<string, unknown>>, store: LlmSecretStore, audit?: AuditLog): Promise<LegacyKeyMigrationResult>;
