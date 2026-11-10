/**
 * 往围栏内写文件。
 *
 * 三件事必须做到：
 *
 * 1. 路径先过 `assertRelativePath`，写到围栏外面直接拒绝
 * 2. 大小先看，超限不写，别等写了一半才发现
 * 3. 原子落盘：先写临时文件再改名，中途失败不留半截文件
 *
 * 文件系统由宿主注入，core 不 import `node:fs`。
 * 对应能力：`io.file.write`、`io.download`。
 */
/** 宿主需要提供的最小文件操作。 */
export interface FileWriterPort {
    write(path: string, data: Uint8Array): Promise<void>;
    /** 可选：实现应做原子替换。不提供时退回先删后写。 */
    move?(from: string, to: string): Promise<void>;
    remove?(path: string): Promise<void>;
    exists?(path: string): Promise<boolean>;
}
export declare class FileTooLargeError extends Error {
    readonly bytes: number;
    readonly limit: number;
    constructor(bytes: number, limit: number);
}
export declare class FileExistsError extends Error {
    readonly path: string;
    constructor(path: string);
}
export interface WriteOptions {
    /** 字节上限，默认 16 MiB。 */
    readonly maxBytes?: number;
    /** 已存在时怎么办。默认 `error`，避免悄悄覆盖用户的文件。 */
    readonly onExists?: 'error' | 'overwrite' | 'rename';
    /** 重名时加的后缀，默认 `-1`、`-2`… */
    readonly renameSuffix?: (index: number) => string;
}
export interface WriteResult {
    /** 围栏内的相对路径，`/` 分隔。 */
    readonly relativePath: string;
    /** 实际写入的字节数。 */
    readonly bytes: number;
    /** 是否因为重名改过名。 */
    readonly renamed: boolean;
}
/**
 * 把数据写进 `root` 围栏内。
 *
 * 返回围栏内相对路径，不返回绝对路径——绝对路径里带用户名，
 * 容易在日志或界面里漏出去。
 */
export declare function writeFenced(port: FileWriterPort, root: string, relativePath: string, data: Uint8Array, options?: WriteOptions): Promise<WriteResult>;
/** 把相对路径拼到根上，统一用 `/`；不处理盘符，那是调用方的事。 */
export declare function join(root: string, relative: string): string;
