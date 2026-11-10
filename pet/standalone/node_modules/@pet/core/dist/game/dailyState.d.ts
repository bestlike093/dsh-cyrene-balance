/**
 * 多游戏日常状态。
 *
 * 一份 state.json 里放四个游戏各自的排班，而不是一条全局配置。
 * 这样切游戏不会把上一个游戏的设置覆盖掉，也方便「只开原神、星铁保持演练」。
 *
 * 读盘一律走 `normalizeDailyState`：文件缺失、被截断、手改坏了、旧版本迁移，
 * 都回到「全部关闭 + 演练」，不阻断设置页，也不会因为手改 JSON 就把真实执行打开。
 */
import { type ConfigIssue, type GameDailyConfig, type GameId } from './dailySchedule.js';
export declare const DAILY_STATE_VERSION = 1;
/** 默认的每日触发时间。四个游戏错开一点，避免同一分钟抢窗口。 */
export declare const DEFAULT_TIMES: Readonly<Record<GameId, string>>;
export interface DailyState {
    readonly version: number;
    readonly games: Readonly<Record<GameId, GameDailyConfig>>;
    readonly updatedAt: number | null;
}
export type DailyPatch = Partial<Omit<GameDailyConfig, 'game'>>;
/** 单个游戏的默认值。默认关闭、演练，任何新建条目都从这里开始。 */
export declare function defaultGameConfig(game: GameId): GameDailyConfig;
export declare function defaultDailyState(): DailyState;
/**
 * 读盘时的形状修复。
 *
 * 这里刻意不报错：设置页要能打开，用户才有机会改回来。
 * 非法值一律退回默认值，而不是把整个文件判死。
 */
export declare function normalizeGameConfig(game: GameId, input: unknown): GameDailyConfig;
/**
 * 读盘入口。
 *
 * 兼容一个更早的单配置形状（顶层直接是 `{ game, time, ... }`）：
 * 把它当成那一款游戏的配置，其余游戏保持默认，避免老用户升级后设置全丢。
 */
export declare function normalizeDailyState(input: unknown): DailyState;
export interface UpdateResult {
    readonly ok: boolean;
    readonly state: DailyState;
    readonly issues: readonly ConfigIssue[];
}
/**
 * 更新一个游戏的配置。
 *
 * 先把 patch 合进候选值，再用 `validateConfig` 校验，通过了才写入 state。
 * 不合法时原样返回旧 state，让界面可以只标红不丢输入。
 */
export declare function updateGameConfig(state: DailyState, game: GameId, patch: DailyPatch, now: number): UpdateResult;
/** 已打开的游戏，按触发时间排序。 */
export declare function enabledGames(state: DailyState): readonly GameDailyConfig[];
export interface DailyStateSummary {
    readonly enabled: number;
    readonly total: number;
    readonly real: number;
    readonly dry: number;
    readonly games: readonly GameDailyConfig[];
}
export declare function summarizeDailyState(state: DailyState): DailyStateSummary;
/** 给气泡/设置页顶部的一句话。 */
export declare function describeDailyState(state: DailyState): string;
