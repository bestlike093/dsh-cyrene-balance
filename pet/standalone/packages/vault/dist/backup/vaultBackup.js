/**
 * `.petbackup`：跨机器可恢复的 Vault 备份。
 *
 * 只导出「口令封装的明文密钥」和数据文件密文，不导出系统后端（DPAPI 等）
 * 的包裹结果——换机后那些密文解不开。数据文件本身仍是 Vault 密文，
 * 所以备份口令等同于整份备份的钥匙：长度门槛和 PBKDF2 迭代次数都不许降级。
 */
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ErrorCode, PetError } from '@pet/shared';
import { AesGcmProvider } from '../crypto/provider.js';
import { restrictPermissions } from '../crypto/fileKeyRing.js';
export const BACKUP_FORMAT = 'pet-vault-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_KDF_ITERATIONS = 600_000;
export const BACKUP_MIN_PASSWORD_LENGTH = 8;
/** 建议口令长度，只用于界面提示；门槛仍是 8，避免旧备份突然导不进来。 */
export const BACKUP_RECOMMENDED_PASSWORD_LENGTH = 12;
/** 单个条目解包后的上限。正常备份里最大的是聊天历史，远小于这个数。 */
export const BACKUP_MAX_FILE_BYTES = 64 * 1024 * 1024;
/** 全部条目解包后的总量上限，防止一份备份把磁盘写满。 */
export const BACKUP_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/** 条目数上限：正常备份只有几个固定文件，多出来的都不是正常备份。 */
export const BACKUP_MAX_FILES = 64;
const BACKUP_AAD = 'pet-vault-backup|1';
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
function assertPassword(password) {
    if (typeof password !== 'string' || password.length < BACKUP_MIN_PASSWORD_LENGTH) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `备份口令至少 ${BACKUP_MIN_PASSWORD_LENGTH} 位`);
    }
}
function assertSafeName(name) {
    if (name.length === 0 || name.includes('/') || name.includes('\\') || name.includes('..')) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `备份条目名不合法：${name}`);
    }
}
/** base64 长度换算成字节；宁可高估，也不要先解码再发现超限。 */
function base64ByteLength(value) {
    return Math.floor((value.length * 3) / 4);
}
/** 单条与总量一起校验，返回累计字节数。 */
function assertEntryBudget(name, bytes, total) {
    if (bytes > BACKUP_MAX_FILE_BYTES) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `备份条目过大：${name}`);
    }
    const next = total + bytes;
    if (next > BACKUP_MAX_TOTAL_BYTES) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '备份内容总量超出上限');
    }
    return next;
}
function isFileEntry(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const entry = value;
    return typeof entry.name === 'string' && typeof entry.data === 'string';
}
/** 把密钥环和数据文件封装成可跨机器的备份对象。 */
export async function createVaultBackup(options) {
    assertPassword(options.password);
    const provider = new AesGcmProvider();
    const salt = new Uint8Array(16);
    globalThis.crypto.getRandomValues(salt);
    const derived = await provider.deriveKey(options.password, salt);
    const signerPair = await options.ring.signer();
    const secrets = {
        keys: options.ring.exportKeys().map((entry) => ({
            keyId: entry.keyId,
            epoch: entry.epoch,
            key: toBase64(entry.key)
        })),
        ...(signerPair === null
            ? {}
            : {
                signer: {
                    pkcs8: toBase64(new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', signerPair.privateKey))),
                    pub: toBase64(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', signerPair.publicKey)))
                }
            })
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(secrets));
    const sealed = await provider.seal(derived, plaintext, new TextEncoder().encode(BACKUP_AAD));
    if (options.files.length > BACKUP_MAX_FILES) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `备份条目过多：最多 ${BACKUP_MAX_FILES} 个`);
    }
    let totalBytes = 0;
    const files = options.files.map((file) => {
        assertSafeName(file.name);
        totalBytes = assertEntryBudget(file.name, file.data.byteLength, totalBytes);
        return { name: file.name, data: toBase64(file.data) };
    });
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: (options.now ?? new Date()).toISOString(),
        kdf: { name: 'PBKDF2-SHA256', iterations: BACKUP_KDF_ITERATIONS, salt: toBase64(salt) },
        sealed,
        files
    };
}
/** 用口令打开备份；口令错误与文件损坏都统一报 VAULT_TAMPERED，不泄露细节。 */
export async function openVaultBackup(payload, password) {
    if (typeof payload !== 'object' || payload === null) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '备份文件格式不正确');
    }
    const backup = payload;
    if (backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '这不是受支持的 .petbackup 文件');
    }
    if (backup.kdf?.name !== 'PBKDF2-SHA256' || backup.kdf.iterations !== BACKUP_KDF_ITERATIONS) {
        throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, '备份的 KDF 参数不被支持');
    }
    if (backup.sealed === undefined || !Array.isArray(backup.files)) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '备份文件缺少必要字段');
    }
    // 条目数在解密前就拒绝：省掉一次 600k 次迭代，也不必先解出内容。
    if (backup.files.length > BACKUP_MAX_FILES) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `备份条目过多：最多 ${BACKUP_MAX_FILES} 个`);
    }
    assertPassword(password);
    const provider = new AesGcmProvider();
    const derived = await provider.deriveKey(password, fromBase64(backup.kdf.salt));
    let plaintext;
    try {
        plaintext = await provider.open(derived, backup.sealed, new TextEncoder().encode(BACKUP_AAD));
    }
    catch {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '备份口令错误或文件已损坏');
    }
    let secrets;
    try {
        secrets = JSON.parse(new TextDecoder().decode(plaintext));
    }
    catch {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '备份内容无法解析');
    }
    if (!Array.isArray(secrets.keys) || secrets.keys.length === 0) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '备份里没有可用密钥');
    }
    // 先按 base64 长度预算体积，超限就不解码：避免恶意备份先把内存撑爆。
    let totalBytes = 0;
    const files = backup.files.map((file) => {
        if (!isFileEntry(file)) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, '备份条目结构不正确');
        }
        assertSafeName(file.name);
        totalBytes = assertEntryBudget(file.name, base64ByteLength(file.data), totalBytes);
        return { name: file.name, data: fromBase64(file.data) };
    });
    return {
        keys: secrets.keys.map((entry) => ({
            keyId: entry.keyId,
            epoch: entry.epoch,
            key: fromBase64(entry.key)
        })),
        ...(secrets.signer === undefined
            ? {}
            : {
                signer: {
                    pkcs8: fromBase64(secrets.signer.pkcs8),
                    pub: fromBase64(secrets.signer.pub)
                }
            }),
        files
    };
}
/**
 * 用恢复出的密钥重写 keys.json：用当前机器的后端重新包裹。
 * 与 FileKeyRing 的落盘逻辑保持一致（先写临时文件再替换）。
 */
export async function writeRestoredKeyRing(options) {
    if (options.keys.length === 0) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '没有可写入的密钥');
    }
    const entries = [];
    for (const entry of options.keys) {
        entries.push({
            keyId: entry.keyId,
            epoch: entry.epoch,
            wrapped: toBase64(await options.backend.wrap(entry.key))
        });
    }
    const file = {
        version: 1,
        suite: options.suite,
        backend: options.backend.kind,
        keys: entries,
        ...(options.signer === undefined
            ? {}
            : {
                signer: {
                    wrapped: toBase64(await options.backend.wrap(options.signer.pkcs8)),
                    pub: toBase64(options.signer.pub)
                }
            })
    };
    await mkdir(dirname(options.path), { recursive: true });
    const temp = `${options.path}.tmp-${process.pid}-${Date.now()}`;
    try {
        await writeFile(temp, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
        await restrictPermissions(temp);
        await rename(temp, options.path);
    }
    catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
    }
    await restrictPermissions(options.path);
}
