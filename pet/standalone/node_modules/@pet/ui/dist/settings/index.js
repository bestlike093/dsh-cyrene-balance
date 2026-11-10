/**
 * 设置界面骨架（S7-c）。
 *
 * 【可供 E2 复用】E2 开工时从这里引，不要另起一套设置界面。
 *
 * 纯数据 + 纯 DOM，不含 Electron / IPC / dsh 调用。
 * 渲染器由宿主决定：Electron 渲染进程、插件 webview 都能消费同一份注册表。
 */
export * from './types.js';
export * from './registry.js';
export * from './render.js';
