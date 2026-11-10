/**
 * 游戏助手的纯规则层。
 *
 * 三件事：
 * 1. 任务目录：每个游戏有哪些日常、周常、工具任务，谁负责执行。
 * 2. 周常积分账本：周期积分有上限，货币战争与差分宇宙共享同一份奖励。
 * 3. 风险门：功能默认关闭，必须连续两次独立确认才能打开。
 *
 * 这一层不碰文件、不碰进程、不联网，方便单测，也方便宿主替换存储。
 */
export type AssistantGameId = 'starrail' | 'genshin' | 'zzz' | 'hi3';
export declare const ASSISTANT_GAME_IDS: readonly AssistantGameId[];
export type TaskKind = 'daily' | 'weekly' | 'tool';
export type TaskExecutor = 'march7th' | 'bettergi' | 'manual';
export interface GameTask {
    readonly id: string;
    readonly game: AssistantGameId;
    readonly kind: TaskKind;
    readonly label: string;
    /** 周常积分；只有共享积分的玩法才填。 */
    readonly points?: number;
    /** true 表示和周常积分共享上限，不能重复刷满。 */
    readonly sharesWeeklyCap?: boolean;
    readonly executor: TaskExecutor;
    readonly note: string;
}
/**
 * 任务目录。
 *
 * 星铁部分参考三月七小助手的日常/周常划分；积分规则按「货币战争与差分宇宙
 * 共享每周积分」建模，所以两项都标 sharesWeeklyCap。
 */
export declare const GAME_ASSISTANT_TASKS: readonly GameTask[];
export declare function findTask(taskId: string): GameTask | null;
export declare function tasksForGame(game: AssistantGameId): readonly GameTask[];
/** 每周积分上限。货币战争与差分宇宙共享这一份。 */
export declare const WEEKLY_POINT_CAP = 18000;
/** 周常刷新：周一 04:00（与游戏内周一刷新对齐）。 */
export declare const WEEKLY_RESET_WEEKDAY = 1;
export declare const WEEKLY_RESET_HOUR = 4;
export type WeeklySource = 'currency-war' | 'divergent-universe' | 'other';
export type WeeklyDifficulty = 'standard' | 'overclock' | 'unknown';
export interface WeeklyEntry {
    readonly id: string;
    readonly weekKey: string;
    readonly source: WeeklySource;
    readonly difficulty: WeeklyDifficulty;
    /** 是否完整通关。false 时 points 是部分积分。 */
    readonly completed: boolean;
    readonly points: number;
    readonly claimed: boolean;
    readonly recordedAt: number;
}
export interface WeeklySummary {
    readonly weekKey: string;
    readonly earned: number;
    readonly cap: number;
    readonly remaining: number;
    readonly full: boolean;
    readonly claimedPoints: number;
    readonly unclaimedPoints: number;
    readonly entries: readonly WeeklyEntry[];
}
/**
 * 这一周属于哪个 weekKey。
 *
 * 以周一 04:00 为界：周一 03:59 仍算上一周，04:00 之后算新的一周。
 * 返回值是这一周周一的日期（YYYY-MM-DD），方便直接展示与比较。
 */
export declare function weeklyKeyOf(now: number): string;
/** 本周期还剩多少毫秒，给「距离刷新」用。 */
export declare function nextWeeklyResetAt(now: number): number;
export interface NormalizedEntry {
    readonly ok: boolean;
    readonly entry?: WeeklyEntry;
    readonly error?: string;
}
/** 校验并补全一条记录；不合法时给出能直接展示的原因。 */
export declare function normalizeWeeklyEntry(input: unknown, now: number): NormalizedEntry;
/**
 * 汇总某一周。
 *
 * 同一周内只累加当前 weekKey 的记录；旧周记录不参与本期上限，
 * 避免用户翻旧账时看到「本周已满」的错觉。
 */
export declare function summarizeWeek(entries: readonly WeeklyEntry[], now: number): WeeklySummary;
/** 给气泡/汇报用的一句话。 */
export declare function describeWeek(summary: WeeklySummary): string;
/** 两次确认都必须原样输入的短语。 */
export declare const RISK_CONFIRM_PHRASE = "\u6211\u5DF2\u77E5\u6653\u98CE\u9669";
/** 首次打开时展示的三条风险。 */
export declare const RISK_DISCLOSURES: readonly string[];
export type RiskStage = 'closed' | 'first' | 'enabled' | 'rejected';
export interface RiskGateState {
    readonly enabled: boolean;
    /** 已经完成的确认次数，0—2。 */
    readonly confirmations: number;
    readonly firstConfirmedAt: number | null;
    readonly enabledAt: number | null;
}
export declare function emptyRiskGate(): RiskGateState;
export interface RiskConfirmInput {
    /** 用户是否勾选了「我已阅读以上风险」。 */
    readonly acknowledged: boolean;
    /** 用户输入的确认短语。 */
    readonly phrase: string;
    /** 第二次确认时，是否明确知道「现在会打开真实执行」。 */
    readonly understandsRealRun?: boolean;
}
export interface RiskConfirmResult {
    readonly ok: boolean;
    readonly state: RiskGateState;
    readonly stage: RiskStage;
    readonly message: string;
}
/**
 * 连续两次确认。
 *
 * 第一次只记下「读过了」，不打开；第二次才真正打开。
 * 两次都要求勾选 + 原样输入短语，任何一次不合格都保持原状态。
 * 第二次还要求 understandsRealRun，避免用户以为只是再看一遍说明。
 */
export declare function confirmRisk(state: RiskGateState, input: RiskConfirmInput, now: number): RiskConfirmResult;
/** 关闭后重新计数；下次打开必须重新走两次确认。 */
export declare function disableRisk(state: RiskGateState, now: number): RiskGateState;
/** 从磁盘读回时做一次形状修复，避免旧文件或手改文件把门打开。 */
export declare function readRiskGate(value: unknown): RiskGateState;
export interface TaskPlanStep {
    readonly label: string;
    readonly detail: string;
}
export interface TaskPlan {
    readonly taskId: string;
    readonly label: string;
    readonly executor: TaskExecutor;
    readonly mode: 'dry';
    readonly steps: readonly TaskPlanStep[];
    readonly warnings: readonly string[];
}
export declare function planTask(taskId: string): TaskPlan | null;
