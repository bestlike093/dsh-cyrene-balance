/**
 * 角色节目单：她一天在做什么。
 *
 * 和 `game/dailySchedule.ts` 无关——那边是用户的游戏排班，这里是角色自己的生活。
 *
 * 三条底线：
 * 1. 一天必须被完整覆盖，任何时刻都能回答「她现在在做什么」；
 * 2. 模型生成的内容先过校验，重叠、越界、空标题都会被剔掉；
 * 3. 到点不等于执行：先认领，再允许产生主动行为，防止重复触发。
 *
 * 纯逻辑：时间从参数传入，不读文件、不碰网络，可从 `@pet/core/browser` 导出。
 */
export type SegmentKind = 'sleep' | 'meal' | 'work' | 'study' | 'chore' | 'leisure' | 'rest' | 'commute' | 'other';
export declare const SEGMENT_KINDS: readonly SegmentKind[];
export interface AgendaSegment {
    readonly id: string;
    /** 一天里的第几分钟，0..1439 */
    readonly startMinute: number;
    /** 结束分钟，必须大于 startMinute，最大 1440 */
    readonly endMinute: number;
    readonly title: string;
    readonly kind: SegmentKind;
    /** 可选的一句备注，用来给台词提供细节。 */
    readonly memo?: string;
}
export interface DayPlan {
    /** 本地日期 `YYYY-MM-DD`。 */
    readonly date: string;
    readonly generatedAt: number;
    /** model=当天生成；carryover=沿用上一份的结构；default=内置兜底 */
    readonly source: 'model' | 'carryover' | 'default';
    readonly segments: readonly AgendaSegment[];
}
export interface PlanIssue {
    readonly field: string;
    readonly message: string;
}
export declare const MINUTES_PER_DAY: number;
export declare const MAX_SEGMENTS = 24;
export declare const MIN_SEGMENT_MINUTES = 10;
/** 内置的一天。模型不可用时也不会出现「空白的一天」。 */
export declare const DEFAULT_SEGMENTS: readonly AgendaSegment[];
/** 本地日期键。用本地时间，因为节目单跟着人的生活节奏走。 */
export declare function dateKey(now: number): string;
/** 当前时刻是一天里的第几分钟。 */
export declare function minuteOfDay(now: number): number;
export declare function formatMinute(minute: number): string;
/** 一次返回全部问题，方便调用方决定是整份丢弃还是逐条修。 */
export declare function validateSegments(segments: readonly AgendaSegment[]): readonly PlanIssue[];
/**
 * 清洗模型输出。
 *
 * - 丢掉结构不合法的段；
 * - 按开始时间排序；
 * - 重叠时保留先出现的那一段（模型通常把重要的写在前面）；
 * - 默认把缝隙补成「留白」，保证任何时刻都有答案。
 */
export declare function normalizeSegments(raw: readonly unknown[], options?: {
    fillGaps?: boolean;
}): readonly AgendaSegment[];
/** 把没被覆盖的时间补成「留白」，保证时间线连续。 */
export declare function fillGaps(segments: readonly AgendaSegment[]): readonly AgendaSegment[];
export interface BuildPlanOptions {
    readonly now: number;
    readonly source?: DayPlan['source'];
    readonly fillGaps?: boolean;
}
/** 从模型输出建一份可用的节目单；清洗后仍然为空就退回内置。 */
export declare function buildPlan(raw: readonly unknown[], options: BuildPlanOptions): DayPlan;
/**
 * 沿用上一份节目的结构，只把日期换掉。
 *
 * 生成失败时用它，宁可沿用昨天的节奏，也不要给她一个空白的一天。
 */
export declare function carryOver(previous: DayPlan, now: number): DayPlan;
export declare function defaultPlan(now: number): DayPlan;
/**
 * 从存盘数据恢复。
 *
 * 结构坏了就退回内置一天；日期不是今天时沿用旧结构，避免每次重启都回到默认作息。
 */
export declare function planFromJSON(raw: unknown, now: number): DayPlan;
/** 这一份是不是今天（或指定日期）的。 */
export declare function isPlanFor(plan: DayPlan, now: number): boolean;
/** 此刻所在的段。节目单覆盖完整一天，所以正常情况下不会返回 null。 */
export declare function segmentAt(plan: DayPlan, now: number): AgendaSegment | null;
/** 接下来的一段；当天已到末尾时返回 null。 */
export declare function nextSegment(plan: DayPlan, now: number): AgendaSegment | null;
/**
 * 给提示词用的一小段话。
 *
 * 只写「现在」和「接下来」，不铺整张表——铺开会让每句话都变成日程播报。
 */
export declare function planNote(plan: DayPlan, now: number): string;
/** 被打断后重排：从「现在」往后重新铺一条连续的时间线。 */
export interface RescheduleOptions {
    readonly now: number;
    /** 接下来还要被占用的分钟数，比如继续陪聊的时长。 */
    readonly delayMinutes: number;
    /** 每段允许压缩到的最短时长，默认 MIN_SEGMENT_MINUTES。 */
    readonly minSegmentMinutes?: number;
}
export interface RescheduleResult {
    readonly changed: boolean;
    readonly plan: DayPlan;
    readonly reason: 'ok' | 'no-delay' | 'no-current' | 'sleeping' | 'no-room';
    /** 被顺延的分钟数。 */
    readonly shiftedMinutes: number;
    /** 从后面各段里压出来的分钟数。 */
    readonly trimmedMinutes: number;
}
/**
 * 一次被打断之后，把今天剩下的时间重新排一遍。
 *
 * 被打断的这段时间不会凭空消失：先记成一段「和你说说话」，
 * 她手头没做完的事从这段之后接着做，后面所有安排整体顺延。
 * 顺延出来的差额从后面各段里按「越不重要越先让」的顺序压缩，
 * 睡觉和吃饭排在最后，不会因为多聊了一会儿就没了晚饭。
 *
 * 不动的情况：没有被打断、正在睡觉（半夜聊几句不该把整夜切碎）、
 * 或者后面根本压不出这么多时间——这时宁可保持原样。
 */
export declare function rescheduleAfter(plan: DayPlan, options: RescheduleOptions): RescheduleResult;
/**
 * 认领记录。
 *
 * 「到点」和「执行」分开：同一段一天只能被认领一次，进程重启后也能接上。
 * 认领后才发现不该打扰，可以 `release` 退回；这比「先执行再补记」安全。
 */
export declare class AgendaClaims {
    private readonly claimed;
    private static key;
    isClaimed(date: string, segmentId: string): boolean;
    /** 认领当前段。已经认领过返回 null，调用方据此跳过。 */
    claim(plan: DayPlan, now: number): AgendaSegment | null;
    /** 主动放弃认领，下一轮可以重新尝试。 */
    release(date: string, segmentId: string): void;
    /** 只保留今天的记录，避免跨天累积。 */
    prune(now: number): void;
    get size(): number;
    toJSON(): {
        version: 1;
        claims: Readonly<Record<string, number>>;
    };
    static fromJSON(raw: unknown): AgendaClaims;
}
