import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ErrorCode, PetError } from '../_shared/index.js';
import { toBase64Url } from './keyRing.js';
const execFileAsync = promisify(execFile);
const KEY_FILE_VERSION = 1;
function randomBytes(length) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
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
function parseKeyFile(text) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (error) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'keys.json 不是合法 JSON', { cause: error });
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, 'keys.json 必须是对象');
    }
    const record = value;
    if (record['version'] !== KEY_FILE_VERSION) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, `不支持的密钥文件版本：${String(record['version'])}`);
    }
    if (typeof record['suite'] !== 'string' || record['suite'].length === 0) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '密钥文件缺少 suite');
    }
    const rawKeys = record['keys'];
    if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '密钥文件没有密钥条目');
    }
    const keys = rawKeys.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, '密钥条目格式非法');
        }
        const item = entry;
        if (typeof item['keyId'] !== 'number' ||
            typeof item['epoch'] !== 'number' ||
            typeof item['wrapped'] !== 'string') {
            throw new PetError(ErrorCode.VAULT_TAMPERED, '密钥条目字段缺失');
        }
        return { keyId: item['keyId'], epoch: item['epoch'], wrapped: item['wrapped'] };
    });
    return {
        version: KEY_FILE_VERSION,
        suite: record['suite'],
        backend: record['backend'],
        keys
    };
}
/** Windows 用 ACL（chmod 只改只读位），POSIX 用 0600。 */
export async function restrictPermissions(filePath) {
    if (process.platform === 'win32') {
        const user = process.env.USERNAME;
        if (user === undefined || user.length === 0) {
            throw new PetError(ErrorCode.KEY_PERMISSION, '无法确定当前用户，拒绝写入密钥文件');
        }
        await execFileAsync('icacls', [filePath, '/inheritance:r', '/grant:r', `${user}:(R,W)`]);
        return;
    }
    await chmod(filePath, 0o600);
}
/** 行为检查：当前用户可读写、其他非提权用户不可读。 */
async function inspectPermission(filePath) {
    if (process.platform === 'win32') {
        try {
            const { stdout } = await execFileAsync('icacls', [filePath]);
            const text = stdout.toLowerCase();
            if (text.includes('everyone') || text.includes('builtin\\users') || text.includes('*s-1-1-0')) {
                return 'too-open';
            }
            const user = (process.env.USERNAME ?? '').toLowerCase();
            return user.length > 0 && text.includes(user) ? 'ok' : 'unknown';
        }
        catch {
            return 'unknown';
        }
    }
    try {
        const info = await stat(filePath);
        return (info.mode & 0o077) === 0 ? 'ok' : 'too-open';
    }
    catch {
        return 'unknown';
    }
}
/** 损坏的密钥文件只改名保留，绝不删除；这是事后诊断的唯一依据。 */
async function quarantineKeyFile(path) {
    const backupPath = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await rename(path, backupPath);
    return backupPath;
}
/**
 * 落盘密钥环：密钥先经 backend 包裹，再写 keys.json。
 * 文件里永远不出现裸 key；权限按平台收紧到仅当前用户。
 */
export async function createFileKeyRing(options) {
    const suite = options.suite ?? 'CS1';
    const keys = new Map();
    let current = null;
    let signerPair = null;
    const ensureSigner = async () => {
        if (signerPair === null) {
            signerPair = (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
                'sign',
                'verify'
            ]));
        }
        return signerPair;
    };
    const persist = async () => {
        const entries = [];
        for (const entry of keys.values()) {
            const wrapped = await options.backend.wrap(entry.key);
            entries.push({ keyId: entry.keyId, epoch: entry.epoch, wrapped: toBase64(wrapped) });
        }
        const file = {
            version: KEY_FILE_VERSION,
            suite,
            backend: options.backend.kind,
            keys: entries
        };
        await mkdir(dirname(options.path), { recursive: true });
        await writeFile(options.path, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
        await restrictPermissions(options.path);
    };
    let loaded = null;
    let recoveredFrom;
    try {
        loaded = parseKeyFile(await readFile(options.path, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            // 首次运行，正常初始化。
        }
        else if (error instanceof PetError && error.code === ErrorCode.VAULT_TAMPERED) {
            // 文件损坏：改名保留证据，再重新初始化。
            recoveredFrom = await quarantineKeyFile(options.path);
        }
        else {
            throw error;
        }
    }
    if (loaded !== null) {
        if (loaded.suite !== suite) {
            throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, `密钥文件套件不匹配：${loaded.suite}`);
        }
        try {
            for (const entry of loaded.keys) {
                const raw = await options.backend.unwrap(fromBase64(entry.wrapped));
                keys.set(entry.keyId, { keyId: entry.keyId, epoch: entry.epoch, key: raw });
            }
            const last = loaded.keys[loaded.keys.length - 1];
            if (last === undefined) {
                throw new PetError(ErrorCode.VAULT_TAMPERED, '密钥文件为空');
            }
            current = keys.get(last.keyId) ?? null;
        }
        catch (error) {
            // 后端变了导致整体解不开：同样只改名保留，不删除、不覆盖证据。
            if (!(error instanceof PetError && error.code === ErrorCode.VAULT_TAMPERED))
                throw error;
            keys.clear();
            current = null;
            recoveredFrom = await quarantineKeyFile(options.path);
        }
    }
    if (current === null) {
        current = { keyId: 1, epoch: 0, key: randomBytes(32) };
        keys.set(current.keyId, current);
        await persist();
    }
    const ring = {
        suite,
        current: () => {
            if (current === null) {
                throw new PetError(ErrorCode.VAULT_LOCKED, '密钥环未初始化');
            }
            return current;
        },
        byId: (keyId) => keys.get(keyId),
        signer: ensureSigner,
        async senderPub() {
            const pair = await ensureSigner();
            const raw = await globalThis.crypto.subtle.exportKey('raw', pair.publicKey);
            return toBase64Url(new Uint8Array(raw));
        },
        async rotate() {
            const base = ring.current();
            const next = {
                keyId: base.keyId + 1,
                epoch: base.epoch + 1,
                key: randomBytes(32)
            };
            keys.set(next.keyId, next);
            current = next;
            await persist();
        },
        destroy() {
            for (const entry of keys.values())
                entry.key.fill(0);
            keys.clear();
            current = null;
            signerPair = null;
        },
        async diagnostics() {
            return {
                backend: options.backend.kind,
                secure: options.backend.secure,
                permission: await inspectPermission(options.path),
                path: options.path,
                ...(recoveredFrom === undefined ? {} : { recoveredFrom })
            };
        },
        async flush() {
            if (current === null) {
                throw new PetError(ErrorCode.VAULT_LOCKED, '密钥环未初始化');
            }
            await persist();
        }
    };
    return ring;
}
//# sourceMappingURL=fileKeyRing.js.map