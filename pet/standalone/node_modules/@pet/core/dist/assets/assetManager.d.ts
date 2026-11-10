import type { ModelKind } from '@pet/shared';
/** 资产策略：扩展名白名单 + 单文件上限。默认 64 MiB，足够放立绘与短视频。 */
export interface AssetPolicy {
    readonly maxBytes: number;
    /** 小写扩展名（含点）→ 期望 MIME */
    readonly extensions: Readonly<Record<string, string>>;
}
export declare const DEFAULT_ASSET_EXTENSIONS: Readonly<Record<string, string>>;
export declare const DEFAULT_ASSET_POLICY: AssetPolicy;
export type AssetKind = ModelKind | 'json';
export interface VerifiedAsset {
    readonly relPath: string;
    readonly absolutePath: string;
    readonly mime: string;
    readonly kind: AssetKind;
    readonly size: number;
}
/** 按魔数判真实类型。返回 null 表示不认识，调用方必须拒绝。 */
export declare function detectMime(bytes: Uint8Array): string | null;
/**
 * 资产边界检查器。
 * 只做「路径是否在根内 + 扩展名/魔数/大小是否合法」，不做网络与 DOM 访问。
 */
export declare class AssetManager {
    private readonly root;
    private readonly policy;
    constructor(root: string, policy?: Partial<AssetPolicy>);
    /** 规范化相对路径；任何越出根目录的写法都直接拒绝。 */
    resolve(relPath: string): string;
    /** 校验字节内容。顺序：扩展名 → 大小 → 魔数，保证错误码稳定可判等。 */
    verify(relPath: string, bytes: Uint8Array): VerifiedAsset;
}
