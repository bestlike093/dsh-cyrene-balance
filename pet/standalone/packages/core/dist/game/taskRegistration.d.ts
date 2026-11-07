/**
 * 计划任务脚本生成。
 *
 * 这一层只拼字符串，不执行、不提权、不碰注册表。真正的执行交给宿主：
 * 把脚本写到数据目录，再用一次 UAC 让 PowerShell 跑它。
 *
 * 拆开的原因是可测：路径转义、星期映射、执行时限这些最容易出错的地方，
 * 都能在没有 Windows 计划任务的环境里单测。
 */
import type { TaskSpec } from './dailySchedule.js';
/** 默认任务路径。放在 `\Cyrene\` 下，卸载时能整组清掉。 */
export declare const DEFAULT_TASK_PATH = "\\Cyrene\\";
/** 计划任务名前缀。开发隔离时可以换成 `Cyrene-game-daily-dev-`。 */
export declare const DEFAULT_TASK_PREFIX = "Cyrene-game-daily-";
export interface TaskActionSpec {
    /** 解释器或可执行文件，例如 node.exe / BetterGI.exe。 */
    readonly program: string;
    /** 已经拼好的命令行参数。 */
    readonly arguments: string;
    /** 工作目录；计划任务默认是 System32，不设会找不到相对路径。 */
    readonly workingDirectory: string;
}
export interface RegisterScriptInput {
    readonly spec: TaskSpec;
    readonly action: TaskActionSpec;
    readonly taskPath?: string;
    /** highest 需要提权注册；游戏以管理员运行时必须用这个。 */
    readonly runLevel?: 'highest' | 'limited';
    readonly description?: string;
}
/**
 * PowerShell 单引号字符串转义。
 *
 * 单引号字符串里唯一需要处理的就是单引号本身：写两遍。
 * 不做双引号转义，因为双引号在单引号字符串里是普通字符。
 */
export declare function quotePowerShell(value: string): string;
/** 把 `0–6` 转成计划任务认的星期名。非法值直接丢掉，不让脚本变成半截。 */
export declare function weekdayNames(days: readonly number[]): string[];
/**
 * runner 的命令行参数。
 *
 * 用双引号包住每个值：路径里出现空格是常态，而计划任务的 Argument
 * 是整串交给 CreateProcess 的，少一层引号就会把 `C:\Program Files` 拆开。
 */
export declare function buildRunnerArguments(game: string, options: {
    readonly stateDir: string;
    readonly runId?: string;
}): string;
/**
 * 注册脚本。
 *
 * 两个刻意的选择：
 * - `-LogonType Interactive`：只在用户已登录的会话里跑。游戏要前台窗口，
 *   在无会话的 Session 0 里跑只会安静地失败。
 * - `-MultipleInstances IgnoreNew`：上一轮还没结束时不再起第二轮，避免两个
 *   进程抢同一个游戏窗口。
 */
export declare function buildRegisterScript(input: RegisterScriptInput): string;
/** 删除脚本。任务不存在时不报错，方便「关掉全部」反复点。 */
export declare function buildUnregisterScript(taskNames: readonly string[], taskPath?: string): string;
/**
 * 查询脚本。
 *
 * 输出 JSON 数组，宿主直接 `JSON.parse`。没有任务时输出 `[]`。
 * `LastTaskResult` 是计划任务自己的结果码，只作为旁证——判定一轮跑得怎么样
 * 仍然只看 report.json。
 */
export declare function buildQueryScript(taskNames: readonly string[], taskPath?: string): string;
