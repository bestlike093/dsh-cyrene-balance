export interface SealedBox {
    /** 套件编号，解密时据此选 provider，不信任数据自报 */
    readonly suite: string;
    /** 12/24 字节随机 nonce，base64 */
    readonly nonce: string;
    /** 密文 + tag，base64 */
    readonly ciphertext: string;
}
/** 加密套件契约。切套件只换实现，不动 vault 上层。 */
export interface CryptoProvider {
    readonly suite: string;
    /** 运行时可用性探测：后端缺失时返回 false，由调用方降级 */
    available(): Promise<boolean>;
    deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array>;
    seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<SealedBox>;
    open(key: Uint8Array, box: SealedBox, aad: Uint8Array): Promise<Uint8Array>;
}
export declare const SUITE_CS1: "CS1";
export declare const SUITE_CS2: "CS2";
/** CS1：AES-256-GCM，纯 WebCrypto，零依赖。 */
export declare class AesGcmProvider implements CryptoProvider {
    readonly suite: "CS1";
    private cached;
    private cachedRaw;
    available(): Promise<boolean>;
    deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array>;
    private key;
    seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<SealedBox>;
    open(key: Uint8Array, box: SealedBox, aad: Uint8Array): Promise<Uint8Array>;
}
