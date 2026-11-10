/**
 * 主题端口实现（S7-d）。
 *
 * 校验交给 `validateThemeTokens`，这里只负责两件事：
 * 把色板摊成 `colors.<name>` 的增量载荷；枚举当前生效的令牌名。
 *
 * 未 apply 时不抛错 —— 诊断面板可能在主题还没生效时就来问有哪些令牌。
 */
import { TOKEN_PREFIX } from '@pet/shared';
import { PresentationPortBase } from './portBase.js';
import { validateThemeTokens } from './validators.js';
export class ThemePort extends PresentationPortBase {
    toPatch(value) {
        const patch = {};
        for (const [name, color] of Object.entries(value.colors)) {
            patch[`${TOKEN_PREFIX.colors}.${name}`] = color;
        }
        return patch;
    }
    validate(value) {
        return validateThemeTokens(value);
    }
    describeTokens() {
        const value = this.currentOrUndefined();
        if (value === undefined)
            return [];
        return Object.keys(value.colors).map((name) => `${TOKEN_PREFIX.colors}.${name}`);
    }
}
