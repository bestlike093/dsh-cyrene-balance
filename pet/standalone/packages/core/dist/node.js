/**
 * Node-only 入口。
 *
 * 这些模块直接依赖 `node:fs` / `node:path` / `node:zlib`，在渲染进程的
 * `file://` 页面里必然加载失败。只能在主进程或测试环境中导入。
 *
 * 浏览器安全的模块请走 `@pet/core/browser`。
 */
export * from './assets/assetManager.js';
export * from './host/LocalHostAdapter.js';
export * from './media/voice.js';
export * from './media/ttsProvider.js';
