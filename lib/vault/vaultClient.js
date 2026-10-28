import { ErrorCode, PetError } from './_shared/index.js';
import { fromBase64 } from './file/format.js';
import { toBase64Url } from './crypto/keyRing.js';
/** 9.4 线格式：ver ‖ cs ‖ keyId ‖ nonce ‖ ct ‖ tag */
const CIPHER_VERSION = 2;
const HEADER_BYTES = 6;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SUITE_TO_CODE = { CS1: 1, CS2: 2, CS3: 3 };
const CODE_TO_SUITE = { 1: 'CS1', 2: 'CS2', 3: 'CS3' };
function concat(parts) {
    let length = 0;
    for (const part of parts)
        length += part.byteLength;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
}
function writeUint32(value) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, false);
    return out;
}
function readUint32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}
function toBase64(bytes) {
    let bin = '';
    for (const byte of bytes)
        bin += String.fromCharCode(byte);
    return btoa(bin);
}
function fromBase64Url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** TS 5.7 的 BufferSource 只接受 ArrayBuffer 背后的视图，统一复制一份。 */
function toArrayBuffer(bytes) {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
}
/** AAD 绑住 ver/cs/keyId；keyEpoch 单独校验，不进线格式。 */
function aadFor(suite, keyId) {
    const out = new Uint8Array(HEADER_BYTES);
    out[0] = CIPHER_VERSION;
    out[1] = SUITE_TO_CODE[suite];
    out.set(writeUint32(keyId), 2);
    return out;
}
/**
 * IVault 的 CS1 实现：组合既有 VaultStoragePort / AesGcmProvider / KeyRing。
 * 适配层在 seal/open 内部完成线格式与签名封装，不改 provider 签名。
 */
export class VaultClient {
    storage;
    provider;
    keys;
    createdAt = Date.now();
    cachedSenderPub = '';
    audit;
    /** 已成功打开过的 (senderPub, nonce)；同一 nonce 再来即视为重放。 */
    seenNonces = new Set();
    constructor(storage, provider, keys, audit) {
        this.storage = storage;
        this.provider = provider;
        this.keys = keys;
        this.audit = audit;
    }
    get suite() {
        return this.keys.suite;
    }
    get keyEpoch() {
        return this.keys.current().epoch;
    }
    async seal(plain, mode) {
        if (mode.kind !== 'envelope') {
            throw new PetError(ErrorCode.NOT_IMPLEMENTED, `seal mode 尚未实现：${mode.kind}`);
        }
        const bytes = plain instanceof Uint8Array ? plain : new TextEncoder().encode(JSON.stringify(plain));
        const key = this.keys.current();
        const box = await this.provider.seal(key.key, bytes, aadFor(this.suite, key.keyId));
        const nonce = fromBase64(box.nonce);
        const ciphertextWithTag = fromBase64(box.ciphertext);
        if (nonce.byteLength !== NONCE_BYTES || ciphertextWithTag.byteLength < TAG_BYTES) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, 'provider 输出长度异常');
        }
        const cipher = toBase64Url(concat([
            new Uint8Array([CIPHER_VERSION, SUITE_TO_CODE[this.suite]]),
            writeUint32(key.keyId),
            nonce,
            ciphertextWithTag.subarray(0, ciphertextWithTag.byteLength - TAG_BYTES),
            ciphertextWithTag.subarray(ciphertextWithTag.byteLength - TAG_BYTES)
        ]));
        const senderPub = await this.keys.senderPub();
        this.cachedSenderPub = senderPub;
        await this.audit?.append('seal', {
            keyId: key.keyId,
            epoch: key.epoch,
            size: bytes.byteLength
        });
        return {
            cipher,
            sig: await this.sign(cipher),
            senderPub,
            keyEpoch: key.epoch
        };
    }
    async open(sealed, opts = {}) {
        try {
            const plain = await this.openInner(sealed, opts);
            const raw = fromBase64Url(sealed.cipher);
            await this.audit?.append('open', {
                keyId: raw.byteLength >= HEADER_BYTES ? readUint32(raw, 2) : 0,
                size: plain.byteLength
            });
            return plain;
        }
        catch (error) {
            if (error instanceof PetError && error.code === ErrorCode.VAULT_TAMPERED) {
                await this.audit?.append('tamper_detected', {
                    code: error.code,
                    note: error.message
                });
            }
            throw error;
        }
    }
    async openInner(sealed, opts = {}) {
        const raw = fromBase64Url(sealed.cipher);
        if (raw.byteLength < HEADER_BYTES + NONCE_BYTES + TAG_BYTES) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, '密文长度不足');
        }
        const version = raw[0];
        const suiteCode = raw[1];
        if (version !== CIPHER_VERSION) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, `不支持的密文版本：${String(version)}`);
        }
        const suite = suiteCode === undefined ? undefined : CODE_TO_SUITE[suiteCode];
        if (suite === undefined || suite !== this.suite) {
            throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, `套件不匹配：${String(suiteCode)}`);
        }
        const keyId = readUint32(raw, 2);
        const key = this.keys.byId(keyId);
        if (key === undefined) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, `未知 keyId：${keyId}`);
        }
        if (opts.allowLegacyEpoch !== true && sealed.keyEpoch !== this.keyEpoch) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, `keyEpoch 不匹配：${sealed.keyEpoch} != ${this.keyEpoch}`);
        }
        if (!(await this.verify(sealed))) {
            throw new PetError(ErrorCode.SIGNATURE_INVALID, '签名校验失败');
        }
        const nonce = raw.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
        const replayKey = sealed.senderPub + ':' + toBase64(nonce);
        if (this.seenNonces.has(replayKey)) {
            throw new PetError(ErrorCode.REPLAY_DETECTED, '同一 nonce 重复打开');
        }
        const ciphertext = raw.subarray(HEADER_BYTES + NONCE_BYTES, raw.byteLength - TAG_BYTES);
        const tag = raw.subarray(raw.byteLength - TAG_BYTES);
        const plain = await this.provider.open(key.key, { suite: this.suite, nonce: toBase64(nonce), ciphertext: toBase64(concat([ciphertext, tag])) }, aadFor(this.suite, keyId));
        this.seenNonces.add(replayKey);
        return plain;
    }
    async createEncryptStream() {
        throw new PetError(ErrorCode.NOT_IMPLEMENTED, '流式加密属于 S1 后续步骤');
    }
    async createDecryptStream() {
        throw new PetError(ErrorCode.NOT_IMPLEMENTED, '流式解密属于 S1 后续步骤');
    }
    async pairStart() {
        throw new PetError(ErrorCode.NOT_IMPLEMENTED, 'PAKE 配对属于 S2');
    }
    async pairVerify() {
        throw new PetError(ErrorCode.NOT_IMPLEMENTED, 'PAKE 配对属于 S2');
    }
    async exportBackup() {
        throw new PetError(ErrorCode.NOT_IMPLEMENTED, '备份导出属于 S2');
    }
    async splitSeed() {
        throw new PetError(ErrorCode.NOT_IMPLEMENTED, '种子分片属于 S2');
    }
    async recoverSeed() {
        throw new PetError(ErrorCode.NOT_IMPLEMENTED, '种子恢复属于 S2');
    }
    async rotate() {
        const from = this.keys.current().epoch;
        await this.keys.rotate();
        const to = this.keys.current().epoch;
        await this.audit?.append('rotate', { epoch: to });
        return { from, to };
    }
    fingerprint() {
        return {
            pkFingerprint: this.cachedSenderPub,
            createdAt: this.createdAt,
            lastRotation: this.keyEpoch
        };
    }
    destroy() {
        this.keys.destroy();
        this.cachedSenderPub = '';
    }
    async sign(payload) {
        const pair = await this.keys.signer();
        const signature = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, toArrayBuffer(new TextEncoder().encode(payload)));
        return toBase64Url(new Uint8Array(signature));
    }
    /**
     * 第一刀只签 cipher；契约注释里的 hlc ‖ seq ‖ id 前置字段等 Ledger 接入后再补。
     */
    async verify(sealed) {
        try {
            const publicKey = await globalThis.crypto.subtle.importKey('raw', toArrayBuffer(fromBase64Url(sealed.senderPub)), { name: 'Ed25519' }, false, ['verify']);
            return await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, publicKey, toArrayBuffer(fromBase64Url(sealed.sig)), toArrayBuffer(new TextEncoder().encode(sealed.cipher)));
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=vaultClient.js.map