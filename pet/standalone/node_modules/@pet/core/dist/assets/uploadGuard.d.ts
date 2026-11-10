import { type AssetKind } from './assetManager.js';
export type UploadExtension = '.png' | '.jpg' | '.jpeg' | '.webp' | '.gif' | '.mp4' | '.webm' | '.zip' | '.json' | '.moc' | '.moc3';
interface UploadRule {
    /** 浏览器 `File.type` 可能给出的声明类型。 */
    readonly declaredMimes: readonly string[];
    /** 魔数检测允许的结果；空数组表示该格式没有可判定的魔数。 */
    readonly magicMimes: readonly string[];
    readonly maxBytes: number;
    readonly kind: AssetKind;
}
/** 6.1 的扩展名白名单与单文件上限。 */
export declare const UPLOAD_RULES: Readonly<Record<UploadExtension, UploadRule>>;
export interface UploadProbe {
    readonly fileName: string;
    /** 浏览器给的 `File.type`；拿不到时为空串。 */
    readonly declaredMime: string;
    /** 文件前 512 字节；魔数只需要头部。 */
    readonly head: Uint8Array;
    readonly size: number;
}
export interface UploadAcceptance {
    readonly extension: UploadExtension;
    readonly mime: string;
    readonly kind: AssetKind;
    readonly size: number;
}
export declare function extensionOf(fileName: string): string;
/**
 * MIME + 扩展名双校验，再用魔数复核。
 *
 * 顺序固定：扩展名 → 大小 → 声明 MIME → 魔数。
 * 声明 MIME 为空时只靠扩展名与魔数，避免浏览器对 `.moc` 等格式返回空串时误伤。
 */
export declare function inspectUpload(probe: UploadProbe): UploadAcceptance;
export {};
