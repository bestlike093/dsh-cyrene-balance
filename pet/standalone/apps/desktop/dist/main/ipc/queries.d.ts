type AnyRecord = Record<string, any>;
export interface QueryChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    getSettings: () => AnyRecord;
    getLastRenderInfo: () => AnyRecord | null;
    modelStore: AnyRecord;
    packStore: AnyRecord;
    /** QQ 偷图待审核队列；只读列表，入库另走写通道。 */
    stickerInbox: AnyRecord;
    /** 表情库：内置素材 + 用户素材包，只读。 */
    stickerLibrary: AnyRecord;
    assetLibrary: AnyRecord;
    systemStats: AnyRecord;
    presenceService: AnyRecord;
    chatService: AnyRecord;
    chatHistoryStore: AnyRecord;
    memoryStore: AnyRecord;
    memoryEnabled: () => boolean;
    collectMemoryAll: () => AnyRecord[];
    requireSecretStore: () => AnyRecord;
    getSecretStore: () => AnyRecord | null;
    getVault: () => AnyRecord | null;
    buildPersonaPrompt: (settings: AnyRecord) => unknown;
    getBackupPrefs: () => Promise<AnyRecord>;
    fs: AnyRecord;
    path: AnyRecord;
    app: AnyRecord;
    userData: string;
    reportsDir: string;
    balanceService: string;
    balanceField: string;
    syncSecretService: string;
    syncSecretField: string;
    defaultSettings: AnyRecord;
    probeTtsEndpoint: (endpoint: string) => Promise<AnyRecord>;
    toTtsEndpoint: (url: unknown) => string;
    isLoopbackEndpoint: (endpoint: string) => boolean;
    /** 可注入时钟，测试用来跨过缓存 TTL，不靠 sleep。 */
    now: () => number;
    log: (...args: any[]) => void;
}
/** 语音状态缓存时长：设置页轮询频率远高于本地探测，10 秒内复用同一个结果。 */
export declare const STATUS_TTL_MS = 10000;
export declare function registerQueryChannels(deps: QueryChannelDeps): void;
export {};
