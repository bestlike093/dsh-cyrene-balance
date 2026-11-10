import type { DiagnosticsSnapshot } from './diagnostics.js';
export type PanelLevel = 'ok' | 'warn' | 'error';
export interface PanelRow {
    readonly id: string;
    readonly label: string;
    readonly level: PanelLevel;
    readonly detail: string;
}
export interface DiagnosticsPanel {
    readonly title: string;
    readonly generatedAt: number;
    readonly rows: readonly PanelRow[];
    readonly ok: boolean;
}
/**
 * 把聚合快照整理成可直接渲染的行。
 * 面板只读取快照，不再触发任何探测，避免诊断本身产生副作用。
 */
export declare function buildDiagnosticsPanel(snapshot: DiagnosticsSnapshot, labels?: Record<string, string>): DiagnosticsPanel;
/** 纯文本视图，供 CLI 与日志使用；UI 可以直接消费 rows。 */
export declare function formatDiagnosticsPanel(panel: DiagnosticsPanel): string;
