/** 与 main 里的原实现一致：请求必须是对象，field 为空字符串时按默认字段处理。 */
function serviceArgs(request) {
    if (typeof request !== 'object' || request === null) {
        throw new Error('请求必须是对象');
    }
    const serviceId = String(request.serviceId ?? '');
    const field = typeof request.field === 'string' && request.field.length > 0 ? request.field : undefined;
    return { serviceId, field };
}
export function registerSecretChannels(deps) {
    const register = deps.registerChannel;
    register('pet:secrets:set', async (_event, request) => {
        const { serviceId, field } = serviceArgs(request);
        const value = typeof request?.value === 'string' ? request.value : '';
        if (value.trim().length === 0)
            throw new Error('密钥不能为空');
        // 明文只在本行入参里出现一次；store 内部再 trim 并整文件加密落盘。
        await deps.requireSecretStore().set(serviceId, value.trim(), field);
        deps.onSecretChanged?.(serviceId);
        return { ok: true };
    });
    register('pet:secrets:clear', async (_event, request) => {
        const { serviceId, field } = serviceArgs(request);
        await deps.requireSecretStore().clear(serviceId, field);
        deps.onSecretChanged?.(serviceId);
        return { ok: true };
    });
}
