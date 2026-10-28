import { ErrorCode, PetError } from '../errors.js';
import { DEFAULT_SETTINGS } from '../types/settings.js';
import { EMOTION_TAGS, SIZE_PROFILES } from '../types/model.js';
const KNOWN_V1_KEYS = new Set([
    'schemaVersion',
    'nickname',
    'ui',
    'scale',
    'font',
    'bubbleRadius',
    'bubbleAlpha',
    'showHud',
    'hudDetail',
    'hudAlpha',
    'askEvery',
    'askHandling',
    'poseEvery',
    'soundLevel'
]);
const HUD_DETAIL = new Set(['full', 'simple', 'simple2']);
const ASK_HANDLING = new Set(['pet-all', 'pet-single', 'both', 'web']);
const UI_MODES = new Set(['pet', 'card']);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function clampNumber(value, fallback, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, value));
}
function pick(value, allowed, fallback) {
    return typeof value === 'string' && allowed.has(value) ? value : fallback;
}
function pickBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function pickNickname(value, fallback) {
    if (typeof value !== 'string')
        return fallback;
    const trimmed = value.trim();
    return trimmed.length === 0 ? fallback : trimmed.slice(0, 32);
}
function pickProfile(value, fallback) {
    if (typeof value === 'string' && (value === 'custom' || value in SIZE_PROFILES)) {
        return value;
    }
    return fallback;
}
function pickEmotion(value, fallback) {
    return typeof value === 'string' && EMOTION_TAGS.includes(value)
        ? value
        : fallback;
}
function fail(code, message) {
    return { ok: false, error: new PetError(code, message) };
}
/** 已经是 v2 的配置：只做字段收敛，不重写用户值。 */
function acceptV2(raw) {
    const base = DEFAULT_SETTINGS;
    const window = isRecord(raw['window']) ? raw['window'] : {};
    const bubble = isRecord(raw['bubble']) ? raw['bubble'] : {};
    const theme = isRecord(raw['theme']) ? raw['theme'] : {};
    const modules = isRecord(raw['modules']) ? raw['modules'] : {};
    const value = {
        schemaVersion: 2,
        nickname: pickNickname(raw['nickname'], base.nickname),
        uiMode: pick(raw['uiMode'], UI_MODES, base.uiMode),
        renderMode: raw['renderMode'] === 'embedded' ||
            raw['renderMode'] === 'standalone' ||
            raw['renderMode'] === 'fixed:card' ||
            raw['renderMode'] === 'headless'
            ? raw['renderMode']
            : base.renderMode,
        profile: pickProfile(raw['profile'], base.profile),
        window: {
            ...(typeof window['x'] === 'number' ? { x: window['x'] } : {}),
            ...(typeof window['y'] === 'number' ? { y: window['y'] } : {}),
            ...(typeof window['height'] === 'number' ? { height: window['height'] } : {}),
            scale: clampNumber(window['scale'], base.window.scale, 0.2, 3),
            alwaysOnTop: pickBoolean(window['alwaysOnTop'], base.window.alwaysOnTop),
            edgeSnap: pickBoolean(window['edgeSnap'], base.window.edgeSnap)
        },
        bubble: {
            mode: bubble['mode'] === 'rotate' ||
                bubble['mode'] === 'info' ||
                bubble['mode'] === 'talk' ||
                bubble['mode'] === 'today' ||
                bubble['mode'] === 'balance'
                ? bubble['mode']
                : base.bubble.mode,
            fontSize: clampNumber(bubble['fontSize'], base.bubble.fontSize, 8, 48),
            radius: clampNumber(bubble['radius'], base.bubble.radius, 0, 64),
            alpha: clampNumber(bubble['alpha'], base.bubble.alpha, 0, 1)
        },
        askHandling: pick(raw['askHandling'], ASK_HANDLING, base.askHandling),
        askEveryMinutes: clampNumber(raw['askEveryMinutes'], base.askEveryMinutes, 0, 1440),
        poseEverySeconds: clampNumber(raw['poseEverySeconds'], base.poseEverySeconds, 0, 3600),
        soundLevel: clampNumber(raw['soundLevel'], base.soundLevel, 0, 1),
        showHud: pickBoolean(raw['showHud'], base.showHud),
        hudDetail: pick(raw['hudDetail'], HUD_DETAIL, base.hudDetail),
        hudAlpha: clampNumber(raw['hudAlpha'], base.hudAlpha, 0, 1),
        theme: {
            preset: typeof theme['preset'] === 'string' ? theme['preset'].slice(0, 64) : base.theme.preset,
            custom: isRecord(theme['custom']) ? theme['custom'] : {}
        },
        modules: modules,
        defaultEmotion: pickEmotion(raw['defaultEmotion'], base.defaultEmotion)
    };
    return { ok: true, value, legacy: {} };
}
/** v1 → v2：字段改名、缺省补全、范围夹取；未知字段原样留在 legacy 里。 */
function fromV1(raw) {
    const base = DEFAULT_SETTINGS;
    const legacy = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!KNOWN_V1_KEYS.has(key))
            legacy[key] = value;
    }
    const uiMode = pick(raw['ui'], UI_MODES, base.uiMode);
    const value = {
        schemaVersion: 2,
        nickname: pickNickname(raw['nickname'], base.nickname),
        uiMode,
        renderMode: base.renderMode,
        profile: base.profile,
        window: {
            scale: clampNumber(raw['scale'], base.window.scale, 0.2, 3),
            alwaysOnTop: base.window.alwaysOnTop,
            edgeSnap: base.window.edgeSnap
        },
        bubble: {
            mode: base.bubble.mode,
            fontSize: clampNumber(raw['font'], base.bubble.fontSize, 8, 48),
            radius: clampNumber(raw['bubbleRadius'], base.bubble.radius, 0, 64),
            alpha: clampNumber(raw['bubbleAlpha'], base.bubble.alpha, 0, 1)
        },
        askHandling: pick(raw['askHandling'], ASK_HANDLING, base.askHandling),
        askEveryMinutes: clampNumber(raw['askEvery'], base.askEveryMinutes, 0, 1440),
        poseEverySeconds: clampNumber(raw['poseEvery'], base.poseEverySeconds, 0, 3600),
        soundLevel: clampNumber(raw['soundLevel'], base.soundLevel, 0, 1),
        showHud: pickBoolean(raw['showHud'], base.showHud),
        hudDetail: pick(raw['hudDetail'], HUD_DETAIL, base.hudDetail),
        hudAlpha: clampNumber(raw['hudAlpha'], base.hudAlpha, 0, 1),
        theme: { preset: base.theme.preset, custom: {} },
        modules: {},
        defaultEmotion: base.defaultEmotion
    };
    return { ok: true, value, legacy };
}
/**
 * 唯一入口：按 schemaVersion 分派。
 * 纯函数，不读写磁盘；失败时调用方保持旧配置即可完成回滚。
 */
export function migrateSettings(raw) {
    if (!isRecord(raw)) {
        return fail(ErrorCode.INVALID_ARGUMENT, '配置必须是对象');
    }
    const version = raw['schemaVersion'];
    if (version === 2)
        return acceptV2(raw);
    if (version === undefined || version === 1)
        return fromV1(raw);
    return fail(ErrorCode.SETTINGS_MIGRATION_FAILED, `不支持的配置版本：${String(version)}`);
}
/** 便捷包装：失败直接抛 PetError，适合调用方已经准备好回滚路径的场景。 */
export function migrateSettingsOrThrow(raw) {
    const result = migrateSettings(raw);
    if (!result.ok)
        throw result.error;
    return { value: result.value, legacy: result.legacy };
}
//# sourceMappingURL=migrate.js.map