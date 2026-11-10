/**
 * 反思：把「刚聊完的一段时间」压成几句她自己记得住的话。
 *
 * 这里不调模型。首版只做三件确定性的事：
 * 1. 统计这段时间的节奏与情绪走向；
 * 2. 把没说完的话记成 open loop，等下次自然接上；
 * 3. 判断这次值不值得留下一条自省（而不是每轮都写）。
 *
 * 需要更细的语义时由调用方传入 `narrator`，产出的文本仍只当作草稿，
 * 不会绕过断言层直接写进长期记忆。
 */
import type { Turn } from '@pet/shared';
import type { MoodSnapshot } from './mood.js';
export type LoopStatus = 'open' | 'resolved' | 'expired';
export interface OpenLoop {
    readonly id: string;
    readonly text: string;
    readonly createdAt: number;
    readonly status: LoopStatus;
    /** 出现「明天」「周末」这类时间词时记录的粗粒度提示，不当作承诺时间 */
    readonly dueHint?: string;
    /** 按 dueHint 换算出的回访时间；到点之前不去催，免得当晚就问「面试怎么样了」 */
    readonly dueAt?: number;
}
export interface Reflection {
    readonly id: string;
    readonly at: number;
    readonly turnCount: number;
    readonly userTurnCount: number;
    /** 给自我档案用的一句话，不进对话 */
    readonly note: string;
    readonly openLoopIds: readonly string[];
    readonly moodAtStart: MoodSnapshot | null;
}
export interface ReflectionSnapshot {
    readonly version: 1;
    readonly sequence: number;
    readonly lastReflectionAt: number;
    readonly loops: readonly OpenLoop[];
    readonly reflections: readonly Reflection[];
}
export interface ReflectionOptions {
    readonly now?: () => number;
    /** 多少轮触发一次；默认 12 */
    readonly everyTurns?: number;
    /** 距上次反思的最短间隔；默认 20 分钟 */
    readonly minIntervalMs?: number;
    readonly narrator?: (turns: readonly Turn[], stats: ReflectionStats) => string;
}
export interface ReflectionStats {
    readonly turnCount: number;
    readonly userTurnCount: number;
    readonly assistantTurnCount: number;
    readonly averageUserLength: number;
    readonly openLoops: number;
}
/**
 * 「明天」「周末」这类说法换算成适合回访的时间点。
 *
 * 不是精确日程，只求别在当天就问「面试怎么样了」：
 * 长时说法落到第二天或那一天上午，短时说法至少等两小时。
 */
export declare function loopDueAt(hint: string | undefined, createdAt: number): number | undefined;
export declare class ReflectionEngine {
    private readonly buffer;
    private readonly loopItems;
    private sequence;
    private lastReflectionAt;
    private readonly now;
    private readonly everyTurns;
    private readonly minInterval;
    private readonly narrator?;
    private readonly reflections;
    constructor(options?: ReflectionOptions);
    observe(turn: Turn): void;
    private pickLoopToClose;
    loops(status?: LoopStatus): readonly OpenLoop[];
    resolveLoop(id: string): boolean;
    /** 超过 7 天还没接上的话头自动过期，免得下次突然提起一件旧事。 */
    expireLoops(now?: number, ttlMs?: number): number;
    shouldReflect(now?: number): boolean;
    /**
     * 生成一次反思。
     *
     * 没有 narrator 时用模板句子：读起来像日记，不像日志。
     * 无论哪条路径，`note` 都只进自我档案，不会出现在聊天里。
     */
    reflect(mood?: MoodSnapshot, now?: number): Reflection | null;
    history(): readonly Reflection[];
    toJSON(): ReflectionSnapshot;
    /** 缓冲区（尚未成形的对话片段）不落盘，重启后从下一句重新开始积累。 */
    static fromJSON(raw: unknown, options?: ReflectionOptions): ReflectionEngine;
    private statsOf;
    private templateNote;
}
