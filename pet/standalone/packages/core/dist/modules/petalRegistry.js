import { ALL_PERMISSIONS, ErrorCode, PetError } from '@pet/shared';
/**
 * 运行期形状校验。
 *
 * 类型系统拦不住动态加载进来的东西。第三方 bundle 常见的错法是返回
 * `{ inject, Page }` 这种「自己发明的形状」，此时 `module.meta` 是 undefined，
 * 下一条 `module.meta.id` 会抛 TypeError，栈里只有一句
 * `Cannot read properties of undefined`，看不出是插件写错了。
 *
 * 这里一次性把必须存在的字段验完，抛带字段名的 PetError，
 * 让宿主能把它记成「这个模块形状不对」而不是「加载失败」。
 */
export function assertModuleShape(value) {
    if (typeof value !== 'object' || value === null) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `模块形状不对：期望对象，收到 ${value === null ? 'null' : typeof value}`);
    }
    const candidate = value;
    const meta = candidate.meta;
    if (typeof meta !== 'object' || meta === null) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '模块形状不对：缺少 meta（期望 { id, name, version, permissions, ... }）');
    }
    const { id, name } = meta;
    if (typeof id !== 'string' || id.length === 0) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '模块形状不对：meta.id 必须是非空字符串');
    }
    if (typeof name !== 'string' || name.length === 0) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `模块形状不对：${id} 的 meta.name 必须是非空字符串`);
    }
    // permissions 是宿主启动路径直接读的字段，缺了会让 start 抛 TypeError。
    // 在这里拦下，坏模块连注册表都进不去。
    const permissions = meta.permissions;
    if (!Array.isArray(permissions)) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `模块形状不对：${id} 的 meta.permissions 必须是数组`);
    }
    const unknown = permissions.filter((permission) => typeof permission !== 'string' ||
        !ALL_PERMISSIONS.includes(permission));
    if (unknown.length > 0) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `模块形状不对：${id} 的 meta.permissions 含未知权限：${unknown.join(', ')}`);
    }
    if (typeof candidate.bootstrap !== 'function') {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `模块形状不对：${id} 缺少 bootstrap 方法`);
    }
    if (typeof candidate.teardown !== 'function') {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `模块形状不对：${id} 缺少 teardown 方法`);
    }
}
export function defaultModuleConfig(module) {
    return {
        enabled: true,
        granted: module.meta.permissions ?? [],
        options: {}
    };
}
/** 模块注册表：只负责身份与配置，不执行生命周期。 */
export class PetalRegistry {
    entries = new Map();
    register(module, config) {
        assertModuleShape(module);
        const id = module.meta.id;
        if (typeof id !== 'string' || id.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '模块缺少 id');
        }
        if (this.entries.has(id)) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, `模块已注册：${id}`);
        }
        const base = defaultModuleConfig(module);
        this.entries.set(id, {
            module,
            config: {
                enabled: config?.enabled ?? base.enabled,
                granted: config?.granted ?? base.granted,
                options: config?.options ?? base.options
            }
        });
        return () => {
            this.unregister(id);
        };
    }
    unregister(id) {
        return this.entries.delete(id);
    }
    get(id) {
        return this.entries.get(id);
    }
    has(id) {
        return this.entries.has(id);
    }
    list() {
        return [...this.entries.entries()].map(([id, entry]) => ({ id, ...entry }));
    }
    get size() {
        return this.entries.size;
    }
}
