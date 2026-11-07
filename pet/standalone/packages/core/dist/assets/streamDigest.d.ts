export interface DigestOptions {
    /** 该类型允许的最大字节数；超限时中途中止，不读完再判。 */
    readonly maxBytes: number;
    /** 需要留给魔数检测的头部长度。 */
    readonly headBytes?: number;
    readonly chunkSize?: number;
}
export interface DigestResult {
    readonly sha256: string;
    /** 文件前 `headBytes` 字节；不足则原样返回。 */
    readonly head: Uint8Array;
    readonly size: number;
}
/**
 * 一次 open 完成「读头部 + 流式 SHA-256」。
 *
 * 循环里读到超限立刻停，错误详情带上实际读取量，方便断言拦截发生在中途。
 * digest() 只在正常读完后调用；任何异常路径都不会产生摘要。
 */
export declare function digestFile(path: string, options: DigestOptions): Promise<DigestResult>;
