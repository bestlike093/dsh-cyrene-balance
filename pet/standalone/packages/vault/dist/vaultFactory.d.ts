import type { CryptoSuiteId } from '@pet/shared';
import type { AuditLog } from './audit/auditLog.js';
import { type FileKeyRing, type FileKeyRingDiagnostic } from './crypto/fileKeyRing.js';
import { type KeyBackend, type SafeStorageLike } from './crypto/keyBackend.js';
export type DiagnosticSeverity = 'ok' | 'error';
export type DiagnosticCode = 'OK' | 'KEY_BACKEND_INSECURE' | 'KEY_FILE_PERMISSION';
export interface VaultDiagnostic extends FileKeyRingDiagnostic {
    readonly severity: DiagnosticSeverity;
    readonly code: DiagnosticCode;
    /** 诊断项细分类；归入 credential 组，渲染时按 group → kind 两级展开。 */
    readonly kind: 'secure';
    readonly group: 'credential';
    /**
     * 只代表「用户已对当前后端显式确认」，仅用于抑制重复弹窗。
     * 不参与「是否允许在不安全后端下运行」的决策，不降低 severity，
     * 不跨后端继承，也不会由任何默认值/缓存自动置 true。
     */
    readonly acknowledged: boolean;
    readonly message: string;
}
export interface CreateVaultOptions {
    readonly keyFilePath: string;
    /**
     * memory 后端只能显式注入；不传时一律要求系统后端，
     * 缺后端时明确失败，禁止静默落到 memory。
     */
    readonly backend?: KeyBackend;
    readonly safeStorage?: SafeStorageLike;
    readonly suite?: CryptoSuiteId;
    /** 审计日志；确认不安全后端会写一条 key_backend_insecure。 */
    readonly audit?: AuditLog;
    /**
     * 本机状态文件（state.json）。只放确认态，禁止指向可迁移配置。
     * 不传时确认态只存内存，重启即视为未确认。
     */
    readonly stateFilePath?: string;
    /** 写入审计的 app 版本，便于事后定位是哪一版触发的确认/恢复。 */
    readonly appVersion?: string;
}
export interface VaultAssembly {
    readonly ring: FileKeyRing;
    /** 备份恢复需要用它把密钥重新包裹成当前机器的格式。 */
    readonly backend: KeyBackend;
    diagnose(): Promise<VaultDiagnostic>;
    /** 唯一能把 acknowledged 置 true 的入口：必须由用户显式动作触发。 */
    acknowledgeInsecure(): Promise<VaultDiagnostic>;
}
/**
 * 装配工厂：只依赖 KeyRing / KeyBackend 两个抽象。
 * 诊断先接，装配后接；`secure=false` 是保护失效，诊断级别固定为 error（❌）。
 */
export declare function createVault(options: CreateVaultOptions): Promise<VaultAssembly>;
