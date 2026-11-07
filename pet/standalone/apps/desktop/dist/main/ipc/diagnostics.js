/**
 * 诊断快照可能被用户复制出去求助，绝对路径里的用户名不该跟着走。
 * 这里只处理字符串，保留目录结构，方便判断问题发生在哪一层。
 */
const USER_PATH_RULES = [
    [/\b([A-Za-z]:[\\/]Users[\\/])[^\\/\s]+/gi, '$1***'],
    [/(\/(?:home|Users)\/)[^/\s]+/g, '$1***']
];
function sanitizeText(value) {
    return USER_PATH_RULES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
function sanitizeDiagnostics(value, depth = 0) {
    if (depth > 8)
        return value;
    if (typeof value === 'string')
        return sanitizeText(value);
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeDiagnostics(item, depth + 1));
    }
    if (typeof value === 'object' && value !== null) {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            output[key] = sanitizeDiagnostics(item, depth + 1);
        }
        return output;
    }
    return value;
}
/**
 * 构建信息只取约定字段，避免 BUILD-INFO.json 里多写的路径或环境信息被复制出去。
 */
function pickBuildInfo(value) {
    if (value === null)
        return {};
    const picked = {};
    if (typeof value.sha === 'string')
        picked.sha = value.sha;
    if (typeof value.builtAt === 'string')
        picked.builtAt = value.builtAt;
    if (typeof value.dirty === 'boolean')
        picked.dirty = value.dirty;
    return picked;
}
/**
 * 通道健康只取约定的四个字段。
 * 通道实现以后多带一个 token、webhook 地址或群号时，也不会跟着诊断被复制出去。
 */
function pickChannelHealth(value) {
    const picked = {};
    for (const key of ['ok', 'code', 'message', 'state']) {
        if (value[key] !== undefined)
            picked[key] = value[key];
    }
    return picked;
}
export function registerDiagnosticsChannels(deps) {
    const register = deps.registerChannel;
    register('pet:diagnostics:collect', async () => {
        const qq = deps.getQq();
        const qqHealth = qq === null
            ? { ok: false, code: 'CHANNEL_NOT_CONFIGURED', message: 'QQ 凭据未配置' }
            : pickChannelHealth(await qq.health());
        const vault = deps.getVault();
        const snapshot = {
            app: {
                version: deps.getAppVersion(),
                electron: process.versions.electron,
                node: process.versions.node,
                ...pickBuildInfo(deps.getBuildInfo?.() ?? null)
            },
            platform: process.platform,
            // 白名单与真实注册面分开报：只报一份时，漏登记根本看不出来。
            ipcChannels: {
                listed: deps.listIpcChannels(),
                registered: deps.getRegisteredChannels()
            },
            pendingDecisions: deps.getPendingDecisionIds(),
            channels: {
                local: { ok: true },
                qq: qqHealth
            },
            // 新增的用户可见项都要能在诊断里看到，否则「看不见模型」时无从判断。
            media: {
                root: deps.getMediaRoot(),
                activeId: deps.getSettings().live2dModelId,
                models: await deps.modelStore.list().catch(() => [])
            },
            // 内存读数只有主进程知道；渲染侧只用来显示，不据此做释放决定。
            memory: deps.getMemoryGuard?.() ?? null,
            vault: vault === null
                ? {
                    ok: false,
                    code: 'VAULT_UNAVAILABLE',
                    legacyKeyMigration: deps.getLegacyKeyMigrationWarning()
                }
                : await vault.diagnose().then((diagnostic) => ({
                    ok: true,
                    ...diagnostic,
                    legacyKeyMigration: deps.getLegacyKeyMigrationWarning()
                }))
        };
        return sanitizeDiagnostics(snapshot);
    });
}
