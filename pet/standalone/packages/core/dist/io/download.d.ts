/**
 * 从网上下载文件，落到围栏里。
 *
 * 两道大小闸：先看 `Content-Length`，太大的直接别开始；
 * 下完再看实际字节数，防止对方谎报。
 *
 * 对应能力：`io.download`。
 */
import type { FileWriterPort, WriteOptions, WriteResult } from './fileWrite.js';
/** 够用的 fetch 子集。宿主传 `globalThis.fetch` 进来即可。 */
export interface BinaryFetchResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly headers: {
        get(name: string): string | null;
    };
    arrayBuffer(): Promise<ArrayBuffer>;
}
export type BinaryFetch = (url: string, init?: {
    readonly headers?: Readonly<Record<string, string>>;
}) => Promise<BinaryFetchResponse>;
export declare class DownloadRejectedError extends Error {
    readonly reason: 'bad-url' | 'http-error' | 'empty';
    constructor(reason: DownloadRejectedError['reason'], message: string);
}
export interface DownloadOptions {
    readonly maxBytes?: number;
    /** 存成什么名字。不传就从 URL 猜。 */
    readonly filename?: string;
    readonly headers?: Readonly<Record<string, string>>;
    /** 落盘时的重名策略，默认改为加序号，不覆盖。 */
    readonly onExists?: WriteOptions['onExists'];
}
export interface DownloadResult extends WriteResult {
    /** 服务端给的 Content-Type。 */
    readonly contentType: string | null;
    /** 实际下载的字节数。 */
    readonly bytes: number;
}
/**
 * 下载并写入。
 *
 * 成功返回围栏内相对路径与字节数，不返回绝对路径。
 */
export declare function downloadToFence(url: string, port: FileWriterPort, fetchImpl: BinaryFetch, root: string, options?: DownloadOptions): Promise<DownloadResult>;
