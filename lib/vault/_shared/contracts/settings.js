/**
 * 配置 schema v2.1 契约（文档第 13 章）。
 * 与现有扁平 SettingsV2 并存：v2.1 是目标形状，迁移函数负责过渡。
 */
import { ALL_PERMISSIONS } from '../types/module.js';
import { EMOTION_TAGS } from '../types/model.js';
const DEFAULT_MODULES = {
    'task-progress': { enabled: true, renderMode: 'embedded', permissions: ['ui.render'] },
    question: { enabled: true, renderMode: 'fixed:card' },
    approval: { enabled: true, renderMode: 'standalone' },
    'status-panel': { enabled: true, renderMode: 'embedded' },
    dialogue: { enabled: true, renderMode: 'embedded' },
    'remote-gateway': {
        enabled: true,
        renderMode: 'headless',
        timeoutMs: 300_000,
        timeoutPolicy: 'fallback-local'
    }
};
export const DEFAULT_SETTINGS_V21 = {
    schemaVersion: 2,
    ui: { profile: 'vertical', theme: 'SakuraPink', scale: 1, fpsCap: 30 },
    modules: DEFAULT_MODULES,
    emotion: { vocab: EMOTION_TAGS, similarityThreshold: 0.6, pairOnly: true },
    channels: {
        qq: { enabled: false, appId: '', credentialRef: 'vault:qq-token' },
        wechat: { enabled: false, mode: 'ilink', credentialRef: 'vault:wx-token' },
        webhook: { enabled: false, url: '', credentialRef: 'vault:wh-secret' }
    },
    vault: {
        backend: 'system-keychain',
        suite: 'CS1',
        pqEnabled: false,
        kdf: { algo: 'argon2id', m: 65_536, t: 3, p: 1 },
        rotationDays: 90,
        decryptWindowDays: 30,
        auditChain: true,
        redactTelemetry: true,
        isolatedProcess: true
    },
    interop: {
        enabled: true,
        probeIntervalMin: 30,
        maxClockDriftMs: 60_000,
        consistencyPolicy: 'warn',
        trustedPeersPath: 'trusted-peers.json',
        lanFallback: false
    },
    memory: {
        syncEnabled: true,
        summaryEveryTurns: 8,
        summaryMaxAgeMin: 30,
        tokenBudget: { persona: 300, facts: 400, summary: 600, recent: 800, event: 300 },
        salienceHalfLifeDays: 14,
        salienceFloor: 0.1,
        tombstoneInsteadOfDelete: true
    }
};
const KNOWN_V2_KEYS = new Set([
    'schemaVersion',
    'nickname',
    'uiMode',
    'renderMode',
    'profile',
    'window',
    'bubble',
    'askHandling',
    'askEveryMinutes',
    'poseEverySeconds',
    'soundLevel',
    'showHud',
    'hudDetail',
    'hudAlpha',
    'theme',
    'modules',
    'defaultEmotion'
]);
function isPermission(value) {
    return ALL_PERMISSIONS.includes(value);
}
/**
 * v1/v2 扁平配置 → v2.1 嵌套配置。
 * 未知字段进 _legacy；card profile 强制 scale=1（文档 13.1）。
 */
export function settingsV2ToV21(legacy) {
    const raw = legacy;
    const extras = {};
    for (const key of Object.keys(raw)) {
        if (!KNOWN_V2_KEYS.has(key))
            extras[key] = raw[key];
    }
    const modules = { ...DEFAULT_MODULES };
    for (const [id, toggle] of Object.entries(legacy.modules)) {
        const permissions = toggle.permissions.filter(isPermission);
        modules[id] = {
            enabled: toggle.enabled,
            renderMode: legacy.renderMode,
            ...(permissions.length === 0 ? {} : { permissions })
        };
    }
    const profile = legacy.profile;
    const migrated = {
        ...DEFAULT_SETTINGS_V21,
        ui: {
            profile,
            theme: legacy.theme.preset,
            scale: profile === 'card' ? 1 : legacy.window.scale,
            fpsCap: 30
        },
        modules
    };
    return Object.keys(extras).length === 0 ? migrated : { ...migrated, _legacy: extras };
}
//# sourceMappingURL=settings.js.map