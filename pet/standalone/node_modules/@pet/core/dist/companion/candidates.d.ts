/**
 * 主动开口的候选。
 *
 * 把「什么时候可以说话」和「说什么」分开：
 * 这里只回答前者——现在有没有值得主动开口的理由，以及优先级。
 * 真正调模型、挑表情、发到哪个通道，仍然由主进程决定。
 *
 * 纯逻辑：时间、状态都从参数进来，不读文件、不碰网络。
 */
import type { DayPlan } from './agenda.js';
export type CandidateKind = 'absence' | 'loop' | 'agenda' | 'thought';
export interface CandidateLoop {
    readonly id: string;
    readonly text: string;
    readonly createdAt: number;
}
/** 念头池里一条还开着的念头；调用方负责只传 open 的。 */
export interface CandidateThought {
    readonly id: string;
    readonly text: string;
    readonly createdAt: number;
    readonly weight?: number;
}
export interface CandidateInput {
    readonly now: number;
    readonly agenda: DayPlan;
    /** 夜间免打扰、专注模式、静音：一律不开口。 */
    readonly quiet?: boolean;
    /** 她正在睡：不开口，也不攒着。 */
    readonly asleep?: boolean;
    /** 累了、困了：不再主动挑日常话题；真有没说完的事，仍可以轻轻问一句。 */
    readonly tired?: boolean;
    /** 冷却截止时间；到点之前不开口。 */
    readonly cooldownUntil?: number;
    /** 今天已经认领过的段 id，避免同一段重复触发。 */
    readonly claimedSegmentIds?: readonly string[];
    /** 放置够久的未完话头；调用方已做过「这轮提过没有」的过滤。 */
    readonly loop?: CandidateLoop | null;
    readonly loopMinAgeMs?: number;
    /** 念头池里还开着的一条；最优先，但仍要过同一套硬闸门。 */
    readonly thought?: CandidateThought | null;
    /** 刚攒下的念头先放一会儿，避免同一拍刚记下就立刻说出来。 */
    readonly thoughtMinAgeMs?: number;
    /** 上次真正互动的时间；null 表示还没聊过，不拿它算「很久没联系」。 */
    readonly lastUserAt?: number | null;
    readonly absenceAfterMs?: number;
    /** 刚进入当前段多久以内才适合开口；太晚就别补一句「你刚起床」。 */
    readonly agendaWindowMs?: number;
}
export interface Candidate {
    readonly kind: CandidateKind;
    readonly priority: number;
    /** 只有 agenda 候选带段 id；认领时用它。 */
    readonly segmentId: string | null;
    /** 只有 thought 候选带念头 id；说出口后标记已用。 */
    readonly thoughtId: string | null;
    /** 给提示词的一句背景，不是台词。 */
    readonly note: string;
    readonly reason: string;
}
export declare const DEFAULT_LOOP_MIN_AGE_MS: number;
export declare const DEFAULT_ABSENCE_AFTER_MS: number;
export declare const DEFAULT_AGENDA_WINDOW_MS: number;
export declare const DEFAULT_THOUGHT_MIN_AGE_MS: number;
/**
 * 此刻所有成立的开口理由，按优先级从高到低。
 *
 * 任何一道闸门没通过都返回空数组：宁可这一拍不说话，也不要事后解释「为什么打扰你」。
 */
export declare function candidatesAt(input: CandidateInput): Candidate[];
/** 只取最高优先级的一条；没有就是这一拍不该主动开口。 */
export declare function pickCandidate(input: CandidateInput): Candidate | null;
