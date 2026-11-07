/**
 * 表情表达实验：把情绪映射到表情标签，并记录命中计数。
 *
 * 三组对照：
 * - off：不启用，始终用默认表情；
 * - experiment：按当前情绪切换表情；
 * - control：保持默认表情，只记录反事实的「本会切到哪个」。
 *
 * 计数只留在内存里供复盘，不落盘、不出网。这里不产生任何台词。
 */
import type { EmotionTag } from '@pet/shared';
export type ExpressionGroup = 'off' | 'experiment' | 'control';
export interface ExpressionOptions {
    readonly group?: ExpressionGroup;
    /** 默认表情，neutral 时也用它。 */
    readonly defaultEmotion?: EmotionTag;
    readonly now?: () => number;
}
export interface ExpressionDecision {
    readonly group: ExpressionGroup;
    /** 输入的情绪。 */
    readonly emotion: EmotionTag;
    /** 最终要显示的表情。 */
    readonly tag: EmotionTag;
    /** 与默认表情不同时为 true。 */
    readonly changed: boolean;
    readonly at: number;
}
export interface ExpressionStats {
    readonly total: number;
    readonly changed: number;
    readonly byTag: Readonly<Record<string, number>>;
}
export declare class ExpressionExperiment {
    private readonly now;
    private readonly defaultEmotion;
    private group;
    private total;
    private changed;
    private readonly byTag;
    constructor(options?: ExpressionOptions);
    get currentGroup(): ExpressionGroup;
    setGroup(group: ExpressionGroup): void;
    decide(emotion: EmotionTag): ExpressionDecision;
    stats(): ExpressionStats;
    resetStats(): void;
}
