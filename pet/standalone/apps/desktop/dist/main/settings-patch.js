// 设置合并与写入白名单（从 electron/main.mjs 原样迁出）。
//
// mergeLayer：递归合并，patch 未提及的键保持原值。
// sanitizeSettingsPatch：只放行 DEFAULT_SETTINGS 登记过的顶层键与一层子键，
// 防止渲染侧把 llmApiKey 之类字段写进明文 settings.json。
//
// 边界输入（null / undefined / 字符串 / 数组）返回空对象，不抛。
import { DEFAULT_SETTINGS } from '@pet/shared';
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function mergeLayer(base, patch) {
    if (!isPlainObject(patch))
        return patch;
    const out = { ...(isPlainObject(base) ? base : {}) };
    for (const [key, value] of Object.entries(patch)) {
        out[key] = isPlainObject(value) ? mergeLayer(out[key], value) : value;
    }
    return out;
}
export const SETTINGS_TOP_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const SETTINGS_SUB_KEYS = {
    window: new Set(Object.keys(DEFAULT_SETTINGS.window)),
    bubble: new Set(Object.keys(DEFAULT_SETTINGS.bubble)),
    icon: new Set(Object.keys(DEFAULT_SETTINGS.icon)),
    sticker: new Set(Object.keys(DEFAULT_SETTINGS.sticker)),
    voice: new Set(Object.keys(DEFAULT_SETTINGS.voice)),
    theme: new Set(Object.keys(DEFAULT_SETTINGS.theme)),
    presence: new Set(Object.keys(DEFAULT_SETTINGS.presence)),
    balance: new Set(Object.keys(DEFAULT_SETTINGS.balance)),
    companion: new Set(Object.keys(DEFAULT_SETTINGS.companion))
};
const SETTINGS_DEEP_KEYS = {
    channels: {
        qq: new Set(Object.keys(DEFAULT_SETTINGS.channels.qq))
    }
};
export function sanitizeSettingsPatch(patch) {
    if (!isPlainObject(patch))
        return {};
    const out = {};
    for (const [key, value] of Object.entries(patch)) {
        if (!SETTINGS_TOP_KEYS.has(key))
            continue;
        const deep = SETTINGS_DEEP_KEYS[key];
        if (deep !== undefined) {
            // 二层对象：channels.qq 只保留已知字段，别的渠道 / 未知键一律不落盘。
            if (!isPlainObject(value))
                continue;
            const filtered = {};
            for (const [childKey, childValue] of Object.entries(value)) {
                const childAllowed = deep[childKey];
                if (childAllowed === undefined || !isPlainObject(childValue))
                    continue;
                const childFiltered = {};
                for (const [field, fieldValue] of Object.entries(childValue)) {
                    if (childAllowed.has(field))
                        childFiltered[field] = fieldValue;
                }
                filtered[childKey] = childFiltered;
            }
            out[key] = filtered;
            continue;
        }
        const allowedSub = SETTINGS_SUB_KEYS[key];
        if (allowedSub !== undefined && isPlainObject(value)) {
            const filtered = {};
            for (const [sub, subValue] of Object.entries(value)) {
                if (allowedSub.has(sub))
                    filtered[sub] = subValue;
            }
            out[key] = filtered;
            continue;
        }
        out[key] = value;
    }
    return out;
}
