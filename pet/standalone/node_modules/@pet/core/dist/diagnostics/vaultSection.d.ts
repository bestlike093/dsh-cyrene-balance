import type { Diagnostics, DiagnosticsSection } from './diagnostics.js';
import type { PanelRow } from './diagnosticsPanel.js';
/** 结构化解法：core 不依赖 @pet/vault，只认这四个字段。 */
export type VaultSeverity = 'ok' | 'warn' | 'error';
export interface VaultDiagnosticLike {
    readonly severity: VaultSeverity;
    readonly code: string;
    readonly message: string;
    readonly kind?: string;
    readonly group?: string;
    /**
     * 只表示「用户已确认」，用于抑制重复弹窗。
     * 它不降低 severity，也不改变面板等级 —— S1 已把这条写死。
     */
    readonly acknowledged?: boolean;
    readonly backend?: string;
    /** false 就一定是 error：basic_text / memory 这类后端靠这条暴露。 */
    readonly secure?: boolean;
    readonly permission?: string;
    /** 只在界面展示；复制导出时不读取。 */
    readonly recoveredFrom?: string;
}
export interface VaultDiagnosticsSource {
    diagnose(): Promise<VaultDiagnosticLike>;
}
export declare const VAULT_SECTION = "vault";
export declare const VAULT_SECTION_LABEL = "\u5BC6\u94A5\u4E0E\u51ED\u636E";
export declare function toVaultSection(diagnostic: VaultDiagnosticLike): Omit<DiagnosticsSection, 'name'>;
export declare function toVaultPanelRow(diagnostic: VaultDiagnosticLike): PanelRow;
/**
 * 把 S1 的 diagnose() 接进诊断聚合器。
 * 返回注销函数；重复注册同名数据源会覆盖旧来源。
 */
export declare function registerVaultDiagnostics(diagnostics: Diagnostics, source: VaultDiagnosticsSource): () => void;
