/** 归一 assetsRoot：先 resolve，再去掉尾部隔符，避免拼出 `...//`。 */
export declare function normalizeRoot(assetsRoot: string): string;
/**
 * 同族目录绕过检查：`assets-evil` 不是 `assets` 的子路径。
 * 必须比较 `resolved === root || resolved.startsWith(root + sep)`。
 */
export declare function isInsideRoot(assetsRoot: string, target: string): boolean;
export declare function assertInsideRoot(assetsRoot: string, target: string): string;
/** `path.resolve` 只做字符串归一，符号链接要单独用 lstat 复查。 */
export declare function assertNotSymlink(path: string): Promise<void>;
/** `.tmp` 下的半写入文件不能被 Scaler 或索引当成正式资源。 */
export declare function isTempPath(assetsRoot: string, target: string): boolean;
