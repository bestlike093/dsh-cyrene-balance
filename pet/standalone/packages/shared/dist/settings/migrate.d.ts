import { PetError } from '../errors.js';
import type { SettingsV2 } from '../types/settings.js';
/** 迁移结果：成功时带 v2 全量与未被 schema 接管的旧字段，失败时带稳定错误码。 */
export type SettingsMigration = {
    readonly ok: true;
    readonly value: SettingsV2;
    /** v1 里存在、但 v2 schema 不再使用的字段。调用方可原样保留，避免丢用户数据。 */
    readonly legacy: Readonly<Record<string, unknown>>;
} | {
    readonly ok: false;
    readonly error: PetError;
};
/**
 * 唯一入口：按 schemaVersion 分派。
 * 纯函数，不读写磁盘；失败时调用方保持旧配置即可完成回滚。
 */
export declare function migrateSettings(raw: unknown): SettingsMigration;
/** 便捷包装：失败直接抛 PetError，适合调用方已经准备好回滚路径的场景。 */
export declare function migrateSettingsOrThrow(raw: unknown): {
    value: SettingsV2;
    legacy: Readonly<Record<string, unknown>>;
};
