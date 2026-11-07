/**
 * 主题端口（文档第 10 章）。色板令牌。
 * 广播、校验、生命周期等共同成员由 IPresentationPortV1 提供。
 */
import type { IPresentationPortV1 } from './presentation.js';
export interface ThemeTokensV1 {
    readonly id: string;
    /** 键为颜色名；值必须通过色值白名单（`#RGB` / `#RRGGBB(AA)` / `rgb()` / `rgba()` / 预置变量名）。 */
    readonly colors: Readonly<Record<string, string>>;
}
export interface IThemePortV1 extends IPresentationPortV1<ThemeTokensV1> {
}
