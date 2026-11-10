/** 统一错误码。跨进程 / 跨端传递时只传 code，不传含敏感信息的 message。 */
export declare const ErrorCode: {
    readonly UNKNOWN: "UNKNOWN";
    readonly INVALID_ARGUMENT: "INVALID_ARGUMENT";
    readonly NOT_SUPPORTED: "NOT_SUPPORTED";
    /** 目标对象尚未注册或尚未应用；调用方先完成初始化，不当作真实故障。 */
    readonly NOT_REGISTERED: "NOT_REGISTERED";
    /** 目标阶段尚未实现；调用方据此走降级，不当作真实故障。 */
    readonly NOT_IMPLEMENTED: "NOT_IMPLEMENTED";
    readonly PERMISSION_DENIED: "PERMISSION_DENIED";
    readonly LOAD_FAILED: "LOAD_FAILED";
    readonly LOAD_TIMEOUT: "LOAD_TIMEOUT";
    readonly MODEL_LOAD_FAILED: "MODEL_LOAD_FAILED";
    readonly MODEL_NOT_RENDERABLE: "MODEL_NOT_RENDERABLE";
    readonly ASSET_INVALID_MAGIC: "ASSET_INVALID_MAGIC";
    readonly MIME_MISMATCH: "MIME_MISMATCH";
    readonly PATH_TRAVERSAL: "PATH_TRAVERSAL";
    readonly ZIP_BOMB: "ZIP_BOMB";
    /** 压缩包内出现可执行 / 可注入的类型（.js/.html/.svg/.exe/.dll）。 */
    readonly ASSET_FORBIDDEN_TYPE: "ASSET_FORBIDDEN_TYPE";
    readonly QUOTA_EXCEEDED: "QUOTA_EXCEEDED";
    readonly VAULT_LOCKED: "VAULT_LOCKED";
    readonly VAULT_TAMPERED: "VAULT_TAMPERED";
    readonly SIGNATURE_INVALID: "SIGNATURE_INVALID";
    readonly REPLAY_DETECTED: "REPLAY_DETECTED";
    readonly TIMESTAMP_EXPIRED: "TIMESTAMP_EXPIRED";
    readonly NONCE_REUSE: "NONCE_REUSE";
    readonly KEY_PERMISSION: "KEY_PERMISSION";
    readonly CRYPTO_SUITE_UNSUPPORTED: "CRYPTO_SUITE_UNSUPPORTED";
    readonly SYNC_GAP_DETECTED: "SYNC_GAP_DETECTED";
    readonly SYNC_DIVERGED: "SYNC_DIVERGED";
    readonly MEMORY_NOT_FOUND: "MEMORY_NOT_FOUND";
    readonly DECISION_TIMEOUT: "DECISION_TIMEOUT";
    readonly DECISION_NOT_FOUND: "DECISION_NOT_FOUND";
    readonly CHANNEL_NOT_CONFIGURED: "CHANNEL_NOT_CONFIGURED";
    readonly CHANNEL_UNREACHABLE: "CHANNEL_UNREACHABLE";
    /** 降级链三级全部无可用输出；诊断明细放在 PetError.details.diagnostics。 */
    readonly FALLBACK_EXHAUSTED: "FALLBACK_EXHAUSTED";
    readonly SETTINGS_MIGRATION_FAILED: "SETTINGS_MIGRATION_FAILED";
};
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
/**
 * 首版最小 fixHint 表：只覆盖 S0–S1 会碰到的通用码 + VAULT / PIPELINE / MODULE 三组。
 * 其余码按阶段补；未收录时由 fixHintOf 给兜底文案。
 */
export declare const ERROR_FIX_HINTS: Readonly<Partial<Record<ErrorCode, string>>>;
export declare function fixHintOf(code: ErrorCode): string;
/**
 * 持久化输出守卫：诊断报告导出、loopback 报文、settings.json、审计日志写盘前调用。
 * 只接受 ErrorCode 中登记的码；字符串字面量或未登记码一律拒绝。
 */
export declare function assertPersistableCode(code: string): asserts code is ErrorCode;
export interface PetErrorOptions {
    cause?: unknown;
    details?: Record<string, unknown>;
}
/** 框架统一异常：code 稳定可判等，message 只用于本机日志。 */
export declare class PetError extends Error {
    readonly code: ErrorCode;
    readonly details: Record<string, unknown>;
    constructor(code: ErrorCode, message?: string, options?: PetErrorOptions);
    toJSON(): {
        code: ErrorCode;
        message: string;
        details: Record<string, unknown>;
    };
}
export declare function isPetError(value: unknown): value is PetError;
/** 把未知异常收敛成 PetError，避免上层到处写 instanceof。 */
export declare function toPetError(value: unknown, fallback?: ErrorCode): PetError;
