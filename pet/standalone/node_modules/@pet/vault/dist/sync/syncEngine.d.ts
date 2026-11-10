import { HybridClock } from '@pet/shared';
export interface SyncRecord {
    readonly key: string;
    readonly value: unknown;
    /** 定长 HLC 字符串，可直接按字典序比较 */
    readonly hlc: string;
}
export interface SyncChangeSet {
    readonly node: string;
    readonly records: readonly SyncRecord[];
}
export interface SyncConflict {
    readonly key: string;
    readonly localHlc: string;
    readonly remoteHlc: string;
    readonly winner: 'local' | 'remote';
}
export interface MergeResult {
    readonly records: readonly SyncRecord[];
    readonly conflicts: readonly SyncConflict[];
}
export interface SyncEngineOptions {
    readonly node: string;
    readonly clock?: HybridClock;
    readonly now?: () => number;
    /** 允许的时钟偏差，超出即拒绝整批，防止旧包重放 */
    readonly maxSkewMs?: number;
}
/**
 * 增量同步引擎。
 * 合并策略：HLC 大者胜（LWW），同 HLC 同值视为重放直接跳过，
 * 同 HLC 不同值保留本地并记录冲突，交上层提示用户。
 */
export declare class SyncEngine {
    private readonly records;
    private readonly clock;
    private readonly now;
    private readonly maxSkewMs;
    private readonly node;
    constructor(options: SyncEngineOptions);
    get nodeName(): string;
    put(key: string, value: unknown): SyncRecord;
    get(key: string): SyncRecord | undefined;
    snapshot(): readonly SyncRecord[];
    /** 增量导出：只返回比 since 更新的记录，按 key 稳定排序。 */
    since(hlc?: string): SyncChangeSet;
    merge(remote: SyncChangeSet): MergeResult;
}
