/**
 * 主题端口实现（S7-d）。
 *
 * 校验交给 `validateThemeTokens`，这里只负责两件事：
 * 把色板摊成 `colors.<name>` 的增量载荷；枚举当前生效的令牌名。
 *
 * 未 apply 时不抛错 —— 诊断面板可能在主题还没生效时就来问有哪些令牌。
 */
import { type IThemePortV1, type ThemeTokensV1, type TokenPatchV1, type ValidationResultV1 } from '@pet/shared';
import { PresentationPortBase } from './portBase.js';
export declare class ThemePort extends PresentationPortBase<ThemeTokensV1> implements IThemePortV1 {
    protected toPatch(value: ThemeTokensV1): TokenPatchV1;
    validate(value: ThemeTokensV1): ValidationResultV1;
    describeTokens(): readonly string[];
}
