type AnyRecord = Record<string, any>;
/**
 * Live2D 模型库：导入、切换、打开目录。
 *
 * 模型文件不随包分发，全部由使用者自己从作者处下载后导入，放在 userData/models。
 * 渲染侧只拿 pet-media:// 相对地址，拿不到真实路径。
 */
export interface ModelChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    dialog: {
        showOpenDialog: (parent: unknown, options: AnyRecord) => Promise<{
            canceled: boolean;
            filePaths: string[];
        }>;
    };
    getDialogParent: () => unknown;
    modelStore: {
        importFromZip: (source: string) => Promise<AnyRecord>;
        importFromDirectory: (source: string) => Promise<AnyRecord>;
        list: () => Promise<AnyRecord[]>;
        toMediaUrl: (model: AnyRecord) => string;
        ensureRoot: () => Promise<void>;
    };
    mediaRoot: string;
    openPath: (target: string) => Promise<string>;
    getSettings: () => AnyRecord;
    setSettings: (next: AnyRecord) => void;
    settingsPath: string;
    writeJson: (file: string, value: unknown) => Promise<void>;
    broadcastSettings: (next: AnyRecord) => void;
    log: (...args: any[]) => void;
}
export declare function registerModelChannels(deps: ModelChannelDeps): void;
export {};
