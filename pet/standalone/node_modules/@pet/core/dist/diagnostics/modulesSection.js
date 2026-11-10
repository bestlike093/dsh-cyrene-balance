export const MODULES_SECTION = 'modules';
/**
 * 模块生命周期诊断行。
 *
 * 状态直接读 ModuleHost.statuses()，不在别处缓存一份。
 * 两处各存一份状态，迟早会各说各话。
 */
export function toModulesSection(statuses, service) {
    const failed = statuses.filter((runtime) => runtime.status === 'failed');
    const degraded = statuses.filter((runtime) => runtime.status === 'degraded');
    const stopped = service?.state === 'stopped';
    // 降级不是故障：把 degraded 记成 error，纯插件形态下面板会长期红着，红色就失去意义。
    // 停服则必须红：它意味着整套服务已经不可用。
    const level = stopped || failed.length > 0 ? 'error' : degraded.length > 0 ? 'warn' : 'ok';
    return {
        ok: level !== 'error',
        level,
        data: {
            group: 'modules',
            kind: 'lifecycle',
            total: statuses.length,
            states: statuses.map((runtime) => `${runtime.id}=${runtime.status}`).join(', '),
            service: service?.state ?? 'running',
            // 复制的诊断文本要能直接定位：带上是哪个模块、什么错误码。
            stopReason: service?.reason === undefined ? '' : `${service.reason.moduleId}: ${service.reason.code}`
        }
    };
}
/** 把模块状态接进诊断聚合器；每次 collect 都重新读宿主，保证与实际状态同源。 */
export function registerModuleDiagnostics(diagnostics, host) {
    return diagnostics.registerSection(MODULES_SECTION, async () => toModulesSection(host.statuses(), {
        state: host.serviceState,
        ...(host.stopReason === undefined ? {} : { reason: host.stopReason })
    }));
}
