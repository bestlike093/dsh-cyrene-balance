/**
 * 表情包选择。
 *
 * 规则优先于随机：同一个情绪下，她应该挑「这张最像此刻」，而不是每次抽签。
 * 四路打分加权，再加一条重复惩罚：
 *
 *   0.55 × 情绪匹配
 *   0.20 × 语域（此刻合不合适）
 *   0.15 × 新鲜度（多久没用了）
 *   0.10 × 场景
 *   − 重复惩罚
 *
 * 素材只按文件名索引，不读文件内容；真正的像素由宿主侧 `readAsset` 负责。
 */
import type { EmotionTag } from '@pet/shared';
import type { MoodState } from './mood.js';
export type EmojiScene = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'greeting' | 'farewell' | 'comfort' | 'praise' | 'tease' | 'apology' | 'meal' | 'work' | 'lazy';
export interface EmojiEntry {
    readonly id: string;
    readonly file: string;
    readonly emotions: readonly EmotionTag[];
    readonly scenes: readonly EmojiScene[];
    /** 人工偏好权重，0.5 表示中性；用于压住某些容易用滥的图 */
    readonly weight?: number;
}
/** 与 `assets/cyrene/emoji` 下的文件名一一对应。新增素材时只需在这里加一行。 */
export declare const DEFAULT_EMOJI_CATALOG: readonly EmojiEntry[];
export interface PickContext {
    readonly emotion: EmotionTag;
    readonly mood?: MoodState;
    readonly scene?: EmojiScene;
    /** 最近用过的 id，越靠前越近；用于新鲜度与重复惩罚 */
    readonly recentIds?: readonly string[];
    readonly now?: number;
}
export interface ScoredEmoji {
    readonly entry: EmojiEntry;
    readonly score: number;
    readonly breakdown: {
        readonly emotion: number;
        readonly register: number;
        readonly freshness: number;
        readonly scene: number;
        readonly penalty: number;
    };
}
export interface PickOptions {
    readonly catalog?: readonly EmojiEntry[];
    readonly limit?: number;
    /** 低于此分数不返回；用来表达「这次不发图」 */
    readonly floor?: number;
}
export declare function pickEmoji(context: PickContext, options?: PickOptions): readonly ScoredEmoji[];
/**
 * 从情绪标签反推「现在大概是什么场景」。
 *
 * 只在调用方没给场景时用，属于兜底推断；推不出来就返回 undefined，
 * 让场景分退化成中性 0.5，而不是硬编一个假的。
 */
export declare function inferScene(emotion: EmotionTag, hour: number, options?: {
    readonly weekend?: boolean;
}): EmojiScene | undefined;
