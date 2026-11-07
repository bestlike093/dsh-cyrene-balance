import { HOST_CAPABILITIES } from '@pet/shared';
/**
 * 本机 dsh 0.2.1-rc.3 安装包内 `api-catalog.js` 的 `SERVICE_API` 快照。
 *
 * 来源：`resources/app.asar` →
 * `dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js`
 * 这是构建期由 AST 生成的机器可读清单，`cordis_inspect` 也用它，
 * 比任何手写声明文件更接近「宿主真实具备什么」。
 *
 * `scripts/check-api-catalog.mjs` 会在每次 verify 时重新读取本机安装包比对；
 * key 消失即 FAIL，不在本机时 SKIP。
 */
export const SERVICE_API_VERSION = '0.2.1-rc.3';
export const SERVICE_API_KEYS = [
    'agentDefaultModel',
    'agentLoop',
    'agentPresets',
    'agents',
    'agentTeams',
    'approval',
    'attachments',
    'authorization',
    'browserUse',
    'claudeCodeMods',
    'clientModules',
    'commands',
    'compaction',
    'computerUse',
    'configEditor',
    'connection',
    'cotTranslation',
    'credentials',
    'credentialsController',
    'deepseekAccount',
    'deepseekLlmApiExtensions',
    'directoryPicker',
    'directoryPickerController',
    'fileReferences',
    'fileUploads',
    'fs',
    'goals',
    'hmr',
    'inspector',
    'jobController',
    'jobs',
    'llm',
    'lsp',
    'mcpResources',
    'messageFeedback',
    'officeToPdf',
    'otel',
    'permissionPresets',
    'planMode',
    'pluginManager',
    'pluginMarket',
    'pluginRegistryProbe',
    'productAnalytics',
    'productTelemetry',
    'profileContext',
    'ptcRuntime',
    'remoteAccess',
    'sandbox',
    'sandboxPolicy',
    'schedule',
    'sessionController',
    'sessionFeedback',
    'sessionFileReferences',
    'sessionPersistence',
    'sessionProjectionCache',
    'sessionProjections',
    'sessionQuery',
    'sessionReferenceResolver',
    'sessions',
    'sessionSkillCatalog',
    'sessionTelemetry',
    'sessionTitle',
    'settings',
    'settingsController',
    'shell',
    'shellEnv',
    'skills',
    'speechController',
    'speechToText',
    'spillStore',
    'ssh',
    'storage',
    'storageDomain',
    'subagentModelSelection',
    'subagents',
    'subprocess',
    'systemPrompt',
    'terminalController',
    'terminals',
    'timer',
    'tokenMeter',
    'toolResultPruner',
    'tools',
    'translator',
    'typert',
    'typertGateway',
    'userQuestions',
    'web',
    'webApp',
    'webhookRuntime',
    'webServer',
    'workflowEngine',
    'workingDirectory',
    'workspaceChanges',
    'workspaceController',
    'workspaceFiles',
    'workspaceRegistry',
    'worktrees'
];
export const CAPABILITY_EVIDENCE = {
    ask: { source: 'api-catalog', apiCatalogKey: 'userQuestions' },
    approval: { source: 'api-catalog', apiCatalogKey: 'approval' },
    taskProgress: { source: 'api-catalog', apiCatalogKey: 'jobs' },
    settings: { source: 'api-catalog', apiCatalogKey: 'settings' },
    tray: {
        source: 'observed',
        degradeMode: 'silent',
        note: '人工实测（HEAD 42b6b36）：托盘图标、右键菜单（显示窗口/退出）、退出后 exitCode=0 均验证过；托盘相关改动后需重验'
    },
    window: {
        source: 'assumed',
        degradeMode: 'fixed',
        note: '窗口属于 Electron 主进程，不是 ctx 服务，SERVICE_API 里没有对应 key'
    },
    llmCall: { source: 'api-catalog', apiCatalogKey: 'llm' },
    sessionRead: { source: 'api-catalog', apiCatalogKey: 'sessions' },
    storage: { source: 'api-catalog', apiCatalogKey: 'storage' },
    fileAccess: { source: 'api-catalog', apiCatalogKey: 'fs' },
    voiceInput: { source: 'api-catalog', apiCatalogKey: 'speechToText' },
    skillCatalog: { source: 'api-catalog', apiCatalogKey: 'skills' }
};
/**
 * 按实据把 catalog key 换算成能力清单。
 *
 * 只有 `api-catalog` 来源参与换算：`assumed` 项没有可验证的 key，
 * 不能在「读到了 catalog」时被顺手点亮。
 */
export function resolveAvailableFromCatalog(keys) {
    const present = new Set(keys);
    return HOST_CAPABILITIES.filter((capability) => {
        const evidence = CAPABILITY_EVIDENCE[capability];
        if (evidence.source !== 'api-catalog' || evidence.apiCatalogKey === undefined)
            return false;
        return present.has(evidence.apiCatalogKey);
    });
}
