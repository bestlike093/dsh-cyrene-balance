/**
 * 用系统钥匙串那一套（FileKeyRing）承载的加密仓库。
 *
 * 与 `VaultStore` 的分工：
 * - `VaultStore` 用口令派生密钥，适合「需要跨设备」或「不想依赖系统钥匙串」的场景
 * - `KeyRingVaultStore` 用 FileKeyRing 的数据密钥，开机即可用，不需要用户输口令
 *
 * 两者实现同一个 `VaultLike`，上层的 `ServiceSecretStore` / `LlmSecretStore`
 * 不需要知道自己拿到的是哪一套。
 */
import { ErrorCode, PetError } from '@pet/shared';
function parseSealed(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '加密仓库文件不是合法 JSON', { cause: error });
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '加密仓库文件结构不正确');
    }
    const candidate = parsed;
    if (typeof candidate.cipher !== 'string' ||
        typeof candidate.sig !== 'string' ||
        typeof candidate.senderPub !== 'string' ||
        typeof candidate.keyEpoch !== 'number') {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '加密仓库文件缺少必要字段');
    }
    return {
        cipher: candidate.cipher,
        sig: candidate.sig,
        senderPub: candidate.senderPub,
        keyEpoch: candidate.keyEpoch
    };
}
export class KeyRingVaultStore {
    client;
    storage;
    cached = undefined;
    loaded = false;
    constructor(options) {
        this.client = options.client;
        this.storage = options.storage;
    }
    /**
     * 同一份密文不能反复 open：`VaultClient` 把重复 nonce 当成重放。
     * 所以第一次解开后留在内存里，之后直接返回。
     */
    async load() {
        if (this.loaded)
            return (this.cached ?? null);
        const text = await this.storage.read();
        if (text === null || text.trim() === '') {
            this.loaded = true;
            this.cached = null;
            return null;
        }
        // 轮转之后旧信封会在这里被拒。这是故意的：能读旧密钥等于绕开轮转。
        // 需要保留历史时，应在轮转后重新封装一次。
        const plain = await this.client.open(parseSealed(text));
        let data;
        try {
            data = JSON.parse(new TextDecoder().decode(plain));
        }
        catch (error) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, '仓库明文不是合法 JSON', { cause: error });
        }
        this.cached = data;
        this.loaded = true;
        return data;
    }
    async save(data) {
        if (typeof data !== 'object' || data === null) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '仓库内容必须是对象');
        }
        const sealed = await this.client.seal(data, { kind: 'envelope' });
        const text = JSON.stringify(sealed);
        if (this.storage.writeAtomic !== undefined) {
            await this.storage.writeAtomic(text);
        }
        else {
            await this.storage.write(text);
        }
        this.cached = data;
        this.loaded = true;
    }
    /** 外部改过文件时调用；下次 load 会重新读盘解密。 */
    invalidate() {
        this.loaded = false;
        this.cached = undefined;
    }
}
