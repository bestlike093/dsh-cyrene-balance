/**
 * 全量入口，供主进程与测试使用。
 *
 * 内部由两个运行时入口组合而成：
 * - `@pet/core/browser` —— 可在渲染进程加载
 * - `@pet/core/node`    —— 仅 Node / 主进程
 *
 * 渲染侧不要从这里导入，否则会把 Node-only 模块拉进依赖树。
 */
export * from './browser.js';
export * from './node.js';
