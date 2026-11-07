/**
 * 每日运行报告与兜底对账。
 *
 * 来自 dsh-game-daily 的硬规矩：**报告是唯一判定依据**。
 * 插件不看进程退出码、不猜 stdout 里有没有「完成」，只认 report.json。
 *
 * 理由很实际：游戏脚本的退出码经常是 0 而任务没做完，也可能被系统
 * 强杀后什么都不留。报告让「跑完了」和「没跑起来」变成可审计的事实。
 */
import type { GameId, RunMode } from './dailySchedule.js';
export type ReportStatus = 'success' | 'partial' | 'failed' | 'timeout';
export declare const REPORT_STATUSES: readonly ReportStatus[];
export interface ReportStep {
    readonly name: string;
    readonly ok: boolean;
    /** 失败原因或关键数据，给人和 agent 看。 */
    readonly detail?: string;
    readonly at?: number;
}
export interface DailyReport {
    readonly runId: string;
    readonly game: GameId;
    readonly mode: RunMode;
    readonly status: ReportStatus;
    readonly startedAt: number;
    readonly endedAt?: number;
    readonly steps: readonly ReportStep[];
    /** 证据路径（截图、日志片段），用来复核「凭什么说做完了」。 */
    readonly evidence: readonly string[];
    readonly conclusion?: string;
}
/**
 * 解析报告。
 *
 * 容错优先：缺 steps 或 evidence 时补空数组，未知 status 直接判失败。
 * 一份读不懂的报告比没有报告更危险——所以宁可把它降级成 `failed`，
 * 也不让调用方误以为成功。
 */
export declare function parseReport(raw: unknown): DailyReport;
/** 报告是否算「完成」。`partial` 不算——它意味着有步骤没做成。 */
export declare function isCompleted(report: DailyReport): boolean;
/** 失败或超时时，把第一个失败步骤挑出来，方便一句话汇报。 */
export declare function firstFailure(report: DailyReport): ReportStep | null;
export interface ReconcileInput {
    /** 期望存在的这一轮。 */
    readonly expected: {
        readonly runId: string;
        readonly game: GameId;
        readonly mode: RunMode;
        readonly startedAt: number;
    };
    /** 读到并解析成功的报告；读不到传 null。 */
    readonly report: DailyReport | null;
    /** 该轮的进程是否还活着。 */
    readonly processAlive: boolean;
    readonly now: number;
    /** 进程退出后等多久才判「报告丢了」。默认 3 分钟。 */
    readonly graceMs?: number;
}
export declare const DEFAULT_RECONCILE_GRACE_MS: number;
export type ReconcileResult = {
    readonly kind: 'ok';
    readonly report: DailyReport;
} | {
    readonly kind: 'still-running';
} | {
    readonly kind: 'missing';
    readonly synthetic: DailyReport;
};
/**
 * 兜底对账。
 *
 * 对应 dsh-game-daily 里那条：如果某轮连兜底报告都没写（被手动结束或崩溃），
 * 在进程确已退出、且过了宽限期之后，补一条 `failed`，不再静默。
 *
 * 宽限期存在的意义：进程刚退出时报告可能还在写盘，立刻判失败会误伤。
 */
export declare function reconcileRun(input: ReconcileInput): ReconcileResult;
