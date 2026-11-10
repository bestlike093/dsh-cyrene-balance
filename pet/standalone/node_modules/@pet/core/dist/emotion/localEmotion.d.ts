/**
 * 本地情绪规则：外呼 LLM 的降级路径。
 *
 * 输入只有原始文本，不依赖任何 LLM 返回结构。规则表可枚举导出，
 * 命中结果带 matchedRule / confidence / producedAt，便于诊断追溯。
 *
 * 情绪只是输入：这里不接触 DialogueQueue，也不产生任何台词。
 */
import type { EmotionTag } from '@pet/shared';
export interface EmotionRule {
    readonly id: string;
    readonly emotion: EmotionTag;
    readonly confidence: number;
    readonly pattern: RegExp;
    readonly description: string;
}
export declare const LOCAL_EMOTION_RULES: readonly EmotionRule[];
export declare const DEFAULT_EMOTION_TTL_MS = 30000;
export declare const DEFAULT_MIN_CONFIDENCE = 0.5;
export type EmotionSource = 'local' | 'llm';
export interface EmotionSnapshot {
    readonly emotion: EmotionTag;
    readonly confidence: number;
    /** 命中的本地规则 id；neutral 为 null。 */
    readonly matchedRule: string | null;
    /** 产生时刻，TTL 从这里起算。 */
    readonly producedAt: number;
    readonly source: EmotionSource;
}
export interface LocalEmotionOptions {
    /** 便于测试注入固定时钟。 */
    readonly now?: () => number;
    readonly minConfidence?: number;
    readonly ttlMs?: number;
    /** 允许替换规则表，主要供测试使用。 */
    readonly rules?: readonly EmotionRule[];
}
/** neutral 是合法结果，置信度为 0，不带规则命中。 */
export declare function neutralEmotion(now: number): EmotionSnapshot;
/** TTL 从 producedAt 起算，不看读取时刻。 */
export declare function isEmotionExpired(snapshot: EmotionSnapshot, now: number, ttlMs?: number): boolean;
/**
 * 纯函数：一段文本跑一遍本地规则。
 *
 * 规则按顺序匹配，第一条命中且置信度达标的胜出；都不达标返回 neutral。
 */
export declare function analyzeLocalEmotion(text: string, options?: LocalEmotionOptions): EmotionSnapshot;
/**
 * 带 TTL 的本地情绪状态。
 *
 * `current()` 过期时直接返回 neutral，绝不回退到上一次的值——
 * 旧值看起来完全合法，诊断上很难发现它已经过期。
 */
export declare class LocalEmotionEngine {
    private readonly now;
    private readonly ttlMs;
    private readonly minConfidence;
    private readonly ruleTable;
    private last;
    constructor(options?: LocalEmotionOptions);
    /** 供诊断面板枚举；matchedRule 一定能在这里找到。 */
    get rules(): readonly EmotionRule[];
    analyze(text: string): EmotionSnapshot;
    current(): EmotionSnapshot;
}
