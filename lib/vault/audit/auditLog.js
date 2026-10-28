import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ErrorCode, PetError } from '../_shared/index.js';
import { restrictPermissions } from '../crypto/fileKeyRing.js';
const GENESIS_HASH = '0'.repeat(64);
function computeHash(entry) {
    return createHash('sha256')
        .update(JSON.stringify({
        seq: entry.seq,
        ts: entry.ts,
        event: entry.event,
        details: entry.details,
        prevHash: entry.prevHash
    }))
        .digest('hex');
}
function parseLine(line, lineNo) {
    let value;
    try {
        value = JSON.parse(line);
    }
    catch (error) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, `审计日志第 ${lineNo} 行不是合法 JSON`, {
            cause: error
        });
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, `审计日志第 ${lineNo} 行必须是对象`);
    }
    const record = value;
    if (typeof record['seq'] !== 'number' ||
        typeof record['ts'] !== 'number' ||
        typeof record['event'] !== 'string' ||
        typeof record['prevHash'] !== 'string' ||
        typeof record['hash'] !== 'string') {
        throw new PetError(ErrorCode.VAULT_TAMPERED, `审计日志第 ${lineNo} 行字段缺失`);
    }
    const details = typeof record['details'] === 'object' && record['details'] !== null
        ? record['details']
        : {};
    return {
        seq: record['seq'],
        ts: record['ts'],
        event: record['event'],
        details,
        prevHash: record['prevHash'],
        hash: record['hash']
    };
}
async function readEntries(path) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    return text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line, index) => parseLine(line, index + 1));
}
/** 顺序、前向哈希、自身哈希三者任一不符都视为落盘数据被改动。 */
function verifyChain(entries) {
    let prevHash = GENESIS_HASH;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry === undefined)
            continue;
        if (entry.seq !== index + 1) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, `审计日志序号断裂：第 ${index + 1} 条 seq=${entry.seq}`);
        }
        if (entry.prevHash !== prevHash) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, `审计日志链断裂：seq=${entry.seq} 的 prevHash 不匹配`);
        }
        const expected = computeHash(entry);
        if (entry.hash !== expected) {
            throw new PetError(ErrorCode.VAULT_TAMPERED, `审计日志哈希不匹配：seq=${entry.seq}`);
        }
        prevHash = entry.hash;
    }
}
/**
 * 纯 append-only 审计日志（JSON Lines）。
 * 首版不做 Merkle root（17.5 不做清单），用逐条前向哈希保证删行/改行可被发现。
 */
export async function createAuditLog(path) {
    const existing = await readEntries(path);
    verifyChain(existing);
    let lastHash = existing.length > 0 ? (existing[existing.length - 1]?.hash ?? GENESIS_HASH) : GENESIS_HASH;
    let nextSeq = existing.length + 1;
    let queue = Promise.resolve();
    await mkdir(dirname(path), { recursive: true });
    if (existing.length === 0) {
        await writeFile(path, '', { encoding: 'utf8', mode: 0o600 });
        await restrictPermissions(path);
    }
    const append = (event, details = {}) => {
        const run = async () => {
            const base = {
                seq: nextSeq,
                ts: Date.now(),
                event,
                details,
                prevHash: lastHash
            };
            const entry = { ...base, hash: computeHash(base) };
            await appendFile(path, JSON.stringify(entry) + '\n', 'utf8');
            lastHash = entry.hash;
            nextSeq += 1;
            return entry;
        };
        const result = queue.then(run, run);
        queue = result.then(() => undefined, () => undefined);
        return result;
    };
    return {
        append,
        async verify() {
            verifyChain(await readEntries(path));
        },
        async entries() {
            return readEntries(path);
        }
    };
}
//# sourceMappingURL=auditLog.js.map