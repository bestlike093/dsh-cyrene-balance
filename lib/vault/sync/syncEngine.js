import { ErrorCode, HybridClock, PetError, compareHlc, parseHlc } from '../_shared/index.js';
function validateRecord(record) {
    if (typeof record.key !== 'string' || record.key.length === 0 || record.key.length > 128) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '同步记录的 key 不合法');
    }
    if (typeof record.hlc !== 'string' || record.hlc.length === 0) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '同步记录的 hlc 不合法');
    }
}
function stableSort(records) {
    return [...records].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
/**
 * 增量同步引擎。
 * 合并策略：HLC 大者胜（LWW），同 HLC 同值视为重放直接跳过，
 * 同 HLC 不同值保留本地并记录冲突，交上层提示用户。
 */
export class SyncEngine {
    records = new Map();
    clock;
    now;
    maxSkewMs;
    node;
    constructor(options) {
        if (typeof options.node !== 'string' || options.node.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '同步节点名不能为空');
        }
        this.node = options.node;
        this.clock = options.clock ?? new HybridClock(options.node);
        this.now = options.now ?? Date.now;
        this.maxSkewMs = options.maxSkewMs ?? 5 * 60 * 1000;
    }
    get nodeName() {
        return this.node;
    }
    put(key, value) {
        if (typeof key !== 'string' || key.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '同步 key 不能为空');
        }
        const record = { key, value, hlc: this.clock.now() };
        this.records.set(key, record);
        return record;
    }
    get(key) {
        return this.records.get(key);
    }
    snapshot() {
        return stableSort([...this.records.values()]);
    }
    /** 增量导出：只返回比 since 更新的记录，按 key 稳定排序。 */
    since(hlc) {
        const records = [...this.records.values()].filter((record) => hlc === undefined || compareHlc(record.hlc, hlc) > 0);
        return { node: this.node, records: stableSort(records) };
    }
    merge(remote) {
        if (typeof remote.node !== 'string' || remote.node.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '远端节点名不能为空');
        }
        if (!Array.isArray(remote.records)) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '远端变更集必须是数组');
        }
        // 先整批校验，避免一半写入一半失败
        const now = this.now();
        for (const record of remote.records) {
            validateRecord(record);
            const wall = parseHlc(record.hlc).wall;
            if (wall <= 0 || Math.abs(now - wall) > this.maxSkewMs) {
                throw new PetError(ErrorCode.TIMESTAMP_EXPIRED, `同步时间戳超出允许偏差：${record.key}`, {
                    details: { key: record.key, hlc: record.hlc, now, maxSkewMs: this.maxSkewMs }
                });
            }
        }
        const conflicts = [];
        for (const record of remote.records) {
            const local = this.records.get(record.key);
            if (local === undefined) {
                this.records.set(record.key, record);
                continue;
            }
            if (record.hlc === local.hlc) {
                // 同时间戳同值 = 重放，幂等跳过
                if (JSON.stringify(record.value) !== JSON.stringify(local.value)) {
                    conflicts.push({
                        key: record.key,
                        localHlc: local.hlc,
                        remoteHlc: record.hlc,
                        winner: 'local'
                    });
                }
                continue;
            }
            if (compareHlc(record.hlc, local.hlc) > 0) {
                this.records.set(record.key, record);
                conflicts.push({
                    key: record.key,
                    localHlc: local.hlc,
                    remoteHlc: record.hlc,
                    winner: 'remote'
                });
            }
            else {
                conflicts.push({
                    key: record.key,
                    localHlc: local.hlc,
                    remoteHlc: record.hlc,
                    winner: 'local'
                });
            }
        }
        conflicts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        return { records: this.snapshot(), conflicts };
    }
}
//# sourceMappingURL=syncEngine.js.map