import type { IPetalModule, ModuleConfig } from '@pet/shared';
export interface PetalEntry {
    readonly module: IPetalModule;
    readonly config: ModuleConfig;
}
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
export declare function assertModuleShape(value: unknown): asserts value is IPetalModule;
export declare function defaultModuleConfig(module: IPetalModule): ModuleConfig;
/** 模块注册表：只负责身份与配置，不执行生命周期。 */
export declare class PetalRegistry {
    private readonly entries;
    register(module: IPetalModule, config?: Partial<ModuleConfig>): () => void;
    unregister(id: string): boolean;
    get(id: string): PetalEntry | undefined;
    has(id: string): boolean;
    list(): readonly (PetalEntry & {
        readonly id: string;
    })[];
    get size(): number;
}
