export type KeyBackendKind = 'safeStorage' | 'passphrase' | 'memory';
/**
 * 密钥后端：只负责把 32B 数据密钥包成密文，不碰线格式。
 * `secure=false` 表示后端不提供真实保护（CI memory / Linux basic_text）。
 */
export interface KeyBackend {
    readonly kind: KeyBackendKind;
    readonly secure: boolean;
    wrap(plain: Uint8Array): Promise<Uint8Array>;
    unwrap(wrapped: Uint8Array): Promise<Uint8Array>;
}
export interface SafeStorageLike {
    isEncryptionAvailable(): boolean;
    getSelectedStorageBackend?(): string;
    encryptString(plain: string): Uint8Array;
    decryptString(encrypted: Uint8Array): string;
}
/**
 * Electron safeStorage 后端。
 * Linux `basic_text` 后端意味着密文实际不受保护，`secure` 会置 false，
 * 调用方必须据此告警并记录审计，禁止静默降级。
 */
export declare function createSafeStorageBackend(storage: SafeStorageLike): KeyBackend;
/**
 * 系统密钥后端。没有可用系统后端时必须明确失败：
 * memory 只能显式注入，禁止成为默认值，否则生产路径会在每次重启时静默丢密钥。
 */
export declare function createSystemKeyBackend(safeStorage?: SafeStorageLike): Promise<KeyBackend>;
/**
 * 进程内后端：用一次性 AES-GCM 密钥包裹，仅用于 CI / 单测。
 * 进程重启后无法解开旧文件，因此 `secure=false`，不得作为生产默认。
 */
export declare function createMemoryBackend(): Promise<KeyBackend>;
