import type { ModuleHost, ModuleRuntime } from '../modules/moduleHost.js';
import type { DiagnosticsSnapshot } from './diagnostics.js';
import { type DiagnosticsPanelMount } from './panelDom.js';
import { type PanelController } from './panelState.js';
export interface PanelBootOptions {
    /** 宿主容器，必须在 startAll 之前就存在。 */
    readonly container: Element;
    readonly host: ModuleHost;
    /** 渲染进程里通常是一层 IPC 调用。 */
    readonly load: () => Promise<DiagnosticsSnapshot>;
    readonly onRetry?: () => void;
    readonly onCopy?: () => void;
}
export interface PanelBoot {
    readonly mount: DiagnosticsPanelMount;
    readonly controller: PanelController;
    readonly statuses: readonly ModuleRuntime[];
}
/**
 * 诊断面板装配（17.2.18）。
 *
 * 顺序是硬约束：
 * 1. 建容器、挂 pending —— 必须早于 startAll，否则失败模块的占位卡无处可挂；
 * 2. startAll —— 此时 failed 集合与占位集合才可能相等；
 * 3. refresh —— 诊断结果带的是启动完成后的模块状态。
 *
 * 面板本身是最小可渲染单元：不依赖模块、不等待主题注入完成。
 */
export declare function bootDiagnosticsPanel(options: PanelBootOptions): Promise<PanelBoot>;
