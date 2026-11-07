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
/** 提前多久开始收尾。 */
export const WATCHDOG_LEAD_MS = 5 * 60_000;
/**
 * 判断现在该不该收尾。
 *
 * `remainingMs` 是距离「必须结束」还剩多久。到 0 之前的最后 5 分钟会返回
 * `closing`，宿主看到这个就该主动停手，而不是等系统来杀。
 */
export function checkWatchdog(input) {
    const deadline = input.startedAt + input.timeoutMs;
    const closeAt = deadline - WATCHDOG_LEAD_MS;
    const remainingMs = Math.max(0, deadline - input.now);
    if (input.now < closeAt) {
        return { kind: 'running', remainingMs };
    }
    return {
        kind: 'closing',
        remainingMs: 0,
        report: buildTimeoutReport(input, deadline)
    };
}
/** 只问「该不该收尾」，不需要报告时用这个。 */
export function shouldClose(input) {
    return checkWatchdog(input).kind === 'closing';
}
/**
 * 生成超时报告。
 *
 * status 固定为 `timeout`，不写成 `failed`：这两件事要分开记。
 * 超时说明流程本身可能没问题，只是这一轮没跑完；失败说明有步骤明确做错了。
 * 混在一起会让人误判该修哪。
 */
export function buildTimeoutReport(input, deadline) {
    const elapsedMinutes = Math.round((input.now - input.startedAt) / 60_000);
    return {
        runId: input.runId,
        game: input.game,
        mode: input.mode,
        status: 'timeout',
        startedAt: input.startedAt,
        endedAt: input.now,
        steps: [
            ...(input.steps ?? []),
            {
                name: '看门狗收尾',
                ok: false,
                detail: `跑到第 ${elapsedMinutes} 分钟仍未结束，提前停手并留档`,
                at: input.now
            }
        ],
        evidence: [],
        conclusion: `超时收尾：原定上限 ${Math.round(input.timeoutMs / 60_000)} 分钟，` +
            `距强制结束还剩 ${Math.round((deadline - input.now) / 60_000)} 分钟`
    };
}
