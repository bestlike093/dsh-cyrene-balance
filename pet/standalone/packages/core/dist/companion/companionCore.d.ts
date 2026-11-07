import type { EmotionTag } from '@pet/shared';
import { AssertionStore } from './assertions.js';
import type { MentionReaction, ScoredAssertion } from './assertions.js';
import { AgendaClaims } from './agenda.js';
import type { DayPlan } from './agenda.js';
import type { ScoredEmoji } from './emojiPicker.js';
import { MoodEngine } from './mood.js';
import type { MoodSnapshot } from './mood.js';
import { OpeningLedger } from './openingLedger.js';
import { ReflectionEngine } from './reflection.js';
import type { OpenLoop, Reflection } from './reflection.js';
export interface CompanionOptions {
    readonly now?: () => number;
    readonly mood?: MoodEngine;
    readonly agenda?: DayPlan;
    readonly claims?: AgendaClaims;
    readonly assertions?: AssertionStore;
    readonly reflection?: ReflectionEngine;
    /** 主动开口的机会账本；不传时按默认分寸新建。 */
    readonly openings?: OpeningLedger;
    /** 当前好感度（0-100），用于主动开口的分层节奏；缺省按 50 处理。 */
    readonly favor?: () => number;
    /** 单轮最多给几个表情候选，默认 4；0 表示这一轮不配图。 */
    readonly emojiLimit?: number;
    /** 记住最近用过的几张图，用于去重，默认 12。 */
    readonly recentEmojiLimit?: number;
}
/** 一轮对话里，陪伴层交给提示词与界面的东西。 */
export interface TurnContext {
    readonly mood: MoodSnapshot;
    readonly emotion: EmotionTag;
    /** 可以直接写进提示词的心情描述，不含数值。 */
    readonly moodNote: string;
    /** 今天的节目单。 */
    readonly agenda: DayPlan;
    /** 此刻在做什么、接下来做什么。 */
    readonly agendaNote: string;
    /** 与这句话相关的记忆，已按覆盖档位过滤。 */
    readonly memories: readonly ScoredAssertion[];
    /** 记忆的分组文本；没有可说的内容时为空串。 */
    readonly memoryNote: string;
    /** 表情候选，按分数降序；为空表示这次不发图。 */
    readonly emoji: readonly ScoredEmoji[];
    readonly openLoops: readonly OpenLoop[];
    /** 这一轮刚好触发了反思时才非空。 */
    readonly reflection: Reflection | null;
}
export interface CompanionSnapshot {
    readonly version: 1;
    readonly mood: unknown;
    readonly agenda?: unknown;
    readonly agendaClaims?: unknown;
    readonly assertions: unknown;
    readonly reflection: unknown;
    /** 主动开口账本；旧版本没有这个字段，读回时按空账本处理。 */
    readonly openings?: unknown;
    readonly recentEmoji: readonly string[];
}
export declare class CompanionCore {
    readonly mood: MoodEngine;
    readonly assertions: AssertionStore;
    readonly reflection: ReflectionEngine;
    readonly openings: OpeningLedger;
    private storedAgenda;
    private readonly claimsStore;
    private readonly now;
    private readonly emojiLimit;
    private readonly recentEmojiLimit;
    private recentEmojiIds;
    constructor(options?: CompanionOptions);
    /** 最近用过的表情 id，越靠前越近。 */
    get recentEmoji(): readonly string[];
    /** 今天的节目单；跨天时沿用旧结构。 */
    get agenda(): DayPlan;
    /** 认领记录，主进程决定要不要主动开口时用。 */
    get claims(): AgendaClaims;
    /** 主进程当天生成完节目单后注入；不是今天的单会被挪成今天。 */
    setAgenda(plan: DayPlan): void;
    /** 主动说话用：此刻在做什么、接下来做什么。 */
    agendaNote(): string;
    private ensureToday;
    onUserMessage(text: string): TurnContext;
    onAssistantReply(text: string, emojiId?: string): void;
    /** 用户对某条被提及的记忆作出反应后调用；用于把"提得对不对"学进去。 */
    noteMemoryReaction(assertionId: string, reaction: MentionReaction): void;
    /** 只读快照，给调试面板或日志用。 */
    snapshot(): CompanionSnapshot;
    toJSON(): CompanionSnapshot;
    /** 任意一层数据坏了都只丢那一层，不让整个陪伴状态读不出来。 */
    static fromJSON(raw: unknown, options?: CompanionOptions): CompanionCore;
    private rememberEmoji;
}
