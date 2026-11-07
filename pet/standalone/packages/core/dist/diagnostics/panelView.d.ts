import type { DiagnosticsSnapshot } from './diagnostics.js';
export type PanelRowLevel = 'ok' | 'warn' | 'error';
export interface PanelRowView {
    readonly id: string;
    readonly label: string;
    /** 第一级分组，来自 section.data.group。 */
    readonly group: string;
    /** 第二级分类，来自 section.data.kind。 */
    readonly kind: string;
    readonly level: PanelRowLevel;
    readonly detail: string;
    /** 永远非空：数据源没给就按错误码补，码也没登记则给兜底文案。 */
    readonly fixHint: string;
    readonly code?: string;
    /**
     * 只供界面展示，复制导出时不会读取这个字段。
     * 恢复出来的旧密钥路径属于本机证据，不该跟着报告发出去。
     */
    readonly recoveredFrom?: string;
}
export interface PanelGroupView {
    readonly group: string;
    readonly rows: readonly PanelRowView[];
}
export interface PanelViewModel {
    readonly title: string;
    readonly generatedAt: number;
    readonly ok: boolean;
    readonly groups: readonly PanelGroupView[];
}
/**
 * 把快照整理成 group → kind 两级视图。
 *
 * 分组顺序按首次出现；组内按 kind 字典序，保证同一份快照每次渲染位置一致。
 */
export declare function buildPanelView(snapshot: DiagnosticsSnapshot, labels?: Record<string, string>): PanelViewModel;
export declare function panelRows(view: PanelViewModel): readonly PanelRowView[];
