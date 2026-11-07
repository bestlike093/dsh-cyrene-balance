/**
 * 风格端口（文档第 10 章）。形状 / 间距 / 动效令牌。
 * 广播、校验、生命周期等共同成员由 IPresentationPortV1 提供。
 */
import type { IPresentationPortV1 } from './presentation.js';
export interface StyleTokensV1 {
    readonly id: string;
    readonly radius: Readonly<Record<string, string>>;
    readonly spacing: Readonly<Record<string, string>>;
    readonly motion: Readonly<Record<string, string>>;
}
export interface IStylePortV1 extends IPresentationPortV1<StyleTokensV1> {
}
