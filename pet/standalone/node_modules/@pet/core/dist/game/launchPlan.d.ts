/**
 * 日常执行前的「先启动游戏」决策。
 *
 * 这一层只回答三个问题：要不要启动、启动哪个 exe、启动后等多久。
 * 真正的 spawn 和等待由宿主做，测试不需要装游戏。
 *
 * 默认不启动：只有用户在排班里显式打开 `launchGame`，才会动游戏本体。
 * 演练模式永远不启动，哪怕配置里开了也一样。
 */
import { type CandidateOptions } from './installPaths.js';
import type { GameId, RunMode } from './dailySchedule';
/** 启动到可以交给引擎之前，给游戏留的加载时间。 */
export declare const LAUNCH_GRACE_MS = 90000;
export interface LaunchInput {
    readonly game: GameId;
    readonly mode: RunMode;
    /** 用户是否允许这一轮先启动游戏本体。 */
    readonly launchGame: boolean;
    /** 用户显式指定的游戏本体路径；留空则按候选路径探测。 */
    readonly installPath?: string;
    readonly candidates?: CandidateOptions;
}
export type LaunchDecision = {
    readonly action: 'skip';
    readonly reason: 'dry' | 'disabled';
} | {
    readonly action: 'launch';
    readonly exe: string;
    readonly graceMs: number;
} | {
    readonly action: 'blocked';
    readonly reason: 'missing-install';
    readonly tried: readonly string[];
};
/**
 * 决定这一轮要不要先拉起游戏。
 *
 * `exists` 由宿主注入（真实运行时是文件系统）。显式路径优先；
 * 没给路径才去盘符里找。找不到就明确 blocked，不退化成「随便试一个」。
 */
export declare function decideLaunch(input: LaunchInput, exists: (path: string) => boolean): LaunchDecision;
/** 游戏进程名，用来确认「确实起来了」。 */
export declare function gameProcessName(game: GameId): string;
