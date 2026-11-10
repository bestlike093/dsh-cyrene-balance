/**
 * @pet/ui —— 设置界面骨架。
 *
 * 【可供 E2 复用】E2 开工时从这里引，不要另起一套设置界面。
 *
 * 本包只导出数据契约、注册表与渲染器，不含任何 Electron / IPC 调用。
 * example 单独作为入口，避免示例字段被主入口一并带进产物。
 */
export * from './settings/index.js';
export { createRegistry } from './settings/example.js';
