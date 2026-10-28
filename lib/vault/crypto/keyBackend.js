import { ErrorCode, PetError } from '../_shared/index.js';
import { AesGcmProvider } from './provider.js';
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
/**
 * Electron safeStorage 后端。
 * Linux `basic_text` 后端意味着密文实际不受保护，`secure` 会置 false，
 * 调用方必须据此告警并记录审计，禁止静默降级。
 */
export function createSafeStorageBackend(storage) {
    return {
        kind: 'safeStorage',
        /** 每次读取，后端切换（如 basic_text 与系统钥匙串之间）能被诊断及时看见。 */
        get secure() {
            return (storage.getSelectedStorageBackend?.() ?? 'unknown') !== 'basic_text';
        },
        async wrap(plain) {
            if (!storage.isEncryptionAvailable()) {
                throw new PetError(ErrorCode.VAULT_LOCKED, 'safeStorage 不可用，禁止静默降级');
            }
            return new Uint8Array(storage.encryptString(toBase64(plain)));
        },
        async unwrap(wrapped) {
            if (!storage.isEncryptionAvailable()) {
                throw new PetError(ErrorCode.VAULT_LOCKED, 'safeStorage 不可用，禁止静默降级');
            }
            return fromBase64(storage.decryptString(wrapped));
        }
    };
}
/**
 * 系统密钥后端。没有可用系统后端时必须明确失败：
 * memory 只能显式注入，禁止成为默认值，否则生产路径会在每次重启时静默丢密钥。
 */
export async function createSystemKeyBackend(safeStorage) {
    if (safeStorage !== undefined) {
        return createSafeStorageBackend(safeStorage);
    }
    throw new PetError(ErrorCode.NOT_SUPPORTED, '当前运行时没有注入系统密钥后端；memory 后端只能显式注入，禁止作为默认值');
}
/**
 * 进程内后端：用一次性 AES-GCM 密钥包裹，仅用于 CI / 单测。
 * 进程重启后无法解开旧文件，因此 `secure=false`，不得作为生产默认。
 */
export async function createMemoryBackend() {
    const provider = new AesGcmProvider();
    const wrappingKey = new Uint8Array(32);
    globalThis.crypto.getRandomValues(wrappingKey);
    const aad = new Uint8Array(0);
    return {
        kind: 'memory',
        secure: false,
        async wrap(plain) {
            const box = await provider.seal(wrappingKey, plain, aad);
            return new Uint8Array(Buffer.concat([Buffer.from(box.nonce, 'base64'), Buffer.from(box.ciphertext, 'base64')]));
        },
        async unwrap(wrapped) {
            if (wrapped.byteLength < 12 + 16) {
                throw new PetError(ErrorCode.VAULT_TAMPERED, '包裹密文长度异常');
            }
            const nonce = wrapped.subarray(0, 12);
            const ciphertext = wrapped.subarray(12);
            try {
                return await provider.open(wrappingKey, {
                    suite: provider.suite,
                    nonce: Buffer.from(nonce).toString('base64'),
                    ciphertext: Buffer.from(ciphertext).toString('base64')
                }, aad);
            }
            catch (error) {
                throw new PetError(ErrorCode.VAULT_TAMPERED, '密钥包裹解密失败', { cause: error });
            }
        }
    };
}
//# sourceMappingURL=keyBackend.js.map