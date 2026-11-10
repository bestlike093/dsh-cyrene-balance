import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ErrorCode, PetError } from '@pet/shared';
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
function fromBase64Url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return fromBase64(padded + pad);
}
/** WebCrypto 只接受 ArrayBuffer 背后的视图，统一复制一份。 */
function toArrayBuffer(bytes) {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy.buffer;
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
    // signer 是后加的字段：旧文件没有它属于正常情况，按缺失处理，不报损坏。
    let signer;
    const rawSigner = record['signer'];
    if (typeof rawSigner === 'object' && rawSigner !== null) {
        const item = rawSigner;
        if (typeof item['wrapped'] === 'string' && typeof item['pub'] === 'string') {
            signer = { wrapped: item['wrapped'], pub: item['pub'] };
        }
    }
    return {
        version: KEY_FILE_VERSION,
        suite: record['suite'],
        backend: record['backend'],
        keys,
        ...(signer === undefined ? {} : { signer })
    };
}
/**
 * 宽泛主体：任何人、Users、Authenticated Users、Guests。
 *
 * 这些 SID 与系统语言无关。中文 Windows 上 `icacls` 会打印「所有人」
 * 「BUILTIN\Users」，按英文名去匹配会静默漏报，所以只认 SID。
 */
export const WIDE_ACL_SIDS = [
    'S-1-1-0',
    'S-1-5-32-545',
    'S-1-5-11',
    'S-1-5-32-546'
];
/** SYSTEM 的 SID。收紧权限时保留它，便于系统备份与杀软读取。 */
export const SYSTEM_SID = 'S-1-5-18';
/**
 * 根据 ACL 里的 SID 集合判断权限状态。
 *
 * 纯函数，不碰文件系统，便于在非 Windows 环境里验证判定规则。
 */
export function evaluateAclSids(entries, currentSid) {
    if (currentSid === null || currentSid.length === 0)
        return 'unknown';
    if (entries.length === 0)
        return 'unknown';
    if (entries.some((sid) => WIDE_ACL_SIDS.includes(sid)))
        return 'too-open';
    return entries.includes(currentSid) ? 'ok' : 'unknown';
}
/** 进程内缓存：SID 在一次运行里不会变，避免每次落盘都起一个 whoami。 */
let cachedUserSid;
/** 取当前进程用户的 SID。失败返回 null，调用方按 unknown 处理。 */
async function currentUserSid() {
    if (cachedUserSid !== undefined)
        return cachedUserSid;
    try {
        const { stdout } = await execFileAsync('whoami', ['/user', '/fo', 'csv', '/nh']);
        const match = /\bS-1-5-[\d-]+\b/.exec(stdout);
        cachedUserSid = match === null ? null : match[0];
    }
    catch {
        cachedUserSid = null;
    }
    return cachedUserSid;
}
/**
 * Windows 用 ACL（chmod 只改只读位），POSIX 用 0600。
 *
 * Windows 侧授权用 SID 而不是用户名：用户名可能含空格、重名或与
 * 本地化显示名不一致，SID 不会。
 */
export async function restrictPermissions(filePath) {
    if (process.platform === 'win32') {
        const sid = await currentUserSid();
        if (sid === null) {
            throw new PetError(ErrorCode.KEY_PERMISSION, '无法确定当前用户 SID，拒绝写入密钥文件');
        }
        await execFileAsync('icacls', [
            filePath,
            '/inheritance:r',
            '/grant:r',
            `*${sid}:(R,W)`,
            `*${SYSTEM_SID}:(F)`
        ]);
        return;
    }
    await chmod(filePath, 0o600);
}
/** 行为检查：当前用户可读写、其他非提权用户不可读。 */
async function inspectPermission(filePath) {
    if (process.platform === 'win32') {
        try {
            // 用 PowerShell 把身份引用翻译成 SID，避免依赖本地化的组名。
            const script = [
                `$acl = Get-Acl -LiteralPath '${filePath.replace(/'/g, "''")}'`,
                `$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value`,
                `$sids = @($acl.Access | ForEach-Object { try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { } } | Where-Object { $_ })`,
                `@{ me = $me; sids = $sids } | ConvertTo-Json -Compress`
            ].join('; ');
            const { stdout } = await execFileAsync('powershell', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                script
            ]);
            const parsed = JSON.parse(stdout);
            const sids = Array.isArray(parsed.sids)
                ? parsed.sids.filter((sid) => typeof sid === 'string')
                : [];
            const me = typeof parsed.me === 'string' ? parsed.me : null;
            return evaluateAclSids(sids, me);
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
    let signerDirty = false;
    let signerState = 'ok';
    const ensureSigner = async () => {
        if (signerPair === null) {
            signerPair = (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
                'sign',
                'verify'
            ]));
            signerDirty = true;
        }
        return signerPair;
    };
    /** 签名密钥变了就立刻落盘；否则重启后 fingerprint 又会漂移。 */
    const persistSigner = async () => {
        if (!signerDirty)
            return;
        signerDirty = false;
        await persist();
    };
    /**
     * 落盘密钥环。
     *
     * `extra` 是「即将启用、但还没提交到内存」的密钥：rotate 先把它交给 persist，
     * 落盘成功后才写进 keys/current。这样 persist 期间并发的 seal 读到的仍是旧
     * current，不会出现「进程内新密钥、磁盘旧密钥」的分叉。
     */
    const persist = async (extra = null) => {
        const entries = [];
        const source = extra === null ? [...keys.values()] : [...keys.values(), extra];
        for (const entry of source) {
            const wrapped = await options.backend.wrap(entry.key);
            entries.push({ keyId: entry.keyId, epoch: entry.epoch, wrapped: toBase64(wrapped) });
        }
        // 私钥只以包裹形式出现；公钥可以明文存，方便下次启动核对指纹。
        let signer;
        if (signerPair !== null) {
            const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', signerPair.privateKey));
            const rawPub = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', signerPair.publicKey));
            signer = {
                wrapped: toBase64(await options.backend.wrap(pkcs8)),
                pub: toBase64Url(rawPub)
            };
        }
        const file = {
            version: KEY_FILE_VERSION,
            suite,
            backend: options.backend.kind,
            keys: entries,
            ...(signer === undefined ? {} : { signer })
        };
        await mkdir(dirname(options.path), { recursive: true });
        // 先写临时文件再替换：断电时磁盘上要么是完整旧文件，要么是完整新文件，
        // 不会留下半截 JSON 把密钥环整组丢掉。
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
    };
    let loaded = null;
    let recoveredFrom;
    /** 本次运行是否从零生成了密钥环（文件不存在）。 */
    let initializedFresh = false;
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
    // 恢复签名密钥。缺字段（旧文件）或解不开时重建一次，AES 数据不受影响。
    if (loaded?.signer !== undefined) {
        try {
            const subtle = globalThis.crypto.subtle;
            const pkcs8 = await options.backend.unwrap(fromBase64(loaded.signer.wrapped));
            const privateKey = await subtle.importKey('pkcs8', toArrayBuffer(pkcs8), 'Ed25519', true, [
                'sign'
            ]);
            const publicKey = await subtle.importKey('raw', toArrayBuffer(fromBase64Url(loaded.signer.pub)), 'Ed25519', true, ['verify']);
            signerPair = { privateKey, publicKey };
        }
        catch {
            signerPair = null;
            signerDirty = false;
            signerState = 'rebuilt';
        }
    }
    // 首次运行或签名密钥缺失：生成一次并马上写回，下次启动指纹就稳定了。
    if (signerPair === null) {
        try {
            await ensureSigner();
        }
        catch {
            signerState = 'unavailable';
        }
    }
    if (current === null) {
        initializedFresh = true;
        current = { keyId: 1, epoch: 0, key: randomBytes(32) };
        keys.set(current.keyId, current);
        signerDirty = false;
        await persist();
    }
    else if (signerDirty) {
        signerDirty = false;
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
        async signer() {
            const pair = await ensureSigner();
            await persistSigner();
            return pair;
        },
        async senderPub() {
            const pair = await ensureSigner();
            await persistSigner();
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
            // 先落盘、后提交内存：persist 失败时 keys/current 都没动，进程内继续用旧
            // 密钥；重启后磁盘也没有 next。最坏情况只是磁盘多一条未启用的 next，
            // 不会出现「进程内用新密钥写入、磁盘仍是旧环」而重启后解不开的分叉。
            // next 从未进入 keys，失败路径不需要回滚，也不存在在途 seal 拿到它的窗口。
            await persist(next);
            keys.set(next.keyId, next);
            current = next;
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
                signerState,
                keyRingState: recoveredFrom !== undefined ? 'quarantined' : initializedFresh ? 'rebuilt' : 'ok',
                ...(recoveredFrom === undefined ? {} : { recoveredFrom })
            };
        },
        async flush() {
            if (current === null) {
                throw new PetError(ErrorCode.VAULT_LOCKED, '密钥环未初始化');
            }
            await persist();
        },
        exportKeys() {
            return [...keys.values()].map((entry) => ({
                keyId: entry.keyId,
                epoch: entry.epoch,
                key: entry.key.slice()
            }));
        }
    };
    return ring;
}
