/**
 * dsh 安装包里 api-catalog 的固定位置。
 *
 * asar 目录树里的路径不带前导斜杠；带斜杠是给人读诊断信息用的。
 */
export declare const API_CATALOG_ENTRY = "dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js";
export type ReadBinaryFile = (path: string) => Promise<Buffer>;
interface AsarEntry {
    readonly offset: number;
    readonly size: number;
}
/**
 * 从 asar 里取出 api-catalog 的文本。
 *
 * 任何一步失败都返回 `undefined`，由调用方决定「宿主在线但无法确认能力」
 * 还是上抛 `HostProbeError`。这里不抛，是因为「安装包里没有这个文件」
 * 在不同 dsh 版本上是正常现象，不该让整个探测失败。
 */
export declare function readApiCatalogText(installDir: string, readBinaryFile?: ReadBinaryFile): Promise<string | undefined>;
/** 解析 asar 头，定位目标文件的字节区间。 */
export declare function locateEntry(buffer: Buffer, entryPath?: string): AsarEntry | undefined;
/**
 * 从 api-catalog 源码里抽出 `SERVICE_API` 的 key。
 *
 * 只扫 `export const SERVICE_API = [` 到下一个 `];` 之间，
 * 避免误抓事件表或参数名里的同名片段。
 */
export declare function extractServiceApiKeys(text: string): readonly string[];
/** 读安装包里的 api-catalog key；拿不到时返回 `undefined`。 */
export declare function readApiCatalogKeys(installDir: string, readBinaryFile?: ReadBinaryFile): Promise<readonly string[] | undefined>;
export {};
