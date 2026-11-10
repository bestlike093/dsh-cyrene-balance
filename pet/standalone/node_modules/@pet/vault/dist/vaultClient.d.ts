import type { BackupResult, CryptoSuiteId, IVault, PairHandle, Sealed, SealMode, VaultFingerprint } from '@pet/shared';
import type { AesGcmProvider } from './crypto/provider.js';
import type { KeyRing } from './crypto/keyRing.js';
import type { VaultStoragePort } from './store/vaultStore.js';
import type { AuditLog } from './audit/auditLog.js';
/**
 * IVault 的 CS1 实现：组合既有 VaultStoragePort / AesGcmProvider / KeyRing。
 * 适配层在 seal/open 内部完成线格式与签名封装，不改 provider 签名。
 */
export declare class VaultClient implements IVault {
    private readonly storage;
    private readonly provider;
    private readonly keys;
    private readonly createdAt;
    private cachedSenderPub;
    private readonly audit?;
    /** 已成功打开过的 (senderPub, nonce)；同一 nonce 再来即视为重放。 */
    private readonly seenNonces;
    constructor(storage: VaultStoragePort, provider: AesGcmProvider, keys: KeyRing, audit?: AuditLog);
    get suite(): CryptoSuiteId;
    get keyEpoch(): number;
    seal(plain: Uint8Array | object, mode: SealMode): Promise<Sealed>;
    open(sealed: Sealed, opts?: {
        readonly allowLegacyEpoch?: boolean;
    }): Promise<Uint8Array>;
    private openInner;
    createEncryptStream(): Promise<TransformStream<Uint8Array, Uint8Array>>;
    createDecryptStream(): Promise<TransformStream<Uint8Array, Uint8Array>>;
    pairStart(): Promise<PairHandle>;
    pairVerify(): Promise<boolean>;
    exportBackup(): Promise<BackupResult>;
    splitSeed(): Promise<readonly string[]>;
    recoverSeed(): Promise<void>;
    rotate(): Promise<{
        readonly from: number;
        readonly to: number;
    }>;
    fingerprint(): VaultFingerprint;
    destroy(): void;
    private sign;
    /**
     * 第一刀只签 cipher；契约注释里的 hlc ‖ seq ‖ id 前置字段等 Ledger 接入后再补。
     */
    private verify;
}
