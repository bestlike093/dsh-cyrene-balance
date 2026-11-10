import { PetError } from '@pet/shared';
import type { SettingsV2 } from '@pet/shared';
/** 存储端口：桌面壳用文件实现，测试用内存实现，core 不直接碰 fs。 */
export interface StoragePort {
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
}
export interface SettingsStoreOptions {
    readonly key?: string;
    readonly now?: () => number;
}
export type SettingsLoadResult = {
    readonly ok: true;
    readonly value: SettingsV2;
    readonly migrated: boolean;
    readonly legacy: Readonly<Record<string, unknown>>;
} | {
    readonly ok: false;
    readonly error: PetError;
    readonly value: SettingsV2;
};
export type SettingsSaveResult = {
    readonly ok: true;
    readonly value: SettingsV2;
} | {
    readonly ok: false;
    readonly error: PetError;
    readonly value: SettingsV2;
};
/**
 * 配置存储。
 * 读：解析失败或迁移失败都保留当前内存值，绝不把坏数据写回；
 * 写：先迁移校验，校验通过才落盘，落盘失败也不改内存。
 */
export declare class SettingsStore {
    private readonly storage;
    private readonly key;
    private current;
    private loaded;
    constructor(storage: StoragePort, options?: SettingsStoreOptions);
    get(): SettingsV2;
    get isLoaded(): boolean;
    load(): Promise<SettingsLoadResult>;
    save(raw: unknown): Promise<SettingsSaveResult>;
    /** 浅合并后走完整校验，避免局部更新绕过 schema。 */
    update(patch: Partial<SettingsV2>): Promise<SettingsSaveResult>;
}
/** 内存存储：测试与无宿主环境下的默认实现。 */
export declare class MemoryStorage implements StoragePort {
    private readonly data;
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
    size(): number;
}
