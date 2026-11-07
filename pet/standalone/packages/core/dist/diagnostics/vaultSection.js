export const VAULT_SECTION = 'vault';
export const VAULT_SECTION_LABEL = '密钥与凭据';
export function toVaultSection(diagnostic) {
    return {
        ok: diagnostic.severity !== 'error',
        level: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        data: {
            kind: diagnostic.kind ?? 'secure',
            group: diagnostic.group ?? 'credential',
            severity: diagnostic.severity,
            acknowledged: diagnostic.acknowledged ?? false,
            ...(diagnostic.backend === undefined ? {} : { backend: diagnostic.backend }),
            ...(diagnostic.secure === undefined ? {} : { secure: diagnostic.secure }),
            ...(diagnostic.permission === undefined ? {} : { permission: diagnostic.permission }),
            ...(diagnostic.recoveredFrom === undefined ? {} : { recoveredFrom: diagnostic.recoveredFrom })
        }
    };
}
export function toVaultPanelRow(diagnostic) {
    const detail = [
        diagnostic.code,
        diagnostic.backend === undefined ? undefined : `backend=${diagnostic.backend}`,
        diagnostic.secure === undefined ? undefined : `secure=${String(diagnostic.secure)}`,
        diagnostic.permission === undefined ? undefined : `permission=${diagnostic.permission}`,
        `severity=${diagnostic.severity}`,
        diagnostic.message,
        diagnostic.acknowledged === true ? '（已确认）' : undefined
    ]
        .filter((part) => part !== undefined)
        .join(' · ');
    return {
        id: VAULT_SECTION,
        label: VAULT_SECTION_LABEL,
        level: diagnostic.severity,
        detail
    };
}
/**
 * 把 S1 的 diagnose() 接进诊断聚合器。
 * 返回注销函数；重复注册同名数据源会覆盖旧来源。
 */
export function registerVaultDiagnostics(diagnostics, source) {
    return diagnostics.registerSection(VAULT_SECTION, async () => toVaultSection(await source.diagnose()));
}
