/**
 * 用系统钥匙串那一套（FileKeyRing）承载的加密仓库。
 *
 * 与 `VaultStore` 的分工：
 * - `VaultStore` 用口令派生密钥，适合「需要跨设备」或「不想依赖系统钥匙串」的场景
 * - `KeyRingVaultStore` 用 FileKeyRing 的数据密钥，开机即可用，不需要用户输口令
 *
 * 两者实现同一个 `VaultLike`，上层的 `ServiceSecretStore` / `LlmSecretStore`
 * 不需要知道自己拿到的是哪一套。
 */
import type { VaultClient } from '../vaultClient.js';
import type { VaultStoragePort } from './vaultStore.js';
/** 加密仓库需要的最小能力。上层只依赖这两个方法。 */
export interface VaultLike {
    load<T = unknown>(): Promise<T | null>;
    save(data: unknown): Promise<void>;
}
export interface KeyRingVaultStoreOptions {
    readonly client: VaultClient;
    readonly storage: VaultStoragePort;
}
export declare class KeyRingVaultStore implements VaultLike {
    private readonly client;
    private readonly storage;
    private cached;
    private loaded;
    constructor(options: KeyRingVaultStoreOptions);
    /**
     * 同一份密文不能反复 open：`VaultClient` 把重复 nonce 当成重放。
     * 所以第一次解开后留在内存里，之后直接返回。
     */
    load<T = unknown>(): Promise<T | null>;
    save(data: unknown): Promise<void>;
    /** 外部改过文件时调用；下次 load 会重新读盘解密。 */
    invalidate(): void;
}
