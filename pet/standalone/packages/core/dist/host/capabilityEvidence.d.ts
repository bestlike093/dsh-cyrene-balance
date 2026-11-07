import type { HostCapability } from '@pet/shared';
import type { DegradeMode } from '../modules/hostCapability.js';
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
export declare const SERVICE_API_VERSION = "0.2.1-rc.3";
export declare const SERVICE_API_KEYS: readonly ["agentDefaultModel", "agentLoop", "agentPresets", "agents", "agentTeams", "approval", "attachments", "authorization", "browserUse", "claudeCodeMods", "clientModules", "commands", "compaction", "computerUse", "configEditor", "connection", "cotTranslation", "credentials", "credentialsController", "deepseekAccount", "deepseekLlmApiExtensions", "directoryPicker", "directoryPickerController", "fileReferences", "fileUploads", "fs", "goals", "hmr", "inspector", "jobController", "jobs", "llm", "lsp", "mcpResources", "messageFeedback", "officeToPdf", "otel", "permissionPresets", "planMode", "pluginManager", "pluginMarket", "pluginRegistryProbe", "productAnalytics", "productTelemetry", "profileContext", "ptcRuntime", "remoteAccess", "sandbox", "sandboxPolicy", "schedule", "sessionController", "sessionFeedback", "sessionFileReferences", "sessionPersistence", "sessionProjectionCache", "sessionProjections", "sessionQuery", "sessionReferenceResolver", "sessions", "sessionSkillCatalog", "sessionTelemetry", "sessionTitle", "settings", "settingsController", "shell", "shellEnv", "skills", "speechController", "speechToText", "spillStore", "ssh", "storage", "storageDomain", "subagentModelSelection", "subagents", "subprocess", "systemPrompt", "terminalController", "terminals", "timer", "tokenMeter", "toolResultPruner", "tools", "translator", "typert", "typertGateway", "userQuestions", "web", "webApp", "webhookRuntime", "webServer", "workflowEngine", "workingDirectory", "workspaceChanges", "workspaceController", "workspaceFiles", "workspaceRegistry", "worktrees"];
/**
 * 实据来源。四种必须能区分开：
 * - `api-catalog`：安装包里的 SERVICE_API 有对应 key，可被脚本持续校验；
 * - `runtime`：程序化运行时探测到（本机目前没有这样的路径）；
 * - `observed`：人工实测确认。证据是真的，只是形态不是程序化探测
 *   （托盘图标、右键菜单、退出路径这类只能靠人看的东西）；
 * - `assumed`：没有服务层证据，纯形态推断，从未验证，必须同时给降级模式。
 *
 * ⚠️ 把 `observed` 挤进 `runtime` 会高估证据，挤进 `assumed` 会低估证据。
 */
export type CapabilitySource = 'api-catalog' | 'runtime' | 'observed' | 'assumed';
export interface CapabilityEvidence {
    readonly source: CapabilitySource;
    /** source 为 api-catalog 时，对应的 `ctx.<key>` 服务名。 */
    readonly apiCatalogKey?: (typeof SERVICE_API_KEYS)[number];
    /** source 为 assumed / observed 时必填：缺了它就不许进名单。 */
    readonly degradeMode?: DegradeMode;
    readonly note?: string;
}
export declare const CAPABILITY_EVIDENCE: Readonly<Record<HostCapability, CapabilityEvidence>>;
/**
 * 按实据把 catalog key 换算成能力清单。
 *
 * 只有 `api-catalog` 来源参与换算：`assumed` 项没有可验证的 key，
 * 不能在「读到了 catalog」时被顺手点亮。
 */
export declare function resolveAvailableFromCatalog(keys: readonly string[]): readonly HostCapability[];
