import type { DshBridge } from '../host/dshBridge.js';
export interface DiagnosticsSection {
    readonly name: string;
    readonly ok: boolean;
    /** 细分级；缺省时由 ok 推导（true=ok / false=error）。 */
    readonly level?: 'ok' | 'warn' | 'error';
    readonly data?: unknown;
    readonly code?: string;
    readonly message?: string;
}
export interface DiagnosticsSnapshot {
    readonly version: string;
    readonly generatedAt: number;
    readonly ok: boolean;
    readonly sections: readonly DiagnosticsSection[];
    readonly bridge: string;
}
export type DiagnosticsProvider = () => unknown | Promise<unknown>;
/** 已完整的 section 结果；用于需要保留 severity（level）的数据源。 */
export type DiagnosticsSectionResult = Omit<DiagnosticsSection, 'name'>;
export type DiagnosticsSectionProvider = () => DiagnosticsSectionResult | Promise<DiagnosticsSectionResult>;
export interface DiagnosticsOptions {
    readonly version: string;
    readonly bridge?: DshBridge;
    readonly now?: () => number;
}
/**
 * 诊断数据源聚合器。
 * 每个 provider 独立执行：单个抛错只污染自己那一节，剩余诊断照常输出。
 */
export declare class Diagnostics {
    private readonly providers;
    private readonly sectionProviders;
    private readonly options;
    constructor(options: DiagnosticsOptions);
    /** 注册数据源，返回注销函数。同名重复注册会覆盖旧 provider。 */
    register(name: string, provider: DiagnosticsProvider): () => void;
    unregister(name: string): void;
    /**
     * 注册「返回完整 section」的数据源。
     * 与 register 的区别：保留 level（severity），不做 ok → level 的推导。
     */
    registerSection(name: string, provider: DiagnosticsSectionProvider): () => void;
    /** 当前注册的数据源名字，便于测试与面板排序。 */
    names(): readonly string[];
    section(name: string, provider: DiagnosticsProvider): Promise<DiagnosticsSection>;
    collect(): Promise<DiagnosticsSnapshot>;
}
