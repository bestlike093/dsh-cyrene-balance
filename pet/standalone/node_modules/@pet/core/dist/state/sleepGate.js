export const ALL_ACTIVITIES = [
    'speak',
    'animate',
    'balance-check',
    'todo-remind',
    'proactive',
    'notify'
];
const DEFAULT_MAX_SUPPRESSED = 100;
/**
 * 睡眠闸门。
 *
 * 状态机只知道「现在是 sleeping」，不知道睡着的含义。这一层补上后者：
 * 睡眠期间所有对外行为一律拦下，并记录在案。
 *
 * 记录不是日志。醒来时 `drain()` 把它交回宿主，由宿主决定要不要补一句
 * 「你睡着的时候，有人找过你」——被静音的这段时间需要能追溯，
 * 否则「她睡着了」和「她坏掉了」在用户眼里没有区别。
 *
 * 只读取状态机，不驱动它；叫醒是用户的事，这里不提供自动醒来。
 */
export class SleepGate {
    machine;
    now;
    maxSuppressed;
    suppressed = [];
    constructor(options) {
        this.machine = options.machine;
        this.now = options.now ?? Date.now;
        this.maxSuppressed = Math.max(1, options.maxSuppressed ?? DEFAULT_MAX_SUPPRESSED);
    }
    /** 当前是否睡着。每次实时问状态机，不缓存。 */
    get sleeping() {
        return this.machine.state === 'sleeping';
    }
    /** 这个行为此刻能不能做。睡着时一律不能。 */
    allows(activity) {
        return !this.sleeping;
    }
    /**
     * 尝试执行一个行为。
     *
     * 返回 true 表示放行，调用方继续；返回 false 表示被睡眠拦下，
     * 已记入待补偿列表。睡着时调用方什么都不用做，不需要再写分支。
     */
    request(activity, detail) {
        if (!this.sleeping)
            return true;
        const entry = detail === undefined
            ? { activity, at: this.now() }
            : { activity, at: this.now(), detail };
        this.suppressed.push(entry);
        if (this.suppressed.length > this.maxSuppressed) {
            this.suppressed.shift();
        }
        return false;
    }
    /** 取出并清空被拦记录。醒来后调一次，由宿主决定怎么补偿。 */
    drain() {
        const drained = this.suppressed;
        this.suppressed = [];
        return drained;
    }
    /** 清空但不返回。用户手动叫醒、明确表示不想补的时候用。 */
    clear() {
        this.suppressed = [];
    }
    /** 当前积压条数。宿主可以据此决定醒来时要不要提。 */
    get pending() {
        return this.suppressed.length;
    }
}
