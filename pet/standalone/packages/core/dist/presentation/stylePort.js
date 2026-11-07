/**
 * 风格端口实现（S7-d）。
 *
 * 形状 / 间距 / 动效三组令牌的值都是 CSS 片段，统一走 `validateCssValue`。
 * 载荷键形如 `radius.card`、`spacing.gap`、`motion.hover`。
 */
import {} from '@pet/shared';
import { PresentationPortBase } from './portBase.js';
import { validateStyleTokens } from './validators.js';
const GROUPS = ['radius', 'spacing', 'motion'];
export class StylePort extends PresentationPortBase {
    toPatch(value) {
        const patch = {};
        for (const group of GROUPS) {
            for (const [name, raw] of Object.entries(value[group])) {
                patch[`${group}.${name}`] = raw;
            }
        }
        return patch;
    }
    validate(value) {
        return validateStyleTokens(value);
    }
    describeTokens() {
        const value = this.currentOrUndefined();
        if (value === undefined)
            return [];
        return GROUPS.flatMap((group) => Object.keys(value[group]).map((name) => `${group}.${name}`));
    }
}
