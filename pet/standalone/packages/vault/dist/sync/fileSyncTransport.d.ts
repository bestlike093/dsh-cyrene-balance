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
import type { SyncChangeSet } from './syncEngine.js';
export declare const SYNC_PACKET_FORMAT = "pet-sync-changeset";
export declare const SYNC_PACKET_VERSION = 1;
/** 单个变更集文件上限。正常设置同步只有几百字节。 */
export declare const SYNC_MAX_PACKET_BYTES: number;
/** 一次最多读取的待处理包数量，防止目录被异常堆积撑爆。 */
export declare const SYNC_MAX_PENDING_PACKETS = 200;
export interface CollectedPacket {
    readonly path: string;
    readonly changeSet: SyncChangeSet;
}
export interface SkippedPacket {
    readonly path: string;
    readonly reason: string;
}
export interface CollectResult {
    readonly packets: readonly CollectedPacket[];
    readonly skipped: readonly SkippedPacket[];
}
export interface FileSyncTransportOptions {
    readonly dir: string;
    readonly node: string;
    readonly maxPacketBytes?: number;
    readonly maxPending?: number;
}
export interface FileSyncTransport {
    readonly dir: string;
    readonly node: string;
    /** 原子写入一份变更集，返回文件绝对路径。 */
    publish(changeSet: SyncChangeSet): Promise<string>;
    /** 读取其他节点留下的变更集，按文件名（HLC 前缀）排序。 */
    collect(): Promise<CollectResult>;
    /** 合并成功后删除已消费的包。 */
    ack(paths: readonly string[]): Promise<void>;
}
export declare function createFileSyncTransport(options: FileSyncTransportOptions): FileSyncTransport;
