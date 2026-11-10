import type { CryptoProvider } from '../crypto/provider.js';
export declare const VAULT_MAGIC: "DSHPET1";
export declare const VAULT_VERSION: 1;
export interface VaultKdf {
    readonly name: 'PBKDF2-SHA256';
    readonly iterations: number;
    /** base64 盐，随文件保存，不需要额外元数据 */
    readonly salt: string;
}
export interface VaultFile {
    readonly magic: typeof VAULT_MAGIC;
    readonly version: typeof VAULT_VERSION;
    readonly suite: string;
    readonly kdf: VaultKdf;
    /** 规范化的头部摘要，解密前先比一次，能挡住头部篡改 */
    readonly aad: string;
    readonly nonce: string;
    readonly ciphertext: string;
    readonly updatedAt: number;
}
export interface VaultHeader {
    readonly suite: string;
    readonly kdf: VaultKdf;
    readonly updatedAt: number;
}
export interface SealOptions {
    readonly salt: Uint8Array;
    readonly iterations?: number;
    readonly updatedAt: number;
}
export declare const DEFAULT_KDF_ITERATIONS = 600000;
export declare function fromBase64(value: string): Uint8Array;
/** AAD 覆盖 magic/version/suite/kdf/updatedAt：任何一项被改都会导致解密失败。 */
export declare function canonicalAad(header: VaultHeader): string;
export declare function parseVaultFile(raw: unknown): VaultFile;
export declare function sealVaultFile(provider: CryptoProvider, key: Uint8Array, plaintext: Uint8Array, options: SealOptions): Promise<VaultFile>;
export declare function openVaultFile(provider: CryptoProvider, key: Uint8Array, file: VaultFile): Promise<Uint8Array>;
export declare function serializeVaultFile(file: VaultFile): string;
