/**
 * 需求状态：连接、新鲜、成就、休息四类需求。
 *
 * 数值只改变主动冒泡的频率与语气权重，不进入模型上下文，也不对外发送。
 * 默认关闭；关闭时所有需求恒为 0，调度器不会因为「需求」而打扰用户。
 */
export type NeedKey = 'connection' | 'novelty' | 'achievement' | 'rest';
export declare const NEED_KEYS: readonly NeedKey[];
export declare const NEED_LABELS: Readonly<Record<NeedKey, string>>;
/** 每小时自然回升的速度，0..1/小时。 */
export declare const DEFAULT_NEED_GROWTH: Readonly<Record<NeedKey, number>>;
export interface NeedSnapshot {
    readonly levels: Readonly<Record<NeedKey, number>>;
    readonly dominant: NeedKey;
    readonly updatedAt: number;
}
export interface NeedsOptions {
    readonly now?: () => number;
    readonly enabled?: boolean;
    readonly growthPerHour?: Partial<Record<NeedKey, number>>;
}
export declare class NeedsState {
    private readonly now;
    private readonly growth;
    private enabled;
    private levels;
    private updatedAt;
    constructor(options?: NeedsOptions);
    get isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
    /** 时间流逝：按每小时速度回升，封顶 1。 */
    advance(elapsedMs?: number): void;
    /** 某类需求被满足：数值下降，最低 0。 */
    satisfy(key: NeedKey, amount?: number): void;
    /** 用问卷或偏好初始化，值会被夹到 0..1。 */
    setLevels(partial: Partial<Record<NeedKey, number>>): void;
    snapshot(): NeedSnapshot;
}
