import { DEFAULT_SETTINGS, ErrorCode, PetError, migrateSettings } from '@pet/shared'
import type { SettingsV2 } from '@pet/shared'

/** 存储端口：桌面壳用文件实现，测试用内存实现，core 不直接碰 fs。 */
export interface StoragePort {
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
}

export interface SettingsStoreOptions {
  readonly key?: string
  readonly now?: () => number
}

export type SettingsLoadResult =
  | {
      readonly ok: true
      readonly value: SettingsV2
      readonly migrated: boolean
      readonly legacy: Readonly<Record<string, unknown>>
    }
  | { readonly ok: false; readonly error: PetError; readonly value: SettingsV2 }

export type SettingsSaveResult =
  | { readonly ok: true; readonly value: SettingsV2; readonly dropped: readonly string[] }
  | {
      readonly ok: false
      readonly error: PetError
      readonly value: SettingsV2
      /** 失败落在哪一段：迁移没过 / 没写进去 / 写完回读不了 / 回读值和请求对不上。 */
      readonly reason: 'migrate-failed' | 'write-failed' | 'read-back-failed' | 'verify-mismatch'
      /** 请求里有、落盘后没找到或值不等的叶子路径。 */
      readonly dropped: readonly string[]
    }

/** 收集请求里的叶子路径与值；数组和 null 当作叶子。 */
function leafPaths(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix === '' ? [] : [[prefix, value]]
  }
  const out: Array<[string, unknown]> = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.push(...leafPaths(child, prefix === '' ? key : `${prefix}.${key}`))
  }
  return out
}

/** 按点路径取值；中间任何一段缺失都算不存在。 */
function pickPath(root: unknown, path: string): { found: boolean; value?: unknown } {
  let cursor = root
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return { found: false }
    const record = cursor as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return { found: false }
    cursor = record[segment]
  }
  return { found: true, value: cursor }
}

/**
 * 配置存储。
 * 读：解析失败或迁移失败都保留当前内存值，绝不把坏数据写回；
 * 写：先迁移校验，校验通过才落盘，落盘失败也不改内存。
 */
export class SettingsStore {
  private readonly storage: StoragePort
  private readonly key: string
  private current: SettingsV2 = DEFAULT_SETTINGS
  private loaded = false

  constructor(storage: StoragePort, options: SettingsStoreOptions = {}) {
    this.storage = storage
    this.key = options.key ?? 'settings.v2'
    void options.now
  }

  get(): SettingsV2 {
    return this.current
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  async load(): Promise<SettingsLoadResult> {
    let text: string | null
    try {
      text = await this.storage.read(this.key)
    } catch (error) {
      return {
        ok: false,
        error: new PetError(ErrorCode.UNKNOWN, '读取配置失败', { cause: error }),
        value: this.current
      }
    }

    if (text === null || text.trim() === '') {
      this.loaded = true
      return { ok: true, value: this.current, migrated: false, legacy: {} }
    }

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error) {
      return {
        ok: false,
        error: new PetError(ErrorCode.INVALID_ARGUMENT, '配置文件不是合法 JSON', { cause: error }),
        value: this.current
      }
    }

    const migrated = migrateSettings(raw)
    if (!migrated.ok) {
      return { ok: false, error: migrated.error, value: this.current }
    }

    const wasV1 = typeof (raw as { schemaVersion?: unknown }).schemaVersion !== 'number'
    this.current = migrated.value
    this.loaded = true
    return { ok: true, value: this.current, migrated: wasV1, legacy: migrated.legacy }
  }

  /**
   * 保存并回读核对。
   *
   * 写完按请求里的叶子路径回读一次：读不到的、值不等的都进 dropped。
   * dropped 非空说明「以为落住了、其实没落住」，这时 ok=false，
   * 调用方拿到的不是一句乐观的 true，而是一份能指名道姓的差集。
   */
  async save(raw: unknown): Promise<SettingsSaveResult> {
    const migrated = migrateSettings(raw)
    if (!migrated.ok) {
      return {
        ok: false,
        error: migrated.error,
        value: this.current,
        reason: 'migrate-failed',
        dropped: []
      }
    }

    try {
      await this.storage.write(this.key, JSON.stringify(migrated.value))
    } catch (error) {
      return {
        ok: false,
        error: new PetError(ErrorCode.UNKNOWN, '写入配置失败', { cause: error }),
        value: this.current,
        reason: 'write-failed',
        dropped: []
      }
    }

    let persisted: unknown
    try {
      const text = await this.storage.read(this.key)
      persisted = text === null || text.trim() === '' ? null : JSON.parse(text)
    } catch (error) {
      return {
        ok: false,
        error: new PetError(ErrorCode.UNKNOWN, '回读配置失败', { cause: error }),
        value: this.current,
        reason: 'read-back-failed',
        dropped: []
      }
    }

    const dropped: string[] = []
    for (const [path, wanted] of leafPaths(raw)) {
      if (path === 'schemaVersion') continue
      const got = pickPath(persisted, path)
      if (!got.found || JSON.stringify(got.value) !== JSON.stringify(wanted)) dropped.push(path)
    }

    if (dropped.length > 0) {
      return {
        ok: false,
        error: new PetError(ErrorCode.UNKNOWN, `配置未全部落住：${dropped.join(', ')}`),
        value: this.current,
        reason: 'verify-mismatch',
        dropped
      }
    }

    this.current = migrated.value
    this.loaded = true
    return { ok: true, value: this.current, dropped: [] }
  }

  /** 浅合并后走完整校验，避免局部更新绕过 schema。 */
  async update(patch: Partial<SettingsV2>): Promise<SettingsSaveResult> {
    return this.save({ ...this.current, ...patch, schemaVersion: 2 })
  }
}

/** 内存存储：测试与无宿主环境下的默认实现。 */
export class MemoryStorage implements StoragePort {
  private readonly data = new Map<string, string>()

  async read(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }

  async write(key: string, value: string): Promise<void> {
    this.data.set(key, value)
  }

  size(): number {
    return this.data.size
  }
}
