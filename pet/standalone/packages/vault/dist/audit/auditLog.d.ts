export type AuditEvent = 'seal' | 'open' | 'rotate' | 'key_backend_insecure' | 'tamper_detected' | 'llm_key_stored' | 'llm_key_cleared' | 'llm_key_migrated' | 'service_key_stored' | 'service_key_cleared';
/** 只允许放非敏感摘要；明文、密钥、token 一律不得进入审计日志。 */
export interface AuditDetails {
    readonly keyId?: number;
    readonly epoch?: number;
    readonly size?: number;
    readonly backend?: string;
    readonly code?: string;
    readonly note?: string;
    readonly appVersion?: string;
    /** 触发来源：user=显式动作，system=自动检测/恢复，test=测试。自动确认只可能是 system，属于 bug。 */
    readonly source?: 'user' | 'system' | 'test';
    readonly backupPath?: string;
}
export interface AuditEntry {
    readonly seq: number;
    readonly ts: number;
    readonly event: AuditEvent;
    readonly details: AuditDetails;
    readonly prevHash: string;
    readonly hash: string;
}
export interface AuditLog {
    append(event: AuditEvent, details?: AuditDetails): Promise<AuditEntry>;
    verify(): Promise<void>;
    entries(): Promise<readonly AuditEntry[]>;
}
/**
 * 纯 append-only 审计日志（JSON Lines）。
 * 首版不做 Merkle root（17.5 不做清单），用逐条前向哈希保证删行/改行可被发现。
 */
export declare function createAuditLog(path: string): Promise<AuditLog>;
