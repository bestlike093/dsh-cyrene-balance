type AnyRecord = Record<string, any>;
export interface DiagnosticsDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    getAppVersion: () => string;
    listIpcChannels: () => readonly string[];
    getRegisteredChannels: () => string[];
    getPendingDecisionIds: () => unknown;
    getSettings: () => AnyRecord;
    getMediaRoot: () => string;
    modelStore: AnyRecord;
    getQq: () => AnyRecord | null;
    getVault: () => AnyRecord | null;
    getLegacyKeyMigrationWarning: () => unknown;
    /** 构建信息来自包内 BUILD-INFO.json；开发态没有这个文件时返回 null。 */
    getBuildInfo?: () => AnyRecord | null;
    /** 内存自检只读快照；未接入时明确返回 null，不伪造读数。 */
    getMemoryGuard?: () => AnyRecord | null;
}
export declare function registerDiagnosticsChannels(deps: DiagnosticsDeps): void;
export {};
