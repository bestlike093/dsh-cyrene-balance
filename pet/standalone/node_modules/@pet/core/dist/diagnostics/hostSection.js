export const HOST_SECTION = 'host';
export const HOST_SECTION_LABEL = '宿主能力';
/**
 * 能力来源必须在诊断里写明。
 * 声明值只是占位，不能让「自动探测不可用」看起来像正常状态。
 */
export function toHostSection(resolution) {
    const data = {
        source: resolution.source,
        version: resolution.snapshot.version,
        available: resolution.snapshot.available.join(',') || 'none'
    };
    if (resolution.source === 'detected') {
        return { ok: true, level: 'ok', code: 'HOST_DETECTED', message: '自动探测可用', data };
    }
    if (resolution.source === 'declared') {
        return {
            ok: true,
            level: 'warn',
            code: 'HOST_DECLARED',
            message: '自动探测不可用，使用声明值',
            data
        };
    }
    return {
        ok: false,
        level: 'error',
        code: 'HOST_UNKNOWN',
        message: '自动探测不可用，且没有声明值，已全部降级',
        data
    };
}
/** 注册到诊断聚合器；传 getter 可在真机探测结果更新后重新取值。 */
export function registerHostDiagnostics(diagnostics, resolution) {
    return diagnostics.registerSection(HOST_SECTION, async () => toHostSection(typeof resolution === 'function' ? resolution() : resolution));
}
