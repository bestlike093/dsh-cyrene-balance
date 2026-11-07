/**
 * 子任务调度。
 *
 * 规则来自实际踩过的坑：
 *
 * - 同一位黄金裔在一段对话里只保留一个上下文，再派活时接在原上下文
 * - 只读任务可以并行，写入任务必须排队
 * - 每个子任务有自己的步数预算，超了就停，不能无限挖下去
 *
 * 对应能力：`agent.subagent`。
 */
export type TaskKind = 'read-only' | 'write';
export interface SubagentTask<TInput = unknown> {
    readonly id: string;
    /** 黄金裔的标识，比如 `fengjin`。 */
    readonly companionId: string;
    readonly kind: TaskKind;
    readonly input: TInput;
    readonly budget?: number;
}
export interface SubagentHandle {
    readonly taskId: string;
    readonly companionId: string;
    /** 复用了已有上下文时为 `true`。 */
    readonly reused: boolean;
    readonly slot: number;
}
export declare class SubagentError extends Error {
    readonly reason: 'no-slot' | 'companion-closed' | 'duplicate' | 'budget';
    constructor(reason: SubagentError['reason'], message: string);
}
export interface SchedulerOptions {
    /** 同时能跑几个只读任务，默认 3。 */
    readonly maxConcurrentRead?: number;
    /** 每个任务的默认步数预算。 */
    readonly defaultBudget?: number;
}
/**
 * 子任务调度器。
 *
 * 只管「谁能在什么时候开始」，不真的执行任务。
 * 执行交给宿主，完成时调用 `finish`。
 */
export declare class SubagentScheduler {
    private readonly contexts;
    private readonly running;
    private readonly maxConcurrentRead;
    private readonly defaultBudget;
    private writing;
    constructor(options?: SchedulerOptions);
    /** 派一个任务。返回句柄，宿主据此去执行。 */
    claim(task: SubagentTask): SubagentHandle;
    /** 任务结束（成功或失败都算）。 */
    finish(taskId: string): void;
    /** 关闭某个角色，释放它的上下文。之后派活会创建新上下文。 */
    close(companionId: string): void;
    /** 当前有几个任务在跑。 */
    get activeCount(): number;
    /** 某个角色是否还开着上下文。 */
    isOpen(companionId: string): boolean;
    /** 这个角色的上下文里跑过哪些任务。 */
    historyOf(companionId: string): readonly string[];
    /**
     * 把任务切成一串批，按顺序跑。
     *
     * 同一批里都是只读，可以并行；遇到写任务单独成批。
     */
    plan(tasks: readonly SubagentTask[]): readonly (readonly SubagentTask[])[];
    /** 预算检查：步数用完了没有。 */
    overBudget(task: SubagentTask, usedSteps: number): boolean;
    private countReads;
}
