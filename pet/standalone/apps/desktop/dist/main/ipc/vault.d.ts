type AnyRecord = Record<string, any>;
/**
 * 加密仓库写通道：密钥轮换、备份导出与导入。
 *
 * 这里只做编排，真正的原子性与校验在 packages/vault：
 * - rotate 由 keyring 落盘，旧密钥保留在 ring 里供旧数据读取；
 * - export 只负责取口令、选路径、序列化与限权，备份格式由 createVaultBackup 决定；
 * - import 先用口令解包并校验，再留回滚快照，最后覆盖文件并自动重启。
 */
export interface VaultChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    getVault: () => AnyRecord | null;
    getVaultClient: () => {
        rotate: () => Promise<{
            from: number;
            to: number;
        }>;
    } | null;
    /** 导入时写回密钥环所需的 suite 与 backend。 */
    getVaultBackend: () => unknown;
    /** 旧密钥迁移告警：诊断要把它和 vault 自检结果一起回给设置页。 */
    getLegacyKeyMigrationWarning: () => unknown;
    cryptoSuite: string;
    showOpenDialog: (options: AnyRecord) => Promise<{
        canceled: boolean;
        filePaths: string[];
    }>;
    showSaveDialog: (options: AnyRecord) => Promise<{
        canceled: boolean;
        filePath?: string;
    }>;
    getDocumentsPath: () => string;
    pathBasename: (file: string) => string;
    createVaultBackup: (options: AnyRecord) => Promise<AnyRecord>;
    readBackupFiles: () => Promise<Array<{
        name: string;
        data: Uint8Array;
    }>>;
    fs: {
        readFile: (file: string, encoding: string) => Promise<string>;
        writeFile: (file: string, data: string) => Promise<void>;
        mkdir: (dir: string, options: {
            recursive: boolean;
        }) => Promise<unknown>;
        copyFile: (from: string, to: string) => Promise<void>;
    };
    pathJoin: (...parts: string[]) => string;
    userData: string;
    vaultKeysPath: string;
    backupFiles: readonly string[];
    writeRestoredKeyRing: (options: AnyRecord) => Promise<void>;
    openVaultBackup: (raw: unknown, password: string) => Promise<AnyRecord>;
    restrictPermissions: (file: string) => Promise<void>;
    /** 导入成功后，内存里的旧密钥已和新文件错位：先停写再重启。 */
    disableMemory: () => void;
    disableChatHistory: () => void;
    markMemoryFlushed: () => void;
    scheduleRestart: () => void;
    describeError: (error: unknown) => string;
    log: (...args: any[]) => void;
}
export declare function registerVaultChannels(deps: VaultChannelDeps): void;
export {};
