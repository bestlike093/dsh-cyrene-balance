/** 统一错误码。跨进程 / 跨端传递时只传 code，不传含敏感信息的 message。 */
export const ErrorCode = {
    UNKNOWN: 'UNKNOWN',
    INVALID_ARGUMENT: 'INVALID_ARGUMENT',
    NOT_SUPPORTED: 'NOT_SUPPORTED',
    /** 目标对象尚未注册或尚未应用；调用方先完成初始化，不当作真实故障。 */
    NOT_REGISTERED: 'NOT_REGISTERED',
    /** 目标阶段尚未实现；调用方据此走降级，不当作真实故障。 */
    NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    LOAD_FAILED: 'LOAD_FAILED',
    LOAD_TIMEOUT: 'LOAD_TIMEOUT',
    MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
    MODEL_NOT_RENDERABLE: 'MODEL_NOT_RENDERABLE',
    ASSET_INVALID_MAGIC: 'ASSET_INVALID_MAGIC',
    MIME_MISMATCH: 'MIME_MISMATCH',
    PATH_TRAVERSAL: 'PATH_TRAVERSAL',
    ZIP_BOMB: 'ZIP_BOMB',
    /** 压缩包内出现可执行 / 可注入的类型（.js/.html/.svg/.exe/.dll）。 */
    ASSET_FORBIDDEN_TYPE: 'ASSET_FORBIDDEN_TYPE',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    VAULT_LOCKED: 'VAULT_LOCKED',
    VAULT_TAMPERED: 'VAULT_TAMPERED',
    SIGNATURE_INVALID: 'SIGNATURE_INVALID',
    REPLAY_DETECTED: 'REPLAY_DETECTED',
    TIMESTAMP_EXPIRED: 'TIMESTAMP_EXPIRED',
    NONCE_REUSE: 'NONCE_REUSE',
    KEY_PERMISSION: 'KEY_PERMISSION',
    CRYPTO_SUITE_UNSUPPORTED: 'CRYPTO_SUITE_UNSUPPORTED',
    SYNC_GAP_DETECTED: 'SYNC_GAP_DETECTED',
    SYNC_DIVERGED: 'SYNC_DIVERGED',
    MEMORY_NOT_FOUND: 'MEMORY_NOT_FOUND',
    DECISION_TIMEOUT: 'DECISION_TIMEOUT',
    DECISION_NOT_FOUND: 'DECISION_NOT_FOUND',
    CHANNEL_NOT_CONFIGURED: 'CHANNEL_NOT_CONFIGURED',
    CHANNEL_UNREACHABLE: 'CHANNEL_UNREACHABLE',
    /** 降级链三级全部无可用输出；诊断明细放在 PetError.details.diagnostics。 */
    FALLBACK_EXHAUSTED: 'FALLBACK_EXHAUSTED',
    SETTINGS_MIGRATION_FAILED: 'SETTINGS_MIGRATION_FAILED'
};
/**
 * 首版最小 fixHint 表：只覆盖 S0–S1 会碰到的通用码 + VAULT / PIPELINE / MODULE 三组。
 * 其余码按阶段补；未收录时由 fixHintOf 给兜底文案。
 */
export const ERROR_FIX_HINTS = {
    NOT_IMPLEMENTED: '该能力属于后续阶段，先走降级分支，不要当故障上报。',
    PERMISSION_DENIED: '缺少所需权限：到权限面板授予后重试。',
    NONCE_REUSE: 'Nonce 被重复使用：检查发送端计数与缓存。',
    KEY_PERMISSION: '密钥文件权限过宽：收紧到仅当前用户可读写。',
    VAULT_LOCKED: '保险库已锁定：先解锁，或确认系统钥匙串可用。',
    VAULT_TAMPERED: '本地数据校验失败：停止读取，从备份恢复或重新初始化密钥。',
    SIGNATURE_INVALID: '签名不匹配：核对设备公钥与签名来源。',
    REPLAY_DETECTED: '检测到重放：检查序号与时间窗。',
    TIMESTAMP_EXPIRED: '报文已过期：校准时钟后重试。',
    CRYPTO_SUITE_UNSUPPORTED: '算法套件不支持：切到首版支持的 suite。',
    ASSET_INVALID_MAGIC: '文件头与扩展名不符：确认文件未损坏。',
    MIME_MISMATCH: '扩展名与文件头不一致：确认文件未被改后缀。',
    PATH_TRAVERSAL: '路径越出资源根目录：拒绝该相对路径。',
    ZIP_BOMB: '压缩包解压后体积异常：中止解压并隔离文件。',
    ASSET_FORBIDDEN_TYPE: '压缩包含可执行或可注入类型：拒绝入库，勿放行 .js/.html/.svg。',
    QUOTA_EXCEEDED: '资源配额已用尽：清理旧资源或调高上限。',
    LOAD_FAILED: '模块加载失败：看模块日志，确认入口与依赖。',
    LOAD_TIMEOUT: '模块加载超时：检查阻塞调用，必要时降级。',
    FALLBACK_EXHAUSTED: '降级链已耗尽：确认本地规则引擎已注入、预置池非空；诊断明细见异常 details。'
};
export function fixHintOf(code) {
    return ERROR_FIX_HINTS[code] ?? '查看日志中的 code 与 details，按阶段文档处理。';
}
/**
 * 持久化输出白名单：直接派生自码表，禁止手抄第二份清单。
 * 码表扩到 S2 媒体、S6 网关时，这里自动跟上。
 */
const PERSISTABLE_CODES = new Set(Object.values(ErrorCode));
/**
 * 持久化输出守卫：诊断报告导出、loopback 报文、settings.json、审计日志写盘前调用。
 * 只接受 ErrorCode 中登记的码；字符串字面量或未登记码一律拒绝。
 */
export function assertPersistableCode(code) {
    if (!PERSISTABLE_CODES.has(code)) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `code 未登记在 ErrorCode 中：${code}`, {
            details: { code }
        });
    }
}
/** 框架统一异常：code 稳定可判等，message 只用于本机日志。 */
export class PetError extends Error {
    code;
    details;
    constructor(code, message, options = {}) {
        super(message ?? code, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = 'PetError';
        this.code = code;
        this.details = options.details ?? {};
    }
    toJSON() {
        return { code: this.code, message: this.message, details: this.details };
    }
}
export function isPetError(value) {
    return value instanceof PetError;
}
/** 把未知异常收敛成 PetError，避免上层到处写 instanceof。 */
export function toPetError(value, fallback = ErrorCode.UNKNOWN) {
    if (value instanceof PetError)
        return value;
    if (value instanceof Error) {
        return new PetError(fallback, value.message, { cause: value });
    }
    return new PetError(fallback, String(value));
}
//# sourceMappingURL=errors.js.map