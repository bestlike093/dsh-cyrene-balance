/**
 * 路径安全。
 *
 * 桌宠要往用户机器上写东西，最先要挡住的是「写到围栏外面」。
 * 这一层只做判定，不碰文件系统——真正的写入由宿主注入。
 *
 * 对应能力：`io.file.write`、`io.download`。
 */
export declare class PathRejectedError extends Error {
    readonly reason: PathRejectReason;
    constructor(reason: PathRejectReason, message: string);
}
export type PathRejectReason = 'empty' | 'absolute' | 'traversal' | 'reserved-character' | 'reserved-name' | 'too-long' | 'escapes-root';
/**
 * 把用户给的文件名洗成能落盘的样子。
 *
 * 不抛错，尽量救——用户在聊天里说「存成 报告.pdf」，
 * 不该因为带了个冒号就整件事失败。
 */
export declare function sanitizeFilename(name: string, fallback?: string): string;
/**
 * 校验相对路径，确认它落在 `root` 里面。
 *
 * 拒绝绝对路径、盘符、`..`、以及任何含非法字符的片段。
 * 返回规范化后的相对路径（统一用 `/`）。
 */
export declare function assertRelativePath(relative: string, root?: string): string;
/** 从 URL 或 Content-Disposition 里猜一个能用的文件名。 */
export declare function filenameFromUrl(url: string, contentType?: string): string;
/** Content-Type 到扩展名。只认常见的几个，猜不到就留空。 */
export declare function extensionFor(contentType: string | undefined): string;
