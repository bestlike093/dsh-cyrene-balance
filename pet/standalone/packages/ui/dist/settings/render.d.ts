/**
 * 设置界面渲染（纯 DOM，零依赖）
 *
 * 硬约束：
 * - ⛔ 禁止 innerHTML 拼接 —— 所有文本走 textContent（注入面，见 10.1b/d）
 * - ⛔ 不引用任何宿主 API（无 Electron / IPC / dsh）
 * - ✅ 返回 dispose()，必须清理全部监听器（否则模块卸载时泄漏）
 * - ✅ 只读态「可见」—— 不只禁用，还要显示原因（降级状态可见）
 * - ✅ 凭据「从不持有」—— sensitive 字段的输入直接交给上层，不写进 values。
 *      零窗口，比「提交后清除」强一个量级：后者存在从输入到清除的泄漏期。
 */
import type { SettingsRegistryV1 } from './registry.js';
import type { SensitiveFieldStatusV1, SettingsFieldV1, SettingsValuesV1 } from './types.js';
export interface RenderHandleV1 {
    /** 清理全部监听器与 DOM 引用 */
    dispose(): void;
    /**
     * 非敏感字段的值。
     * 敏感字段从不写入 values，所以这里天然不含它们，无需「提交后移除」这个动作。
     */
    read(): SettingsValuesV1;
}
export interface RenderOptionsV1 {
    /** 非敏感字段的初始值。敏感字段的初始值不接受 —— 没有从存储读回 UI 的路径。 */
    readonly initial?: SettingsValuesV1;
    /**
     * 敏感字段的输入只经这里交给上层，不写进内部 values。
     * 回调里拿到的是那一刻的输入值，渲染层不留副本。
     */
    readonly onSensitiveInput?: (fieldId: string, raw: string) => void;
    /**
     * 敏感字段的状态，只用于 placeholder 与状态行。
     * 只含「有没有存过」「什么时候存的」，不含 key 片段。
     */
    readonly sensitiveStatus?: Readonly<Record<string, SensitiveFieldStatusV1>>;
}
/**
 * 敏感字段：凭据类。值不得进入 values，也不得回填到 DOM。
 * 单独导出，便于测试直接断言这条判定，不必起 DOM。
 */
export declare function isSensitiveField(f: SettingsFieldV1): boolean;
export declare function renderSettings(root: HTMLElement, registry: SettingsRegistryV1, options?: RenderOptionsV1): RenderHandleV1;
