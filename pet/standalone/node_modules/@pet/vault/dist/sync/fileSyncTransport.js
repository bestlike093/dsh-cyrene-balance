/**
 * 本机目录传输层：把 SyncEngine 的变更集写成文件，供同目录下的另一个节点读取。
 *
 * 这一层不联网，也不负责调度。它的用途是让「双实例同目录」的端到端行为可以被
 * 真实文件系统验证：导出、读取、合并、冲突、重放、时钟偏差都不需要模拟网络。
 *
 * 目录约定：
 *   <dir>/<node>/<hlc>-<seq>.json
 *
 * 每个节点只写自己的目录，读取时跳过自己的目录，避免自读自合。
 */
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { ErrorCode, PetError } from '@pet/shared';
export const SYNC_PACKET_FORMAT = 'pet-sync-changeset';
export const SYNC_PACKET_VERSION = 1;
/** 单个变更集文件上限。正常设置同步只有几百字节。 */
export const SYNC_MAX_PACKET_BYTES = 512 * 1024;
/** 一次最多读取的待处理包数量，防止目录被异常堆积撑爆。 */
export const SYNC_MAX_PENDING_PACKETS = 200;
const NODE_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
function assertNodeName(node) {
    if (!NODE_PATTERN.test(node)) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '同步节点名只允许字母、数字、点、下划线和短横线，长度 1–40');
    }
}
function isSafeFileName(name) {
    return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('..');
}
function parsePacket(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '同步包不是合法 JSON', { cause: error });
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '同步包必须是对象');
    }
    const packet = parsed;
    if (packet.format !== SYNC_PACKET_FORMAT || packet.version !== SYNC_PACKET_VERSION) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '同步包格式或版本不受支持');
    }
    const changeSet = packet.changeSet;
    if (typeof changeSet !== 'object' ||
        changeSet === null ||
        typeof changeSet.node !== 'string' ||
        !Array.isArray(changeSet.records)) {
        throw new PetError(ErrorCode.VAULT_TAMPERED, '同步包缺少变更集');
    }
    return changeSet;
}
export function createFileSyncTransport(options) {
    assertNodeName(options.node);
    const dir = options.dir;
    const node = options.node;
    const maxPacketBytes = options.maxPacketBytes ?? SYNC_MAX_PACKET_BYTES;
    const maxPending = options.maxPending ?? SYNC_MAX_PENDING_PACKETS;
    return {
        dir,
        node,
        async publish(changeSet) {
            if (changeSet.node !== node) {
                throw new PetError(ErrorCode.INVALID_ARGUMENT, '变更集节点与传输层节点不一致');
            }
            const body = JSON.stringify({
                format: SYNC_PACKET_FORMAT,
                version: SYNC_PACKET_VERSION,
                changeSet
            });
            if (new TextEncoder().encode(body).byteLength > maxPacketBytes) {
                throw new PetError(ErrorCode.INVALID_ARGUMENT, `同步包超出上限（${maxPacketBytes} 字节）`);
            }
            const ownDir = join(dir, node);
            await mkdir(ownDir, { recursive: true });
            const maxHlc = changeSet.records.reduce((current, record) => (record.hlc > current ? record.hlc : current), '');
            const safeHlc = maxHlc.replace(/[^A-Za-z0-9._-]/g, '-');
            const target = join(ownDir, `${safeHlc || 'empty'}-${Date.now()}.json`);
            const temp = `${target}.tmp`;
            await writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
            await rename(temp, target);
            return target;
        },
        async collect() {
            const packets = [];
            const skipped = [];
            let entries;
            try {
                entries = await readdir(dir, { withFileTypes: true });
            }
            catch (error) {
                const code = error.code;
                if (code === 'ENOENT')
                    return { packets, skipped };
                throw error;
            }
            const otherNodes = entries
                .filter((entry) => entry.isDirectory() && entry.name !== node)
                .map((entry) => entry.name)
                .filter((name) => NODE_PATTERN.test(name))
                .sort();
            for (const other of otherNodes) {
                if (packets.length >= maxPending)
                    break;
                const nodeDir = join(dir, other);
                const files = (await readdir(nodeDir)).filter(isSafeFileName).sort();
                for (const file of files) {
                    if (packets.length >= maxPending)
                        break;
                    const filePath = join(nodeDir, file);
                    try {
                        const info = await stat(filePath);
                        if (!info.isFile()) {
                            skipped.push({ path: filePath, reason: '不是普通文件' });
                            continue;
                        }
                        if (info.size > maxPacketBytes) {
                            skipped.push({ path: filePath, reason: '超出单包大小上限' });
                            continue;
                        }
                        packets.push({
                            path: filePath,
                            changeSet: parsePacket(await readFile(filePath, 'utf8'))
                        });
                    }
                    catch (error) {
                        skipped.push({
                            path: filePath,
                            reason: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
            return { packets, skipped };
        },
        async ack(paths) {
            const rootPrefix = resolve(dir) + sep;
            const ownPrefix = resolve(join(dir, node)) + sep;
            for (const filePath of paths) {
                const normalized = resolve(filePath);
                // 只删同步根目录下、其它节点写下的包；自己的目录与越界路径都不动。
                if (!normalized.startsWith(rootPrefix) || normalized.startsWith(ownPrefix))
                    continue;
                await unlink(normalized).catch(() => undefined);
            }
        }
    };
}
