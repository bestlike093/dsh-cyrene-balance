/**
 * 表现层白名单校验器（S7-d）。
 *
 * 纯函数：同步、不读文件、不做 IO —— 这是它能边输入边调用的前提。
 * 字体魔数校验不在这里，它在 `register()` 的异步路径里（要读文件头）。
 *
 * 每个函数都收集完全部错误再返回，不在第一条错误处短路。
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_FN = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)$/;
const TOKEN_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const FONT_FAMILY = /^[A-Za-z0-9 _-]+$/;
const CSS_VALUE_FORBIDDEN = /[;{}()]|url\s*\(/i;
const FONT_FORMATS = ['ttf', 'otf', 'woff', 'woff2'];
export function validateColor(field, value) {
    if (HEX_COLOR.test(value) || COLOR_FN.test(value) || TOKEN_NAME.test(value))
        return [];
    return [
        {
            field,
            reason: 'INVALID_COLOR',
            hint: '颜色只接受 #RGB / #RRGGBB / #RRGGBBAA、rgb() / rgba() 或预置变量名'
        }
    ];
}
export function validateFontFamily(field, value) {
    if (value.length === 0) {
        return [{ field, reason: 'INVALID_FAMILY', hint: '字体名不能为空' }];
    }
    if (!FONT_FAMILY.test(value) || /url/i.test(value)) {
        return [
            {
                field,
                reason: 'INVALID_FAMILY',
                hint: '字体名只允许字母、数字、空格、- 和 _，不得含 url、括号或分号'
            }
        ];
    }
    return [];
}
export function validateFontWeight(field, value) {
    if (Number.isInteger(value) && value >= 100 && value <= 900)
        return [];
    return [{ field, reason: 'OUT_OF_RANGE', hint: 'font-weight 需为 100–900 的整数' }];
}
export function validateCssValue(field, value) {
    if (value.length === 0) {
        return [{ field, reason: 'INVALID_TOKEN', hint: '令牌值不能为空' }];
    }
    if (CSS_VALUE_FORBIDDEN.test(value)) {
        return [{ field, reason: 'INVALID_TOKEN', hint: '令牌值不得包含 ; { } ( ) 或 url(' }];
    }
    return [];
}
export function validateAssetRef(field, value) {
    if (value.length === 0) {
        return [{ field, reason: 'INVALID_RESOURCE', hint: '资源引用不能为空' }];
    }
    if (value.startsWith('/') || value.startsWith('\\') || value.includes('..')) {
        return [
            { field, reason: 'INVALID_RESOURCE', hint: '资源引用必须是相对路径，不得含 .. 或以分隔符开头' }
        ];
    }
    return [];
}
export function validateThemeTokens(value) {
    const errors = [];
    for (const [name, color] of Object.entries(value.colors)) {
        errors.push(...validateColor(`colors.${name}`, color));
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
export function validateStyleTokens(value) {
    const errors = [];
    for (const group of ['radius', 'spacing', 'motion']) {
        for (const [name, raw] of Object.entries(value[group])) {
            errors.push(...validateCssValue(`${group}.${name}`, raw));
        }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
export function validateFontSource(value) {
    const errors = [
        ...validateFontFamily('family', value.family),
        ...validateFontWeight('weight', value.weight),
        ...validateAssetRef('assetRef', value.assetRef)
    ];
    if (!FONT_FORMATS.includes(value.format)) {
        errors.push({
            field: 'format',
            reason: 'INVALID_RESOURCE',
            hint: '只接受 ttf / otf / woff / woff2'
        });
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
