import { ErrorCode, PetError } from '../_shared/index.js';
import { AesGcmProvider } from '../crypto/provider.js';
import { DEFAULT_KDF_ITERATIONS, fromBase64, openVaultFile, parseVaultFile, sealVaultFile, serializeVaultFile } from '../file/format.js';
function randomSalt() {
    const g = globalThis;
    if (g.crypto?.getRandomValues === undefined) {
        throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, '当前运行时没有安全随机源');
    }
    const salt = new Uint8Array(16);
    g.crypto.getRandomValues(salt);
    return salt;
}
/**
 * 加密仓库：负责锁定状态、口令校验与原子落盘。
 * 所有失败都收敛成稳定错误码，调用方不需要解析底层异常。
 */
export class VaultStore {
    storage;
    provider;
    now;
    iterations;
    key = null;
    salt = null;
    constructor(storage, options = {}) {
        this.storage = storage;
        this.provider = options.provider ?? new AesGcmProvider();
        this.now = options.now ?? Date.now;
        this.iterations = options.iterations ?? DEFAULT_KDF_ITERATIONS;
    }
    get isLocked() {
        return this.key === null;
    }
    /** 首次没有文件时生成盐；有文件时用文件里的盐派生，顺带验证口令。 */
    async unlock(password) {
        if (typeof password !== 'string' || password.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '口令不能为空');
        }
        const text = await this.storage.read();
        if (text === null || text.trim() === '') {
            this.salt = randomSalt();
            this.key = await this.provider.deriveKey(password, this.salt);
            return;
        }
        const file = parseVaultFile(text);
        const salt = fromBase64(file.kdf.salt);
        const key = await this.provider.deriveKey(password, salt);
        try {
            await openVaultFile(this.provider, key, file);
        }
        catch (error) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '口令错误或仓库已损坏', { cause: error });
        }
        this.salt = salt;
        this.key = key;
    }
    lock() {
        this.key = null;
    }
    async save(data) {
        if (this.key === null || this.salt === null) {
            throw new PetError(ErrorCode.VAULT_LOCKED, '仓库未解锁');
        }
        const plaintext = new TextEncoder().encode(JSON.stringify(data));
        const file = await sealVaultFile(this.provider, this.key, plaintext, {
            salt: this.salt,
            iterations: this.iterations,
            updatedAt: this.now()
        });
        const text = serializeVaultFile(file);
        if (this.storage.writeAtomic !== undefined) {
            await this.storage.writeAtomic(text);
        }
        else {
            await this.storage.write(text);
        }
    }
    async load() {
        if (this.key === null) {
            throw new PetError(ErrorCode.VAULT_LOCKED, '仓库未解锁');
        }
        const text = await this.storage.read();
        if (text === null || text.trim() === '')
            return null;
        const file = parseVaultFile(text);
        const plaintext = await openVaultFile(this.provider, this.key, file);
        try {
            return JSON.parse(new TextDecoder().decode(plaintext));
        }
        catch (error) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, '仓库明文不是合法 JSON', { cause: error });
        }
    }
}
/** 内存存储：测试与无宿主环境的默认实现。 */
export class MemoryVaultStorage {
    text = null;
    async read() {
        return this.text;
    }
    async write(text) {
        this.text = text;
    }
    async writeAtomic(text) {
        this.text = text;
    }
    raw() {
        return this.text;
    }
    tamper(next) {
        this.text = next;
    }
}
//# sourceMappingURL=vaultStore.js.map