/**
 * 三维心情底色（valence / arousal / tension）。
 *
 * 和 `emotion/localEmotion.ts` 的分工：
 * - 那边是「这句话让她的表情瞬间变一下」，TTL 30 秒，逐句判定；
 * - 这里是「这一阵她心里是什么天气」，按小时回归，跨会话保留。
 *
 * 心情只作为输入送进提示词和表情选择，不直接生成台词。
 * 任何时刻都不允许把数值写进给用户看的话里——喜欢的是感觉，不是读数。
 */
import type { EmotionTag } from '@pet/shared';
export interface MoodState {
    /** 愉快度：-1 很低落，0 平静，1 很开心 */
    readonly valence: number;
    /** 唤醒度：0 困倦，1 亢奋 */
    readonly arousal: number;
    /** 张力：0 松弛，1 紧绷（焦虑、在意、被打扰） */
    readonly tension: number;
}
export interface MoodSnapshot extends MoodState {
    /** 最后一次更新的时间戳，回归从这里起算 */
    readonly updatedAt: number;
}
export type MoodEventKind = 'praised' | 'cared' | 'apologized' | 'conflict' | 'ignored' | 'greeted' | 'user_tired' | 'user_happy' | 'playful' | 'late_night';
interface MoodEffect {
    readonly valence: number;
    readonly arousal: number;
    readonly tension: number;
}
/** 单次事件在强度 1.0 时的位移。实际位移按 intensity 线性缩放。 */
export declare const MOOD_EFFECTS: Readonly<Record<MoodEventKind, MoodEffect>>;
/** 基线：略微偏正、偏安静。她要有一个自己的常态，而不是每次从零开始。 */
export declare const MOOD_BASELINE: MoodState;
export declare const DEFAULT_MOOD_HALF_LIFE_MS: number;
/**
 * 把一段文本里的情绪信号折算成心情事件。
 * 只做正向识别，识别不到就返回空数组——宁可没反应，也不要猜错。
 */
export interface MoodSignal {
    readonly kind: MoodEventKind;
    readonly intensity: number;
}
export declare function detectMoodSignals(text: string): readonly MoodSignal[];
export interface MoodEngineOptions {
    readonly now?: () => number;
    readonly baseline?: MoodState;
    readonly halfLifeMs?: number;
    readonly initial?: MoodState;
}
/**
 * 心情状态机。
 *
 * 三条硬约束：
 * 1. 回归永远朝基线走，不会因为长时间没说话就飘到极端；
 * 2. 单次事件位移有上限，避免一句话把底色掀翻；
 * 3. `updatedAt` 一定前进，重复 tick 不会重复衰减。
 */
export declare class MoodEngine {
    private readonly now;
    private readonly baseline;
    private readonly halfLife;
    private state;
    private updatedAt;
    constructor(options?: MoodEngineOptions);
    /** 先把这段时间的回归结算掉，再返回快照。读取本身也算一次前进。 */
    snapshot(): MoodSnapshot;
    get current(): MoodState;
    private settle;
    apply(kind: MoodEventKind, intensity?: number): MoodSnapshot;
    applySignals(signals: readonly MoodSignal[]): MoodSnapshot;
    applyText(text: string): MoodSnapshot;
    /**
     * 映射到现有词表。
     *
     * 顺序有意义：张力高优先于一切，其次看唤醒度和愉快度的组合。
     * 边界值取「更保守的那一侧」，避免平静被读成兴奋。
     */
    toEmotionTag(state?: MoodState): EmotionTag;
    /** 供提示词使用的一句话描述；不含任何数值。 */
    describe(state?: MoodState): string;
    toJSON(): MoodSnapshot & {
        readonly version: 1;
    };
    /** 反序列化时任何字段不合法都退回基线，并保留 updatedAt 以便继续回归。 */
    static fromJSON(raw: unknown, options?: Omit<MoodEngineOptions, 'initial'>): MoodEngine;
}
export {};
