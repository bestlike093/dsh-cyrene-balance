type AnyRecord = Record<string, any>;
/**
 * 备份通道：目录枚举与自动备份开关。
 *
 * 备份配置的读写仍留在装配层：它是 main 里多处共用的缓存（自动备份定时器也读），
 * 这里只接收读写函数，不复制一份状态，避免两个缓存互相覆盖。
 */
export interface BackupChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    getBackupPrefs: () => Promise<AnyRecord>;
    getDocumentsPath: () => string;
    pathJoin: (...parts: string[]) => string;
    pathBasename: (file: string) => string;
    /** 自动备份口令的读写都由装配层持有系统密钥；这里只决定先后顺序。 */
    saveBackupPrefs: (next: AnyRecord) => Promise<void>;
    readAutoPassword: () => Promise<string>;
    writeAutoPassword: (password: string) => Promise<boolean>;
    removeAutoSecret: () => Promise<void>;
    fs: {
        readdir: (dir: string, options: {
            withFileTypes: true;
        }) => Promise<Array<{
            isFile: () => boolean;
            name: string;
        }>>;
        stat: (file: string) => Promise<{
            mtimeMs: number;
        }>;
    };
}
export declare function registerBackupChannels(deps: BackupChannelDeps): void;
export {};
