type AnyRecord = Record<string, any>;
/**
 * 记忆域写通道：导出、删除单条、清空。
 *
 * 导出筛选与 ipc/queries.ts 的列表筛选保持同一口径；纯日期按本地时区
 * 补齐当天起止，避免时区换算把边界条目切掉。
 */
export interface MemoryChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    memoryStore: {
        stats: () => {
            available: boolean;
            count: number;
        };
        remove: (id: string) => unknown;
        /** 钉住 / 取消钉住一条记忆。钉住的条目不降温、不自动归档。 */
        setPinned?: (id: string, pinned: boolean) => unknown;
        /** 清空记录；返回 Promise，调用方可 await 落盘完成。 */
        clear: () => unknown;
        flush: () => Promise<void>;
    };
    collectMemoryAll: () => AnyRecord[];
    /** 结构化事实：偏好 / 人物 / 项目 / 约定。可读可改可删。 */
    factStore?: {
        load: () => Promise<unknown>;
        snapshot: (scope?: string) => {
            total: number;
            active: number;
            archived: number;
            byScope?: Record<string, number>;
            facts: AnyRecord[];
        };
        remove?: (id: string) => {
            ok: boolean;
            reason?: string;
        };
        update?: (id: string, text: string) => {
            ok: boolean;
            reason?: string;
        };
        /** 备份用：JSONL 一行一条，能完整还原 scope / 强度 / 时间戳。 */
        exportJsonl?: (options?: AnyRecord) => string;
        importJsonl?: (text: string, options?: AnyRecord) => {
            ok: boolean;
            reason?: string;
            added: number;
            merged: number;
            skipped: number;
            invalid: number;
        };
        flush?: () => Promise<void>;
    };
    sanitizeReflectionText: (text: string) => string;
    dialog: {
        showSaveDialog: (options: AnyRecord) => Promise<{
            canceled: boolean;
            filePath?: string;
        }>;
        showOpenDialog?: (options: AnyRecord) => Promise<{
            canceled: boolean;
            filePaths?: string[];
        }>;
    };
    documentsDir: string;
    pathJoin: (...parts: string[]) => string;
    writeFile: (file: string, data: string, encoding: string) => Promise<void>;
    readFile?: (file: string, encoding: string) => Promise<string>;
    log: (...args: any[]) => void;
}
export declare function registerMemoryChannels(deps: MemoryChannelDeps): void;
export {};
