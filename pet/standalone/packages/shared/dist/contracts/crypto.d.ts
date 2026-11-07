/**
 * v2.1 密码与跨端契约（文档第 8–10 章、附录 A.9/A.10）。
 * 只定义结构，不实现算法；实现分别落在 packages/vault 与后续 interop 模块。
 */
export type CryptoSuiteId = 'CS1' | 'CS2' | 'CS3';
export interface SuiteSpec {
    readonly id: CryptoSuiteId;
    readonly kem: 'X25519' | 'DHKEM-X25519' | 'MLKEM768-X25519';
    readonly aead: 'AES-256-GCM' | 'XChaCha20-Poly1305';
    readonly mac: 'HMAC-SHA256' | 'BLAKE3-keyed';
    readonly kdf: 'HKDF-SHA256';
    readonly sign: 'Ed25519';
    readonly hash: 'SHA-256' | 'BLAKE3';
}
export declare const SUITES: Readonly<Record<CryptoSuiteId, SuiteSpec>>;
/** 协商优先级：高在前。无交集时必须报错，禁止降级明文。 */
export declare const CRYPTO_SUITE_ORDER: readonly CryptoSuiteId[];
export interface CipherHeader {
    readonly ver: 2;
    readonly cs: CryptoSuiteId;
    readonly keyId: number;
    /** 12B（GCM）或 24B（XChaCha） */
    readonly nonce: Uint8Array;
    readonly ct: Uint8Array;
    readonly tag: Uint8Array;
}
export type SealMode = {
    readonly kind: 'envelope';
} | {
    readonly kind: 'stream';
    readonly chunkSize: number;
} | {
    readonly kind: 'sealed-box';
    readonly recipientPk: Uint8Array;
} | {
    readonly kind: 'hpke';
    readonly recipientPk: Uint8Array;
    readonly info?: Uint8Array;
} | {
    readonly kind: 'age';
    readonly recipients: readonly string[];
    readonly armor: boolean;
};
/** 上层消息封装。底层 AEAD 输出仍叫 SealedBox，二者不是同一层。 */
export interface Sealed {
    /** base64url(ver ‖ cs ‖ keyId ‖ nonce ‖ ct ‖ tag) */
    readonly cipher: string;
    /** base64url Ed25519(hlc ‖ seq ‖ id ‖ cipher) */
    readonly sig: string;
    readonly senderPub: string;
    readonly keyEpoch: number;
}
export interface PairHandle {
    /** 7 个 emoji 的 SAS 材料，由共享密钥派生 */
    readonly sas: readonly string[];
    readonly commit: () => Promise<void>;
}
export interface VaultFingerprint {
    readonly pkFingerprint: string;
    readonly createdAt: number;
    readonly lastRotation: number;
}
export interface BackupResult {
    readonly bytes: number;
    readonly hash: string;
}
export interface IVault {
    readonly suite: CryptoSuiteId;
    readonly keyEpoch: number;
    /** 短数据与消息 */
    seal(plain: Uint8Array | object, mode: SealMode): Promise<Sealed>;
    open(sealed: Sealed, opts?: {
        readonly allowLegacyEpoch?: boolean;
    }): Promise<Uint8Array>;
    /** 大文件分块 */
    createEncryptStream(mode: Extract<SealMode, {
        kind: 'stream';
    }>): Promise<TransformStream<Uint8Array, Uint8Array>>;
    createDecryptStream(header: Uint8Array): Promise<TransformStream<Uint8Array, Uint8Array>>;
    /** PAKE 配对；共享密钥只以句柄形式存在，不暴露原始字节 */
    pairStart(shortCode: string): Promise<PairHandle>;
    pairVerify(remoteSas: readonly string[]): Promise<boolean>;
    exportBackup(recipients: readonly string[], path: string): Promise<BackupResult>;
    splitSeed(shares: number, threshold: number): Promise<readonly string[]>;
    recoverSeed(shares: readonly string[]): Promise<void>;
    rotate(reason: 'scheduled' | 'manual' | 'revocation'): Promise<{
        readonly from: number;
        readonly to: number;
    }>;
    fingerprint(): VaultFingerprint;
    /** 清零全部内存密钥 */
    destroy(): void;
}
export type LedgerEntryType = 'envelope' | 'memory' | 'revocation' | 'checkpoint' | 'tombstone';
export interface LedgerEntry {
    readonly seq: number;
    /** 定长 hex，可直接按字典序比较 */
    readonly hlc: string;
    readonly deviceId: string;
    readonly type: LedgerEntryType;
    readonly payloadHash: string;
    readonly payloadCipher?: string;
    readonly parentSeq: number;
    readonly sig: string;
}
export interface SyncDigest {
    readonly deviceId: string;
    readonly ledgerLength: number;
    readonly merkleRoot: string;
    readonly headHlc: string;
    readonly keyEpoch: number;
    readonly auditRoot: string;
}
export type ConsistencyLevel = 'consistent' | 'converging' | 'divergent';
export declare const CONSISTENCY_LEVELS: readonly ConsistencyLevel[];
export interface InteropReport {
    readonly peerId: string;
    readonly level: ConsistencyLevel;
    readonly local: SyncDigest;
    readonly remote: SyncDigest;
    readonly firstDivergentSeq?: number;
    readonly missingRanges?: readonly (readonly [number, number])[];
    readonly probeRttMs?: number;
    readonly echoVerified: boolean;
    readonly hlcMonotonic: boolean;
    readonly checkedAt: number;
}
export type Capability = 'approval' | 'question' | 'memory-sync' | 'rich-card';
export interface Hello {
    readonly v: 2;
    readonly deviceId: string;
    readonly appVersion: string;
    /** 按本端优先级排序 */
    readonly suites: readonly CryptoSuiteId[];
    readonly ledgerLength: number;
    readonly merkleRoot: string;
    readonly headHlc: string;
    readonly keyEpoch: number;
    readonly capabilities: readonly Capability[];
    readonly sig: string;
}
export interface IInteropChecker {
    hello(): Promise<Hello>;
    probe(peerId: string): Promise<InteropReport>;
    reconcile(peerId: string): Promise<{
        readonly pulled: number;
        readonly newRoot: string;
    }>;
    /** Merkle 二分定位首个分歧块 */
    locateDivergence(local: SyncDigest, remote: SyncDigest): Promise<number | null>;
}
export interface TrustedPeer {
    readonly deviceId: string;
    readonly dskPub: string;
    readonly verifiedAt: number;
    readonly priority: number;
    readonly revoked?: boolean;
}
export interface IDeviceIdentity {
    readonly deviceId: string;
    dskPub(): Uint8Array;
    /** USK 对设备密钥做交叉签名 */
    signDeviceKey(pub: Uint8Array, label: string): Promise<string>;
    revoke(deviceId: string, reason: string): Promise<void>;
    listTrusted(): readonly TrustedPeer[];
}
/**
 * 能力协商：取交集里优先级最高者；无交集返回 null，由调用方报错。
 * 放在契约层，避免两端各写一套顺序。
 */
export declare function negotiateSuite(local: readonly CryptoSuiteId[], remote: readonly CryptoSuiteId[]): CryptoSuiteId | null;
