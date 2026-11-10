import type { PanelStatus } from './panelState.js';
export interface DiagnosticsPanelMountOptions {
    readonly onRetry?: () => void;
    readonly onCopy?: () => void;
}
export interface DiagnosticsPanelMount {
    /** 容器已脱离文档时为 null：没有可渲染的节点。 */
    readonly element: HTMLElement | null;
    update(status: PanelStatus): void;
    dispose(): void;
}
/**
 * 挂载诊断面板的 DOM 外壳。
 *
 * 宿主负责容器与样式；模块失败不影响这里，因为整块面板不依赖模块 ShadowRoot。
 * 状态更新由 panelState 的 controller 驱动，本函数只负责把状态画出来。
 */
export declare function mountDiagnosticsPanel(container: Element, options?: DiagnosticsPanelMountOptions): DiagnosticsPanelMount;
