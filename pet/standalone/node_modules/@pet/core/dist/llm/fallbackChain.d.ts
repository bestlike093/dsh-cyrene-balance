/**
 * 降级链：LLM → 本地规则 → 预置池。
 *
 * source 一律取自实际走过的路径，不读配置：配了 key 但请求失败，
 * 标记的仍是真正产出这条台词的那一级。
 *
 * 本地两级降级都是同步计算，catch 之后不再嵌 await。
 */
import type { EmotionTag } from '@pet/shared';
import type { DialogueQueue } from '../dialogue/dialogueQueue.js';
import type { LocalEmotionEngine } from '../emotion/localEmotion.js';
import type { TokenBucket } from './tokenBucket.js';
export type GenerationSource = 'llm' | 'local-rule' | 'preset-pool';
export interface GenerationInput {
    readonly text: string;
    readonly emotion?: EmotionTag;
}
export interface LlmRawResult {
    readonly text: string;
    readonly model: string;
    readonly promptVersion: string;
    /**
     * 事后结算用。拿不到用量时必须写 'unknown'：
     * 用 0 或直接省略字段，等于把「未知」伪装成「已知」，配额会被静默绕过。
     */
    readonly totalTokens: number | 'unknown';
}
export interface LlmAdapter {
    generate(input: GenerationInput): Promise<LlmRawResult>;
}
export interface PresetPick {
    readonly text: string;
    readonly poolId: string;
    readonly index: number;
}
export interface PresetPoolLike {
    pick(emotion: EmotionTag): PresetPick | undefined;
}
/** 三级来源各自的溯源信息，source 与 kind 必须一致。 */
export type Provenance = {
    readonly kind: 'llm';
    readonly model: string;
    readonly promptVersion: string;
}
/** matchedRule 为 null：规则命中但台词表没有对应条目，产出的是通用回落句。 */
 | {
    readonly kind: 'local-rule';
    readonly matchedRule: string | null;
} | {
    readonly kind: 'preset-pool';
    readonly poolId: string;
    readonly pickedIndex: number;
};
export interface GenerationOutput {
    readonly text: string;
    readonly source: GenerationSource;
    readonly provenance: Provenance;
}
export type DiagnosticLevel = 'info' | 'warn' | 'error';
export interface FallbackDiagnostic {
    readonly level: DiagnosticLevel;
    readonly source: GenerationSource | null;
    readonly message: string;
}
export interface GenerationReport {
    readonly output: GenerationOutput;
    readonly diagnostics: readonly FallbackDiagnostic[];
}
export interface FallbackChainOptions {
    readonly llm?: LlmAdapter;
    readonly localRules?: LocalEmotionEngine;
    readonly presetPool?: PresetPoolLike;
    readonly bucket?: TokenBucket;
    readonly queue?: DialogueQueue;
    /** 调用前预扣多少 token，默认 1。 */
    readonly estimateTokens?: (input: GenerationInput) => number;
}
/** 最小预置池：按轮转取，便于测试复现。 */
export declare class PresetPool implements PresetPoolLike {
    private readonly lines;
    readonly poolId: string;
    private cursor;
    constructor(lines: readonly string[], poolId?: string);
    pick(_emotion: EmotionTag): PresetPick | undefined;
}
export declare class FallbackChain {
    private readonly llm;
    private readonly localRules;
    private readonly presetPool;
    private readonly bucket;
    private readonly queue;
    private readonly estimateTokens;
    constructor(options?: FallbackChainOptions);
    /**
     * 生成一条台词。LLM 成功才标 llm；桶空或请求失败都走同步降级。
     */
    generate(input: GenerationInput): Promise<GenerationReport>;
    /** 降级产出与普通台词走同一条入队路径，一律 normal。 */
    enqueue(output: GenerationOutput): void;
    generateAndEnqueue(input: GenerationInput): Promise<GenerationReport>;
    /** 同步完成，不引入新的 await 点。 */
    private fallback;
}
