/**
 * 每日运行报告与兜底对账。
 *
 * 来自 dsh-game-daily 的硬规矩：**报告是唯一判定依据**。
 * 插件不看进程退出码、不猜 stdout 里有没有「完成」，只认 report.json。
 *
 * 理由很实际：游戏脚本的退出码经常是 0 而任务没做完，也可能被系统
 * 强杀后什么都不留。报告让「跑完了」和「没跑起来」变成可审计的事实。
 */
import { ErrorCode, PetError } from '@pet/shared';
export const REPORT_STATUSES = ['success', 'partial', 'failed', 'timeout'];
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readString(source, key) {
    const value = source[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}
function readNumber(source, key) {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function isReportStatus(value) {
    return REPORT_STATUSES.includes(value);
}
/**
 * 解析报告。
 *
 * 容错优先：缺 steps 或 evidence 时补空数组，未知 status 直接判失败。
 * 一份读不懂的报告比没有报告更危险——所以宁可把它降级成 `failed`，
 * 也不让调用方误以为成功。
 */
export function parseReport(raw) {
    if (!isRecord(raw)) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '报告不是对象');
    }
    const runId = readString(raw, 'runId');
    const game = readString(raw, 'game');
    const mode = readString(raw, 'mode');
    const status = readString(raw, 'status');
    const startedAt = readNumber(raw, 'startedAt');
    if (runId === null) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '报告缺少 runId');
    }
    if (game === null) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '报告缺少 game');
    }
    if (mode !== 'real' && mode !== 'dry') {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `报告 mode 不合法：${String(mode)}`);
    }
    if (startedAt === null) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '报告缺少 startedAt');
    }
    const resolvedStatus = status !== null && isReportStatus(status) ? status : 'failed';
    const steps = [];
    if (Array.isArray(raw.steps)) {
        for (const item of raw.steps) {
            if (!isRecord(item))
                continue;
            const name = readString(item, 'name');
            if (name === null)
                continue;
            const ok = item.ok === true;
            const detail = readString(item, 'detail');
            const at = readNumber(item, 'at');
            steps.push({
                name,
                ok,
                ...(detail === null ? {} : { detail }),
                ...(at === null ? {} : { at })
            });
        }
    }
    const evidence = [];
    if (Array.isArray(raw.evidence)) {
        for (const item of raw.evidence) {
            if (typeof item === 'string' && item.length > 0)
                evidence.push(item);
        }
    }
    const endedAt = readNumber(raw, 'endedAt');
    const conclusion = readString(raw, 'conclusion');
    return {
        runId,
        game: game,
        mode,
        status: resolvedStatus,
        startedAt,
        ...(endedAt === null ? {} : { endedAt }),
        steps,
        evidence,
        ...(conclusion === null ? {} : { conclusion })
    };
}
/** 报告是否算「完成」。`partial` 不算——它意味着有步骤没做成。 */
export function isCompleted(report) {
    return report.status === 'success';
}
/** 失败或超时时，把第一个失败步骤挑出来，方便一句话汇报。 */
export function firstFailure(report) {
    return report.steps.find((step) => !step.ok) ?? null;
}
export const DEFAULT_RECONCILE_GRACE_MS = 3 * 60_000;
/**
 * 兜底对账。
 *
 * 对应 dsh-game-daily 里那条：如果某轮连兜底报告都没写（被手动结束或崩溃），
 * 在进程确已退出、且过了宽限期之后，补一条 `failed`，不再静默。
 *
 * 宽限期存在的意义：进程刚退出时报告可能还在写盘，立刻判失败会误伤。
 */
export function reconcileRun(input) {
    if (input.report !== null) {
        return { kind: 'ok', report: input.report };
    }
    const grace = input.graceMs ?? DEFAULT_RECONCILE_GRACE_MS;
    const elapsed = input.now - input.expected.startedAt;
    if (input.processAlive || elapsed < grace) {
        return { kind: 'still-running' };
    }
    return {
        kind: 'missing',
        synthetic: {
            runId: input.expected.runId,
            game: input.expected.game,
            mode: input.expected.mode,
            status: 'failed',
            startedAt: input.expected.startedAt,
            endedAt: input.now,
            steps: [
                {
                    name: '收集报告',
                    ok: false,
                    detail: '进程已退出，但没有留下 report.json',
                    at: input.now
                }
            ],
            evidence: [],
            conclusion: '这一轮没有产出报告，按失败记账'
        }
    };
}
