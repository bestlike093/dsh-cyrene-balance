type AnyRecord = Record<string, any>;
/** 资产与备份域：写操作从这里注册，单例与副作用回调全部由装配层注入。 */
export interface MutationChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    dialog: {
        showOpenDialog: (parent: unknown, options: AnyRecord) => Promise<{
            canceled: boolean;
            filePaths: string[];
        }>;
    };
    getDialogParent: () => unknown;
    packStore: {
        importFromZip: (file: string) => Promise<AnyRecord>;
        list: () => Promise<AnyRecord[]>;
        setEnabled: (id: string, enabled: boolean) => Promise<AnyRecord>;
        remove: (id: string) => Promise<unknown>;
    };
    /** 待审核表情：入库 / 丢弃都必须由用户显式点一次。 */
    stickerInbox: {
        list: () => Promise<AnyRecord[]>;
        approve: (id: string, options: AnyRecord) => Promise<AnyRecord>;
        reject: (id: string) => Promise<AnyRecord>;
    };
    /** 打开独立表情包预览页；窗口生命周期由装配层管。 */
    openStickerWindow: () => void;
    /** 把素材包里的表情发到最近一次 QQ 会话；失败回 ok:false。 */
    sendQqSticker: (file: string) => Promise<AnyRecord>;
    getSettings: () => AnyRecord;
    setSettings: (next: AnyRecord) => void;
    settingsPath: string;
    sanitizeSettingsPatch: (raw: AnyRecord) => AnyRecord;
    mergeLayer: (base: AnyRecord, patch: AnyRecord) => AnyRecord;
    settingsTopKeys: Set<string>;
    writeJson: (file: string, value: unknown) => Promise<void>;
    applyIconSettings: (force?: boolean) => void;
    broadcastSettings: (next: AnyRecord) => void;
    getBackupPrefs: () => Promise<{
        dir: string;
        keep: number;
        lastRunAt: string | null;
    }>;
    saveBackupPrefs: (patch: AnyRecord) => Promise<void>;
    getAppPath: (name: string) => string;
    getVault: () => AnyRecord | null;
    createVaultBackup: (options: AnyRecord) => Promise<{
        files: unknown[];
    }>;
    readBackupFiles: () => Promise<unknown>;
    restrictPermissions: (file: string) => Promise<void>;
    fs: {
        access: (file: string) => Promise<unknown>;
        stat: (file: string) => Promise<{
            isDirectory: () => boolean;
            mtimeMs: number;
        }>;
        readdir: (dir: string, options?: AnyRecord) => Promise<any[]>;
        rm: (file: string, options?: AnyRecord) => Promise<void>;
        writeFile: (file: string, data: string, encoding: string) => Promise<void>;
    };
    path: {
        join: (...parts: string[]) => string;
        basename: (value: string) => string;
    };
    log: (...args: any[]) => void;
}
export declare function registerMutationChannels(deps: MutationChannelDeps): void;
/** 手动与自动备份共用同一套落盘、限权与轮换逻辑。 */
export declare function runBackup(deps: MutationChannelDeps, payload: AnyRecord): Promise<{
    ok: boolean;
    reason: string;
    message: string;
    fileName?: undefined;
    dirName?: undefined;
    fileCount?: undefined;
    removed?: undefined;
} | {
    ok: boolean;
    fileName: string;
    dirName: string;
    fileCount: number;
    removed: number;
    reason?: undefined;
    message?: undefined;
}>;
export {};
