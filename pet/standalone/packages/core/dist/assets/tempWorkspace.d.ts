/** 临时目录固定在 assetsRoot 之内，保证 move 不跨分区、路径检查也覆盖它。 */
export declare const TMP_DIR_NAME = ".tmp";
/** 启动清理的默认阈值：24 小时。 */
export declare const DEFAULT_TMP_MAX_AGE_MS: number;
export declare function tmpRoot(assetsRoot: string): string;
export interface TempWorkspace {
    readonly dir: string;
    readonly path: string;
    dispose(): Promise<void>;
}
/**
 * 在 `<assetsRoot>/.tmp/` 下创建一个随机命名的临时文件。
 *
 * 文件名用 randomUUID，不沿用原始文件名——原文件名可能带 `../` 或平台保留字。
 * dispose 幂等，删除失败也不抛（force: true）。
 */
export declare function createTempWorkspace(assetsRoot: string, extension?: string): Promise<TempWorkspace>;
export interface SweepOptions {
    /** 便于测试注入固定时间。 */
    readonly now?: number;
    readonly maxAgeMs?: number;
}
/**
 * 启动时扫一次 `.tmp/`，清掉超龄残留。
 * 只处理 `.tmp` 下的直接条目，不递归到外部路径。
 */
export declare function sweepStaleTmp(assetsRoot: string, options?: SweepOptions): Promise<string[]>;
