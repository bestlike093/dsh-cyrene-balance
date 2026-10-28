import { ErrorCode, PetError } from '../_shared/index.js';
export const SUITE_CS1 = 'CS1';
export const SUITE_CS2 = 'CS2';
function webcrypto() {
    const g = globalThis;
    if (g.crypto === undefined) {
        throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, '当前运行时没有 WebCrypto');
    }
    return g.crypto;
}
/**
 * TS 5.7 起 WebCrypto 的 BufferSource 只接受 ArrayBuffer 背后的视图，
 * 而 Uint8Array 默认泛型是 ArrayBufferLike（可能是 SharedArrayBuffer）。
 * 统一复制进新的 ArrayBuffer，既满足类型也避免调用方共享内存被篡改。
 */
function toArrayBuffer(bytes) {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
}
function toBase64(bytes) {
    let bin = '';
    for (const byte of bytes)
        bin += String.fromCharCode(byte);
    return btoa(bin);
}
function fromBase64(value) {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** CS1：AES-256-GCM，纯 WebCrypto，零依赖。 */
export class AesGcmProvider {
    suite = SUITE_CS1;
    cached = null;
    cachedRaw = null;
    async available() {
        try {
            return webcrypto().subtle !== undefined;
        }
        catch {
            return false;
        }
    }
    async deriveKey(password, salt) {
        const crypto = webcrypto();
        if (crypto.subtle === undefined) {
            throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, 'WebCrypto subtle 不可用');
        }
        const base = await crypto.subtle.importKey('raw', toArrayBuffer(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: 600_000, hash: 'SHA-256' }, base, 256);
        return new Uint8Array(bits);
    }
    async key(raw) {
        if (this.cached !== null && this.cachedRaw === raw)
            return this.cached;
        const subtle = webcrypto().subtle;
        if (subtle === undefined) {
            throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, 'WebCrypto subtle 不可用');
        }
        const k = await subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
        this.cached = k;
        this.cachedRaw = raw;
        return k;
    }
    async seal(key, plaintext, aad) {
        const crypto = webcrypto();
        const subtle = crypto.subtle;
        if (subtle === undefined || crypto.getRandomValues === undefined) {
            throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, 'WebCrypto 不可用');
        }
        const nonce = new Uint8Array(12);
        crypto.getRandomValues(nonce);
        const cipher = await subtle.encrypt({
            name: 'AES-GCM',
            iv: toArrayBuffer(nonce),
            additionalData: toArrayBuffer(aad),
            tagLength: 128
        }, await this.key(key), toArrayBuffer(plaintext));
        return { suite: this.suite, nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(cipher)) };
    }
    async open(key, box, aad) {
        if (box.suite !== this.suite) {
            throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, '套件不匹配：' + box.suite);
        }
        const subtle = webcrypto().subtle;
        if (subtle === undefined) {
            throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, 'WebCrypto subtle 不可用');
        }
        const plain = await subtle.decrypt({
            name: 'AES-GCM',
            iv: toArrayBuffer(fromBase64(box.nonce)),
            additionalData: toArrayBuffer(aad),
            tagLength: 128
        }, await this.key(key), toArrayBuffer(fromBase64(box.ciphertext)));
        return new Uint8Array(plain);
    }
}
//# sourceMappingURL=provider.js.map