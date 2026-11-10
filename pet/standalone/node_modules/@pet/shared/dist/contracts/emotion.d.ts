/**
 * v2.1 情绪与台词契约（文档第 4 章）。
 * 核心约束：台词与表情必须成对；解析失败要能说明降级到了哪一级。
 */
import type { EmotionTag } from '../types/model.js';
export type EmotionResolutionSource = 'structured' | 'exact' | 'alias' | 'nearest' | 'fallback' | 'default';
export declare const EMOTION_RESOLUTION_SOURCES: readonly EmotionResolutionSource[];
export interface EmotionDirective {
    readonly emotion: EmotionTag;
    readonly line?: string;
    /** 0~1；source 为 fallback/default 时应为 0 */
    readonly confidence: number;
    readonly source: EmotionResolutionSource;
}
export interface EmotionParseOptions {
    readonly threshold?: number;
    readonly pairOnly?: boolean;
    readonly fallback?: EmotionTag;
}
export interface IEmotionMatcher {
    resolve(raw: unknown, options?: EmotionParseOptions): EmotionDirective;
}
export interface DialoguePair {
    readonly emotion: EmotionTag;
    readonly line: string;
}
/** 只接受「一个表情 + 一句台词」，防止模型一次吐多对造成重复渲染。 */
export declare function isDialoguePair(value: unknown): value is DialoguePair;
/** 结构化输出的外层形状；解析器先认这个，失败再走文本降级。 */
export interface StructuredDialoguePayload {
    readonly emotion?: unknown;
    readonly line?: unknown;
    readonly pairs?: unknown;
}
