/**
 * 风格端口实现（S7-d）。
 *
 * 形状 / 间距 / 动效三组令牌的值都是 CSS 片段，统一走 `validateCssValue`。
 * 载荷键形如 `radius.card`、`spacing.gap`、`motion.hover`。
 */
import { type IStylePortV1, type StyleTokensV1, type TokenPatchV1, type ValidationResultV1 } from '@pet/shared';
import { PresentationPortBase } from './portBase.js';
export declare class StylePort extends PresentationPortBase<StyleTokensV1> implements IStylePortV1 {
    protected toPatch(value: StyleTokensV1): TokenPatchV1;
    validate(value: StyleTokensV1): ValidationResultV1;
    describeTokens(): readonly string[];
}
