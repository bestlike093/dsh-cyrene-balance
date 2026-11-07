/**
 * `.petbackup`：跨机器可恢复的 Vault 备份。
 *
 * 只导出「口令封装的明文密钥」和数据文件密文，不导出系统后端（DPAPI 等）
 * 的包裹结果——换机后那些密文解不开。数据文件本身仍是 Vault 密文，
 * 所以备份口令等同于整份备份的钥匙：长度门槛和 PBKDF2 迭代次数都不许降级。
 */
import type { KeyBackend } from '../crypto/keyBackend.js';
import type { VaultKey } from '../crypto/keyRing.js';
import { type SealedBox } from '../crypto/provider.js';
export declare const BACKUP_FORMAT = "pet-vault-backup";
export declare const BACKUP_VERSION = 1;
export declare const BACKUP_KDF_ITERATIONS = 600000;
export declare const BACKUP_MIN_PASSWORD_LENGTH = 8;
/** 建议口令长度，只用于界面提示；门槛仍是 8，避免旧备份突然导不进来。 */
export declare const BACKUP_RECOMMENDED_PASSWORD_LENGTH = 12;
/** 单个条目解包后的上限。正常备份里最大的是聊天历史，远小于这个数。 */
export declare const BACKUP_MAX_FILE_BYTES: number;
/** 全部条目解包后的总量上限，防止一份备份把磁盘写满。 */
export declare const BACKUP_MAX_TOTAL_BYTES: number;
/** 条目数上限：正常备份只有几个固定文件，多出来的都不是正常备份。 */
export declare const BACKUP_MAX_FILES = 64;
export interface BackupFileEntry {
    /** 相对数据目录的文件名，只允许单层名字。 */
    readonly name: string;
    /** 文件原始字节的 base64。 */
    readonly data: string;
}
export interface VaultBackupPayload {
    readonly format: string;
    readonly version: number;
    readonly createdAt: string;
    readonly kdf: {
        readonly name: 'PBKDF2-SHA256';
        readonly iterations: number;
        readonly salt: string;
    };
    readonly sealed: SealedBox;
    readonly files: readonly BackupFileEntry[];
}
export interface RestoredVault {
    readonly keys: readonly VaultKey[];
    readonly signer?: {
        pkcs8: Uint8Array;
        pub: Uint8Array;
    };
    readonly files: readonly {
        name: string;
        data: Uint8Array;
    }[];
}
/** 把密钥环和数据文件封装成可跨机器的备份对象。 */
export declare function createVaultBackup(options: {
    readonly ring: {
        exportKeys(): VaultKey[];
        signer(): Promise<CryptoKeyPair | null>;
    };
    readonly password: string;
    readonly files: readonly {
        name: string;
        data: Uint8Array;
    }[];
    readonly now?: Date;
}): Promise<VaultBackupPayload>;
/** 用口令打开备份；口令错误与文件损坏都统一报 VAULT_TAMPERED，不泄露细节。 */
export declare function openVaultBackup(payload: unknown, password: string): Promise<RestoredVault>;
/**
 * 用恢复出的密钥重写 keys.json：用当前机器的后端重新包裹。
 * 与 FileKeyRing 的落盘逻辑保持一致（先写临时文件再替换）。
 */
export declare function writeRestoredKeyRing(options: {
    readonly path: string;
    readonly backend: KeyBackend;
    readonly suite: string;
    readonly keys: readonly VaultKey[];
    readonly signer?: {
        pkcs8: Uint8Array;
        pub: Uint8Array;
    };
}): Promise<void>;
