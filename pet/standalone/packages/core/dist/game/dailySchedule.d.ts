/**
 * 游戏日常的排班模型。
 *
 * 来自 dsh-game-daily 的做法：设置页只负责收集意图，真正写进计划任务的
 * 是一份可校验的规格。校验放在这里，宿主拿到规格再决定怎么注册。
 *
 * 刻意不碰计划任务、不碰进程、不碰文件：这一层只回答「该在什么时候跑、
 * 最多跑多久、跑的是真实还是演练」。
 */
export type GameId = 'genshin' | 'hi3' | 'starrail' | 'zzz';
export declare const GAME_IDS: readonly GameId[];
/**
 * 每轮默认超时（分钟）。
 *
 * 原神 150：一条龙流程长，还要等 BetterGI 启动。
 * 崩3 / 星铁 45：流程短，超时主要是防卡死。
 * 绝区零 60：一条龙多了切窗口与后端启动。
 */
export declare const DEFAULT_TIMEOUT_MINUTES: Readonly<Record<GameId, number>>;
/** 计划任务的系统执行时限 = 单轮超时 + 余量。余量里 5 分钟给看门狗收尾。 */
export declare const EXECUTION_LIMIT_MARGIN_MINUTES = 10;
export declare const MIN_TIMEOUT_MINUTES = 5;
export declare const MAX_TIMEOUT_MINUTES = 180;
export type RunMode = 'real' | 'dry';
export interface GameDailyConfig {
    readonly game: GameId;
    readonly enabled: boolean;
    /** `HH:MM`，24 小时制。 */
    readonly time: string;
    /** 0=周日 … 6=周六。空数组表示每天。 */
    readonly days: readonly number[];
    readonly timeoutMinutes: number;
    readonly mode: RunMode;
    /** 错过当天触发点后，下次开机补跑一轮。 */
    readonly catchUp: boolean;
    /** 跑完在一个固定会话里追加汇报。 */
    readonly reportSession: boolean;
    /** 原神可指定 BetterGI.exe；其余游戏由执行引擎自己找。 */
    readonly gamePath?: string;
    /** 真实执行前先拉起游戏本体。默认关闭，演练永远不启动。 */
    readonly launchGame: boolean;
    /** 游戏本体路径；留空则按盘符候选自动探测。 */
    readonly installPath?: string;
}
export interface ConfigIssue {
    readonly field: string;
    readonly message: string;
}
/** 时间是否是合法的 `HH:MM`。读盘修复与保存校验共用这一条规则。 */
export declare function isValidTime(value: string): boolean;
export declare function isGameId(value: string): value is GameId;
/**
 * 校验配置。
 *
 * 一次返回全部问题，而不是遇到第一个就抛错——面板要一次性把红字标完，
 * 让用户改一遍就能保存，不用来回试。
 */
export declare function validateConfig(config: GameDailyConfig): readonly ConfigIssue[];
export interface TaskSpec {
    /** 计划任务名，`game-daily-<game>`。 */
    readonly name: string;
    readonly time: string;
    /** 去重并升序；空表示每天。 */
    readonly days: readonly number[];
    /** 系统执行时限，超时 + 余量。 */
    readonly executionLimitMinutes: number;
    readonly mode: RunMode;
}
export interface TaskSpecOptions {
    /** 计划任务名前缀，默认 `game-daily-`。开发隔离时可换成 `game-daily-dev-`。 */
    readonly prefix?: string;
}
/**
 * 把配置转成计划任务规格。
 *
 * 只在配置合法时调用；非法配置应当先由 `validateConfig` 拦下，
 * 这里不重复承担报错责任。
 */
export declare function toTaskSpec(config: GameDailyConfig, options?: TaskSpecOptions): TaskSpec;
/**
 * 下一次该跑的时间点。
 *
 * 规则：
 * - 今天还没到点，且今天是执行日 → 今天
 * - 今天已过点，或今天不是执行日 → 往后找最近的执行日
 * - `catchUp` 打开时，今天已过点仍返回今天（表示「现在就该补跑」），
 *   由宿主决定是立即触发还是交给计划任务
 *
 * 找不到（比如 days 全是非法值）返回 null，让调用方自己处理。
 */
export declare function nextRunAt(config: GameDailyConfig, now: number): number | null;
/** 该配置此刻是否处于「错过补跑」窗口。 */
export declare function isCatchUpDue(config: GameDailyConfig, now: number): boolean;
