export interface SchedulerOptions {
    readonly setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    readonly clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}
/** 指数退避：第 1 次 baseMs，之后翻倍，封顶 maxMs。 */
export declare function backoffDelay(attempt: number, baseMs?: number, maxMs?: number): number;
/**
 * 可取消调度器。
 * 所有定时器都登记在表里，dispose 时一次性清空，避免模块卸载后回调继续跑。
 */
export declare class Scheduler {
    private readonly timers;
    private readonly setTimeoutFn;
    private readonly clearTimeoutFn;
    private sequence;
    constructor(options?: SchedulerOptions);
    get size(): number;
    schedule(delayMs: number, fn: () => void): string;
    cancel(id: string): boolean;
    clear(): void;
    /** 超时即抛 LOAD_TIMEOUT，且不会留下悬挂定时器。 */
    runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T>;
}
