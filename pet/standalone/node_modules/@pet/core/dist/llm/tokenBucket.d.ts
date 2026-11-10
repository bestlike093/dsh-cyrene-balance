/**
 * TokenBucket：按 provider 一个桶。
 *
 * 运行期补桶用单调时钟（performance.now），避免 NTP 校正、改系统时间、
 * 休眠唤醒把桶瞬间充满或让 tokens 倒退。
 *
 * 持久化用墙上时钟记录 lastRefillWallMs：跨进程只有墙上时间可比，
 * 恢复时按经过时长折算补桶，不重置为满桶。
 */
export type ConsumeFailReason = 'insufficient' | 'exceeds-capacity';
export type ConsumeResult = {
    readonly ok: true;
    readonly tokens: number;
} | {
    readonly ok: false;
    readonly reason: ConsumeFailReason;
    readonly tokens: number;
};
export interface TokenBucketOptions {
    readonly capacity: number;
    /** 每毫秒补充的 token 数；0 表示不自动补。 */
    readonly refillPerMs: number;
    readonly initialTokens?: number;
    /** 单调时钟，运行期补桶用；测试可注入。 */
    readonly now?: () => number;
    /** 墙上时钟，只用于持久化折算。 */
    readonly wallNow?: () => number;
}
export interface BucketSnapshot {
    readonly providerId: string;
    readonly capacity: number;
    readonly tokens: number;
    /** 单调时钟下的上次补桶时刻。 */
    readonly lastRefillMs: number;
    /** 墙上时钟下的上次补桶时刻。 */
    readonly lastRefillWallMs: number;
}
export interface PersistedBucketState {
    readonly providerId: string;
    readonly tokens: number;
    readonly lastRefillWallMs: number;
}
export declare class TokenBucket {
    readonly providerId: string;
    readonly capacity: number;
    readonly refillPerMs: number;
    private readonly now;
    private readonly wallNow;
    private tokensValue;
    private lastRefillMsValue;
    private lastRefillWallMsValue;
    constructor(providerId: string, options: TokenBucketOptions);
    get tokens(): number;
    /**
     * 单次原子扣减：补桶、判定、扣减在同一个同步调用里完成。
     *
     * 返回 false 时不抛异常；`reason` 区分「暂时不够」与「这个请求永远不可能满足」，
     * 后者调用方不应重试。
     */
    tryConsume(amount?: number, now?: number): ConsumeResult;
    /**
     * 事后结算：正数把预扣多出来的部分还回桶里，
     * 负数用于补扣实际用量超过预扣的差额，下限仍然是 0。
     */
    refund(amount: number): number;
    snapshot(): BucketSnapshot;
    serialize(): PersistedBucketState;
    /** 按墙上时钟的经过时长折算补桶，而不是重置为满桶。 */
    static restore(providerId: string, options: TokenBucketOptions, state: PersistedBucketState): TokenBucket;
    /**
     * 时钟倒退时直接跳过本次补桶：tokens 不减、不抛错。
     * 顺时针向前才按差值补，且不超过容量。
     */
    private refill;
}
/**
 * 按 provider 身份持桶：切换 provider 不会重置原桶。
 * 所有能让桶变满的操作都是可绕过点，这里只复用，不重建。
 */
export declare class TokenBucketRegistry {
    private readonly buckets;
    private readonly defaultOptions;
    constructor(defaultOptions: TokenBucketOptions);
    get(providerId: string, options?: Partial<TokenBucketOptions>): TokenBucket;
    restore(providerId: string, state: PersistedBucketState, options?: Partial<TokenBucketOptions>): TokenBucket;
    snapshotAll(): readonly BucketSnapshot[];
}
