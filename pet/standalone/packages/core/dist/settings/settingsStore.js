import { DEFAULT_SETTINGS, ErrorCode, PetError, migrateSettings } from '@pet/shared';
/**
 * 配置存储。
 * 读：解析失败或迁移失败都保留当前内存值，绝不把坏数据写回；
 * 写：先迁移校验，校验通过才落盘，落盘失败也不改内存。
 */
export class SettingsStore {
    storage;
    key;
    current = DEFAULT_SETTINGS;
    loaded = false;
    constructor(storage, options = {}) {
        this.storage = storage;
        this.key = options.key ?? 'settings.v2';
        void options.now;
    }
    get() {
        return this.current;
    }
    get isLoaded() {
        return this.loaded;
    }
    async load() {
        let text;
        try {
            text = await this.storage.read(this.key);
        }
        catch (error) {
            return {
                ok: false,
                error: new PetError(ErrorCode.UNKNOWN, '读取配置失败', { cause: error }),
                value: this.current
            };
        }
        if (text === null || text.trim() === '') {
            this.loaded = true;
            return { ok: true, value: this.current, migrated: false, legacy: {} };
        }
        let raw;
        try {
            raw = JSON.parse(text);
        }
        catch (error) {
            return {
                ok: false,
                error: new PetError(ErrorCode.INVALID_ARGUMENT, '配置文件不是合法 JSON', { cause: error }),
                value: this.current
            };
        }
        const migrated = migrateSettings(raw);
        if (!migrated.ok) {
            return { ok: false, error: migrated.error, value: this.current };
        }
        const wasV1 = typeof raw.schemaVersion !== 'number';
        this.current = migrated.value;
        this.loaded = true;
        return { ok: true, value: this.current, migrated: wasV1, legacy: migrated.legacy };
    }
    async save(raw) {
        const migrated = migrateSettings(raw);
        if (!migrated.ok) {
            return { ok: false, error: migrated.error, value: this.current };
        }
        try {
            await this.storage.write(this.key, JSON.stringify(migrated.value));
        }
        catch (error) {
            return {
                ok: false,
                error: new PetError(ErrorCode.UNKNOWN, '写入配置失败', { cause: error }),
                value: this.current
            };
        }
        this.current = migrated.value;
        this.loaded = true;
        return { ok: true, value: this.current };
    }
    /** 浅合并后走完整校验，避免局部更新绕过 schema。 */
    async update(patch) {
        return this.save({ ...this.current, ...patch, schemaVersion: 2 });
    }
}
/** 内存存储：测试与无宿主环境下的默认实现。 */
export class MemoryStorage {
    data = new Map();
    async read(key) {
        return this.data.get(key) ?? null;
    }
    async write(key, value) {
        this.data.set(key, value);
    }
    size() {
        return this.data.size;
    }
}
