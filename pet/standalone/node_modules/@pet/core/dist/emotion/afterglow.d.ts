/**
 * 情绪余波：让情绪在事件结束后缓慢回落，而不是瞬间归零。
 *
 * 这是表现层的近似，不声称她真的有情绪。数值只影响下一次表情与台词的
 * 选择权重，不进入模型上下文，也不上传。
 *
 * 衰减用半衰期：经过一个 halfLifeMs，绝对值减半。读取时惰性结算，
 * 所以没有定时器也能正确衰减。
 */
export interface AfterglowSnapshot {
    /** 愉悦度，-1..1。 */
    readonly valence: number;
    /** 唤醒度，0..1。 */
    readonly arousal: number;
    readonly updatedAt: number;
}
export interface AfterglowImpulse {
    readonly valence: number;
    readonly arousal: number;
}
export interface AfterglowOptions {
    readonly now?: () => number;
    /** 关闭时 impulse 不生效，snapshot 永远是零值。 */
    readonly enabled?: boolean;
    /** 半衰期，默认 30 分钟。 */
    readonly halfLifeMs?: number;
    /** 一次刺激把当前值拉向目标的比例，0..1，默认 0.35。 */
    readonly weight?: number;
    /** 低于这个绝对值就归零，避免无限趋近。 */
    readonly epsilon?: number;
}
export declare const DEFAULT_AFTERGLOW_HALF_LIFE_MS: number;
export declare const DEFAULT_AFTERGLOW_WEIGHT = 0.35;
/** 半衰期衰减：elapsed <= 0 时原样返回。 */
export declare function decayByHalfLife(value: number, elapsedMs: number, halfLifeMs: number): number;
export declare class EmotionAfterglow {
    private readonly now;
    private readonly halfLifeMs;
    private readonly weight;
    private readonly epsilon;
    private enabled;
    private valence;
    private arousal;
    private updatedAt;
    constructor(options?: AfterglowOptions);
    get isEnabled(): boolean;
    /** 开关只影响后续行为；关闭时立刻清零，不保留残余。 */
    setEnabled(enabled: boolean): void;
    /** 先结算到当前时刻，再按权重靠近目标值。 */
    impulse(input: AfterglowImpulse, weight?: number): AfterglowSnapshot;
    /** 读取时惰性衰减；关闭时按零值返回。 */
    snapshot(): AfterglowSnapshot;
    reset(): void;
    private settle;
}
