/**
 * 字体端口（文档第 10 章）。字体源注册与回退解析。
 * 广播、校验、生命周期等共同成员由 IPresentationPortV1 提供。
 */
import type { IPresentationPortV1 } from './presentation.js';
export type FontFormatV1 = 'ttf' | 'otf' | 'woff' | 'woff2';
export interface FontSourceV1 {
    readonly id: string;
    /** 必须过白名单：仅字母 / 数字 / `-` / `_` / 空格，拒绝 `;` `}` `(` `url`。 */
    readonly family: string;
    readonly format: FontFormatV1;
    /** 已过上传流水线安全校验的引用，不得是裸路径。 */
    readonly assetRef: string;
    /** 100..900。 */
    readonly weight: number;
    readonly style: 'normal' | 'italic';
    /** 自定义字体需明示来源。 */
    readonly licenseNote?: string;
}
export interface ResolvedFontV1 {
    readonly source: FontSourceV1;
    /** true = 请求的字体不可用，返回的是系统回退字体。 */
    readonly isFallback: boolean;
    readonly requestedFamily: string;
}
export interface IFontPortV1 extends IPresentationPortV1<FontSourceV1> {
    /**
     * 不返回 null。
     * - family 不可用但系统回退可用 ⇒ `isFallback: true`；
     * - 回退链也构造不出来 ⇒ 抛 `NO_FALLBACK_AVAILABLE`。
     *
     * weight / style 不匹配时取最近权重，属于正常渲染行为，不算 fallback。
     */
    resolve(family: string, weight: number): ResolvedFontV1;
}
