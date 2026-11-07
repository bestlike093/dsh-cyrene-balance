/**
 * 功能动机调度：把主动动作当候选，按需求、时段与冷却打分。
 *
 * 只做排序与挑选，不自己执行动作，也不自己开定时器。
 * 默认关闭；关闭时 pick 永远返回 null，调用方应保持静默。
 */
import type { NeedKey, NeedSnapshot } from '../emotion/needs.js';
export type MotivationAction = 'bubble' | 'dailyReview' | 'gameInvite' | 'greeting';
export interface MotivationCandidate {
    readonly action: MotivationAction;
    /** 这个动作主要回应哪类需求。 */
    readonly need: NeedKey;
    readonly baseScore: number;
    /** 同一动作两次触发之间的最短间隔。 */
    readonly cooldownMs: number;
    /** 允许的小时（本地时区 0..23）；不填表示全天可触发。 */
    readonly hours?: readonly number[];
}
export declare const DEFAULT_MOTIVATION_CANDIDATES: readonly MotivationCandidate[];
export interface MotivationContext {
    readonly now: number;
    readonly needs: NeedSnapshot;
    readonly lastFiredAt?: Partial<Record<MotivationAction, number>>;
    readonly enabled: boolean;
}
export type MotivationBlock = 'disabled' | 'cooldown' | 'hour';
export interface ScoredCandidate {
    readonly action: MotivationAction;
    readonly score: number;
    readonly blocked: MotivationBlock | null;
}
export interface MotivationDecision {
    readonly action: MotivationAction | null;
    readonly score: number;
    /** 给诊断看的原因，不展示给用户。 */
    readonly reason: string;
}
export declare function scoreCandidates(candidates: readonly MotivationCandidate[], context: MotivationContext): ScoredCandidate[];
/** 稳定排序：分数高的在前，同分保持候选顺序。 */
export declare function pickMotivation(candidates: readonly MotivationCandidate[], context: MotivationContext): MotivationDecision;
