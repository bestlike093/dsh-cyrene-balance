import { ErrorCode, PetError } from '@pet/shared';
/** 指数退避：第 1 次 baseMs，之后翻倍，封顶 maxMs。 */
export function backoffDelay(attempt, baseMs = 250, maxMs = 30_000) {
    const safeAttempt = Math.max(1, Math.trunc(attempt));
    return Math.min(maxMs, baseMs * 2 ** (safeAttempt - 1));
}
/**
 * 可取消调度器。
 * 所有定时器都登记在表里，dispose 时一次性清空，避免模块卸载后回调继续跑。
 */
export class Scheduler {
    timers = new Map();
    setTimeoutFn;
    clearTimeoutFn;
    sequence = 0;
    constructor(options = {}) {
        this.setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
        this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
    }
    get size() {
        return this.timers.size;
    }
    schedule(delayMs, fn) {
        const delay = Math.max(0, Math.trunc(delayMs));
        this.sequence += 1;
        const id = `task-${this.sequence}`;
        const handle = this.setTimeoutFn(() => {
            this.timers.delete(id);
            fn();
        }, delay);
        this.timers.set(id, handle);
        return id;
    }
    cancel(id) {
        const handle = this.timers.get(id);
        if (handle === undefined)
            return false;
        this.clearTimeoutFn(handle);
        this.timers.delete(id);
        return true;
    }
    clear() {
        for (const handle of this.timers.values())
            this.clearTimeoutFn(handle);
        this.timers.clear();
    }
    /** 超时即抛 LOAD_TIMEOUT，且不会留下悬挂定时器。 */
    runWithTimeout(fn, timeoutMs) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const handle = this.setTimeoutFn(() => {
                if (settled)
                    return;
                settled = true;
                reject(new PetError(ErrorCode.LOAD_TIMEOUT, `模块执行超时（${timeoutMs}ms）`));
            }, Math.max(0, Math.trunc(timeoutMs)));
            fn().then((value) => {
                if (settled)
                    return;
                settled = true;
                this.clearTimeoutFn(handle);
                resolve(value);
            }, (error) => {
                if (settled)
                    return;
                settled = true;
                this.clearTimeoutFn(handle);
                reject(error);
            });
        });
    }
}
