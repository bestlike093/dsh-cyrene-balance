type AnyRecord = Record<string, any>;
/**
 * 设置同步：导出快照 / 应用对端变更 / 目录与口令。
 *
 * 只在本机同步目录里搬运，不连远端。口令明文只在这里出现一次，
 * 随后进加密仓库；状态接口只回「是否已配置」和掩码。
 */
export interface SyncChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    dialog: {
        showOpenDialog: (options: AnyRecord) => Promise<{
            canceled: boolean;
            filePaths: string[];
        }>;
    };
    getSettingsSync: () => {
        publish: () => Promise<AnyRecord>;
        pull: () => Promise<AnyRecord>;
        readonly dir?: string;
        readonly node?: string;
    } | null;
    initSettingsSync: () => Promise<void>;
    getSyncPrefs: () => Promise<{
        lastExportAt: string | null;
        lastPullAt: string | null;
    }>;
    saveSyncPrefs: (patch: AnyRecord) => Promise<void>;
    requireSecretStore: () => {
        set: (service: string, value: string, field: string) => Promise<void>;
        clear: (service: string, field: string) => Promise<void>;
    };
    syncSecretService: string;
    syncSecretField: string;
    /** 与渲染侧 backup-policy.js 的 PASSPHRASE_MIN_LENGTH 保持一致。 */
    minPassphraseLength: number;
    log: (...args: any[]) => void;
}
export declare function registerSyncChannels(deps: SyncChannelDeps): void;
export {};
