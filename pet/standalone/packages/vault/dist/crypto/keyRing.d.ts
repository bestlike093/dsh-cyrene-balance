import type { CryptoSuiteId } from '@pet/shared';
/** 单个密钥版本。keyId 写进线格式，epoch 用于轮换判定。 */
export interface VaultKey {
    readonly keyId: number;
    readonly epoch: number;
    readonly key: Uint8Array;
}
/** 密钥环：VaultClient 只通过它取密钥，不直接碰存储。 */
export interface KeyRing {
    readonly suite: CryptoSuiteId;
    current(): VaultKey;
    byId(keyId: number): VaultKey | undefined;
    /** Ed25519 签名密钥对，用于产出 Sealed.sig */
    signer(): Promise<CryptoKeyPair>;
    /** base64url(raw 32B Ed25519 公钥) */
    senderPub(): Promise<string>;
    rotate(): Promise<void>;
    destroy(): void;
}
export declare function toBase64Url(bytes: Uint8Array): string;
/**
 * 进程内临时密钥环：S1 第一刀用，密钥随实例销毁。
 * 落盘密钥后端在 S1 第 6 步接，届时只换这个实现，VaultClient 不动。
 */
export declare function createEphemeralKeyRing(suite?: CryptoSuiteId): KeyRing;
