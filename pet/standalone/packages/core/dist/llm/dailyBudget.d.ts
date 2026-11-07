/**
 * DailyBudgetGate：按本地自然日累计的消费额度。
 *
 * 与 TokenBucket 分工不同：
 * - TokenBucket 管「短时间内的速率」，防止瞬时把 provider 打爆；
 * - 这里管「一天总共能花多少」，防止长时间缓慢烧穿余额。
 *
 * 跨日按本地日期键滚动，而不是固定 24 小时：用户理解的「今天」是日历上的今天，
 * 不是「距离上次重置满 24 小时」。
 *
 * 额度单位由调用方决定（token 或折算后的计价点数），本类只做累加与判定。
 */
export type BudgetLevel = 'ok' | 'warn' | 'exhausted';
export interface DailyBudgetOptions {
    /** 每日上限，0 表示不限制。 */
    readonly dailyLimit: number;
    /** 预警占比，默认 0.8；超出范围会被夹到 (0, 1]。 */
    readonly warnRatio?: number;
    /** 恢复持久化状态时的初始已用额度。 */
    readonly initialUsed?: number;
    /** 恢复持久化状态时的日期键；缺省取当前本地日期。 */
    readonly initialDayKey?: string;
    /** 墙上时钟，测试可注入。 */
    readonly now?: () => number;
}
export type BudgetVerdict = {
    readonly allowed: true;
    readonly remaining: number;
} | {
    readonly allowed: false;
    readonly reason: 'limit-reached';
    readonly used: number;
    readonly limit: number;
};
export interface BudgetStatus {
    readonly dayKey: string;
    readonly used: number;
    readonly limit: number;
    /** 不限额时为 Infinity，调用方用 Number.isFinite 判断是否展示。 */
    readonly remaining: number;
    /** used / limit，保留三位小数；不限额时为 0。 */
    readonly ratio: number;
    readonly level: BudgetLevel;
}
export interface PersistedBudgetState {
    readonly dayKey: string;
    readonly used: number;
}
/** 本地日期键 YYYY-MM-DD。用本地时区，跨日点与用户直觉一致。 */
export declare function localDayKey(at: number): string;
/**
 * 每日额度闸门。
 *
 * 典型用法：
 * ```ts
 * if (!gate.canSpend(estimate).allowed) return // 先拦住，不发起请求
 * const result = await callModel()
 * gate.record(result.usage.totalTokens)       // 事后按真实用量结算
 * ```
 *
 * `canSpend` 不扣减，允许同一轮里多次预检；真正的扣减只发生在 `record`。
 */
export declare class DailyBudgetGate {
    private readonly dailyLimit;
    private readonly warnRatio;
    private readonly now;
    private usedValue;
    private dayKeyValue;
    constructor(options: DailyBudgetOptions);
    get limit(): number;
    get used(): number;
    get dayKey(): string;
    /** 预检：估计要花 estimated 时还能不能继续。不扣减。 */
    canSpend(estimated?: number): BudgetVerdict;
    /**
     * 事后结算实际用量。
     *
     * 超额也照实记账，不夹到上限：看板需要知道「超了多少」，
     * 夹断会让真实消费在账面上凭空消失。
     */
    record(amount: number): BudgetStatus;
    status(): BudgetStatus;
    serialize(): PersistedBudgetState;
    /** 恢复：跨了日就在构造时清空，没跨日就接着累计。 */
    static restore(options: DailyBudgetOptions, state: PersistedBudgetState): DailyBudgetGate;
    /** 只有日期键变化才清零；同一天内多次调用无副作用。 */
    private rollIfNeeded;
}
