type AnyRecord = Record<string, any>;
/**
 * 观察台通道：一次拿整份只读快照，另给三个手动动作（好感、解锁、删记忆）。
 *
 * 快照由 electron/insight.mjs 聚合；这里只做参数收口与结果整形，
 * 不改任何业务状态。所有写动作都只落在用户明确点过的那一个会话上。
 */
export interface InsightDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    /** 打开单例观察台窗口；重复调用只聚焦已有窗口，并切到请求的分区。 */
    openWindow: (tab?: string) => void;
    insight: {
        snapshot: (options?: {
            force?: boolean;
        }) => Promise<AnyRecord>;
        invalidate?: () => void;
    };
    affinity: {
        snapshot: (scope?: string) => AnyRecord;
        setFavor: (value: number, options?: {
            scope?: string;
            note?: string;
        }) => AnyRecord;
        adjustFavor: (delta: number, options?: {
            scope?: string;
            note?: string;
        }) => AnyRecord;
        setLocked: (locked: boolean, options?: {
            scope?: string;
        }) => AnyRecord;
    };
    memory: {
        remove: (id: string) => AnyRecord;
    };
    log?: (...args: any[]) => void;
}
export declare function registerInsightChannels(deps: InsightDeps): void;
export {};
