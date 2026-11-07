/**
 * 浏览器安全入口。
 *
 * 只导出可在 `file://` + CSP 下加载的模块；任何 `node:*` 依赖都会让整张模块图
 * 在渲染进程里失败（2026-10-27 S2 真机事故：页面静止但无报错）。
 *
 * 渲染侧一律从这里导入。需要文件系统 / 压缩包 / 流式摘要时，走 `@pet/core/node`，
 * 且只能在主进程侧使用。
 *
 * 新增导出前先确认：该模块的依赖树里没有 `node:*`，也没有 Node-only 的第三方包。
 * `scripts/check-browser-entry.mjs` 会递归检查，命中即失败。
 */
export * from './host/dshBridge.js';
export * from './modules/permissionBroker.js';
export * from './modules/petalRegistry.js';
export * from './modules/petalManifest.js';
export * from './modules/moduleSandbox.js';
export * from './modules/moduleHost.js';
export * from './modules/moduleLoader.js';
export * from './modules/workerProtocol.js';
export * from './modules/workerSandbox.js';
export * from './modules/workerRuntime.js';
export * from './modules/placeholderCard.js';
export * from './modules/hostCapability.js';
export * from './modules/builtin/bubble.js';
export * from './modules/builtin/balance.js';
export * from './modules/builtin/reminder.js';
export * from './diagnostics/diagnostics.js';
export * from './diagnostics/diagnosticsPanel.js';
export * from './diagnostics/panelState.js';
export * from './diagnostics/panelView.js';
export * from './diagnostics/panelDom.js';
export * from './diagnostics/panelBoot.js';
export * from './diagnostics/modulesSection.js';
export * from './diagnostics/copyReport.js';
export * from './diagnostics/vaultSection.js';
export * from './diagnostics/hostSection.js';
export * from './state/stateMachine.js';
export * from './state/sleepGate.js';
export * from './memory/archive.js';
export * from './schedule/scheduler.js';
export * from './settings/settingsStore.js';
export * from './render/rendererHost.js';
export * from './render/resourceLedger.js';
export * from './render/scaler.js';
export * from './render/adapterRegistry.js';
export * from './render/imageAdapter.js';
export * from './render/gifAdapter.js';
export * from './render/videoAdapter.js';
export * from './render/live2dAdapter.js';
export * from './render/texture.js';
export * from './render/spriteSheetLoader.js';
export * from './render/spriteModel.js';
export * from './render/spriteAdapter.js';
export * from './render/hitTest.js';
export * from './render/renderNotice.js';
export * from './remote/index.js';
export * from './game/rps.js';
export * from './game/dailySchedule.js';
export * from './game/dailyState.js';
export * from './game/taskRegistration.js';
export * from './game/dailyReport.js';
export * from './game/dependencyCheck.js';
export * from './game/installPaths.js';
export * from './game/launchPlan.js';
export * from './game/gameAssistant.js';
export * from './host/types.js';
export * from './browse/bilibili.js';
export * from './dialogue/dialogueQueue.js';
export * from './companion/index.js';
export * from './emotion/localEmotion.js';
export * from './emotion/afterglow.js';
export * from './emotion/expression.js';
export * from './emotion/needs.js';
export * from './emotion/motivation.js';
export * from './llm/tokenBucket.js';
export * from './llm/dailyBudget.js';
export * from './llm/fallbackChain.js';
export * from './llm/provider.js';
export * from './presentation/index.js';
