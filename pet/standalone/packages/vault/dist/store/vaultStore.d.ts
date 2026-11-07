import type { CryptoProvider } from '../crypto/provider.js';
export interface VaultStoragePort {
    read(): Promise<string | null>;
    write(text: string): Promise<void>;
    /** 实现应写临时文件再 rename；没有时退回 write */
    writeAtomic?(text: string): Promise<void>;
}
export interface VaultStoreOptions {
    readonly provider?: CryptoProvider;
    readonly now?: () => number;
    readonly iterations?: number;
}
/**
 * 加密仓库：负责锁定状态、口令校验与原子落盘。
 * 所有失败都收敛成稳定错误码，调用方不需要解析底层异常。
 */
export declare class VaultStore {
    private readonly storage;
    private readonly provider;
    private readonly now;
    private readonly iterations;
    private key;
    private salt;
    constructor(storage: VaultStoragePort, options?: VaultStoreOptions);
    get isLocked(): boolean;
    /** 首次没有文件时生成盐；有文件时用文件里的盐派生，顺带验证口令。 */
    unlock(password: string): Promise<void>;
    lock(): void;
    save(data: unknown): Promise<void>;
    load<T = unknown>(): Promise<T | null>;
}
/** 内存存储：测试与无宿主环境的默认实现。 */
export declare class MemoryVaultStorage implements VaultStoragePort {
    private text;
    read(): Promise<string | null>;
    write(text: string): Promise<void>;
    writeAtomic(text: string): Promise<void>;
    raw(): string | null;
    tamper(next: string): void;
}
