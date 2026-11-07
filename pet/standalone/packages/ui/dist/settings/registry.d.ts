/**
 * 设置字段注册表
 *
 * 三条硬约束：
 * 1. 重复 id 必须抛错（静默覆盖 = 字段丢失无人知晓）
 * 2. list() 顺序确定（先分组 order、再字段 order、再 id），不依赖注册顺序
 * 3. unregister 必须真的移除（注册了删不掉 = 泄漏）
 */
import type { SettingsFieldV1, SettingsGroupV1 } from './types.js';
export declare class SettingsRegistryV1 {
    #private;
    registerGroup(g: SettingsGroupV1): void;
    unregisterGroup(id: string): void;
    register(f: SettingsFieldV1): void;
    unregister(id: string): void;
    get(id: string): SettingsFieldV1 | undefined;
    list(): readonly SettingsFieldV1[];
    listGroups(): readonly SettingsGroupV1[];
    /** 按分组归类，分组顺序与组内顺序都确定 */
    grouped(): readonly {
        readonly group: SettingsGroupV1;
        readonly fields: readonly SettingsFieldV1[];
    }[];
}
