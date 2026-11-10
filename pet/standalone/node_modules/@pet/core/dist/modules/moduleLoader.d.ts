import type { IPetalModule } from '@pet/shared';
/**
 * 底层加载方式的唯一标记。
 * 换成真 import() 时只替换 createRegistryModuleLoader，调用方仍只认 load(id)。
 */
export type ModuleSourceKind = 'registry' | 'dynamic-import' | 'worker';
export type ModuleLoaderSource = (id: string) => IPetalModule | Promise<IPetalModule>;
export interface ModuleLoadOptions {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
}
export interface ModuleLoader {
    readonly kind: ModuleSourceKind;
    load(id: string, options?: ModuleLoadOptions): Promise<IPetalModule>;
    /** 是否已加载并持有实例。 */
    has(id: string): boolean;
    /** 已知源 id，供 startAll 这类「还不知道要启谁」的调用方枚举。 */
    ids(): readonly string[];
    /** 已加载实例数。 */
    readonly size: number;
}
export interface RegistryLoaderOptions {
    readonly timeoutMs?: number;
}
/**
 * 注册表式懒加载：静态映射 + 首次实例化，无代码分割。
 * 接口与真 import() 版本保持一致，S3 的 DoD 不依赖打包器。
 */
export declare function createRegistryModuleLoader(sources: Iterable<readonly [string, ModuleLoaderSource]>, options?: RegistryLoaderOptions): ModuleLoader;
