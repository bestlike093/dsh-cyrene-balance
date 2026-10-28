import { ErrorCode, PetError } from '../_shared/index.js';
export const VAULT_MAGIC = 'DSHPET1';
export const VAULT_VERSION = 1;
export const DEFAULT_KDF_ITERATIONS = 600_000;
function toBase64(bytes) {
    let bin = '';
    for (const byte of bytes)
        bin += String.fromCharCode(byte);
    return btoa(bin);
}
export function fromBase64(value) {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** AAD 覆盖 magic/version/suite/kdf/updatedAt：任何一项被改都会导致解密失败。 */
export function canonicalAad(header) {
    return [
        VAULT_MAGIC,
        String(VAULT_VERSION),
        header.suite,
        header.kdf.name,
        String(header.kdf.iterations),
        header.kdf.salt,
        String(header.updatedAt)
    ].join('|');
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseVaultFile(raw) {
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        }
        catch (error) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 文件不是合法 JSON', { cause: error });
        }
    }
    if (!isRecord(value)) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 文件必须是对象');
    }
    if (value['magic'] !== VAULT_MAGIC) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 文件标识不匹配');
    }
    if (value['version'] !== VAULT_VERSION) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, `不支持的 Vault 版本：${String(value['version'])}`);
    }
    const suite = value['suite'];
    if (typeof suite !== 'string' || suite.length === 0) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 套件字段缺失');
    }
    const kdfRaw = value['kdf'];
    if (!isRecord(kdfRaw)) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault KDF 字段缺失');
    }
    const iterations = kdfRaw['iterations'];
    const salt = kdfRaw['salt'];
    if (kdfRaw['name'] !== 'PBKDF2-SHA256' || typeof iterations !== 'number' || iterations < 1) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault KDF 参数非法');
    }
    if (typeof salt !== 'string' || salt.length === 0) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 盐缺失');
    }
    const aad = value['aad'];
    const nonce = value['nonce'];
    const ciphertext = value['ciphertext'];
    const updatedAt = value['updatedAt'];
    if (typeof aad !== 'string' || typeof nonce !== 'string' || typeof ciphertext !== 'string') {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 加密字段缺失');
    }
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 时间戳非法');
    }
    return {
        magic: VAULT_MAGIC,
        version: VAULT_VERSION,
        suite,
        kdf: { name: 'PBKDF2-SHA256', iterations, salt },
        aad,
        nonce,
        ciphertext,
        updatedAt
    };
}
export async function sealVaultFile(provider, key, plaintext, options) {
    const kdf = {
        name: 'PBKDF2-SHA256',
        iterations: options.iterations ?? DEFAULT_KDF_ITERATIONS,
        salt: toBase64(options.salt)
    };
    const aad = canonicalAad({ suite: provider.suite, kdf, updatedAt: options.updatedAt });
    const box = await provider.seal(key, plaintext, new TextEncoder().encode(aad));
    return {
        magic: VAULT_MAGIC,
        version: VAULT_VERSION,
        suite: provider.suite,
        kdf,
        aad,
        nonce: box.nonce,
        ciphertext: box.ciphertext,
        updatedAt: options.updatedAt
    };
}
export async function openVaultFile(provider, key, file) {
    if (file.suite !== provider.suite) {
        throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, `套件不匹配：${file.suite}`);
    }
    const expectedAad = canonicalAad({
        suite: file.suite,
        kdf: file.kdf,
        updatedAt: file.updatedAt
    });
    if (file.aad !== expectedAad) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 头部被篡改');
    }
    try {
        return await provider.open(key, { suite: file.suite, nonce: file.nonce, ciphertext: file.ciphertext }, new TextEncoder().encode(expectedAad));
    }
    catch (error) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'Vault 密文校验失败', { cause: error });
    }
}
export function serializeVaultFile(file) {
    return JSON.stringify(file);
}
//# sourceMappingURL=format.js.map