/**
 * 看门狗：在系统执行时限把进程强杀之前，主动收尾并留下报告。
 *
 * 来源是 dsh-game-daily 的一条实战经验：计划任务的执行时限到了会直接杀进程，
 * 被杀之后什么都不留，事后根本分不清「跑完了」还是「没跑起来」。
 *
 * 做法是把收尾提前。计划任务的执行时限 = 单轮超时 + 10 分钟，
 * 这 10 分钟里前 5 分钟给看门狗：到点主动停掉执行、写一份 `status=timeout`
 * 的报告、再退出。剩下的 5 分钟留给写盘和进程退出的缓冲。
 *
 * 这一层只做判定，不碰进程。真正的停止由宿主执行。
 */
import type { DailyReport, ReportStep } from './dailyReport.js';
import type { GameId, RunMode } from './dailySchedule.js';
/** 提前多久开始收尾。 */
export declare const WATCHDOG_LEAD_MS: number;
export interface WatchdogInput {
    readonly runId: string;
    readonly game: GameId;
    readonly mode: RunMode;
    readonly startedAt: number;
    /** 这一轮允许跑多久，与排班配置里的 timeoutMinutes 一致。 */
    readonly timeoutMs: number;
    readonly now: number;
    /** 已经完成的步骤，收尾时一并写进报告。 */
    readonly steps?: readonly ReportStep[];
}
export type WatchdogVerdict = {
    readonly kind: 'running';
    readonly remainingMs: number;
} | {
    readonly kind: 'closing';
    readonly remainingMs: 0;
    readonly report: DailyReport;
};
/**
 * 判断现在该不该收尾。
 *
 * `remainingMs` 是距离「必须结束」还剩多久。到 0 之前的最后 5 分钟会返回
 * `closing`，宿主看到这个就该主动停手，而不是等系统来杀。
 */
export declare function checkWatchdog(input: WatchdogInput): WatchdogVerdict;
/** 只问「该不该收尾」，不需要报告时用这个。 */
export declare function shouldClose(input: WatchdogInput): boolean;
/**
 * 生成超时报告。
 *
 * status 固定为 `timeout`，不写成 `failed`：这两件事要分开记。
 * 超时说明流程本身可能没问题，只是这一轮没跑完；失败说明有步骤明确做错了。
 * 混在一起会让人误判该修哪。
 */
export declare function buildTimeoutReport(input: WatchdogInput, deadline: number): DailyReport;
