/** 压缩包内一律拒绝的类型：可执行、可注入脚本、可带外链的 SVG。 */
export declare const FORBIDDEN_ENTRY_EXTENSIONS: ReadonlySet<string>;
export interface ZipLimits {
    /** 允许的最大嵌套层数，外层算第 1 层。 */
    readonly maxDepth: number;
    /** 整个压缩包（含嵌套）允许的条目总数。 */
    readonly maxEntries: number;
    /** 实际解压出的字节总数；不看 zip 头里的未压缩大小。 */
    readonly maxTotalBytes: number;
}
export declare const DEFAULT_ZIP_LIMITS: ZipLimits;
export interface ExtractZipResult {
    /** 成功落盘的相对路径，不含目录条目与嵌套包本身。 */
    readonly files: readonly string[];
    readonly entryCount: number;
    readonly totalBytes: number;
    /** 实际到达的最深层数。 */
    readonly maxDepth: number;
}
/**
 * 把 zip 解压到 `destDir`。
 *
 * 先解到同父目录的 staging，成功后才 rename 到目标。
 * 任何一步失败只删 staging，绝不对 `destDir` 做递归删除：
 * 调用方传进来的目录可能已经有用户文件，失败不能把它们一起带走。
 */
export declare function extractZipSafely(zipPath: string, destDir: string, limits?: Partial<ZipLimits>): Promise<ExtractZipResult>;
