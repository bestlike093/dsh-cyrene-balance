import type { PetStateMachine } from './stateMachine.js';
/**
 * 会被睡眠静音的行为。
 *
 * 设计取舍：睡着时「不播动作、不碎碎念、不查余额、不待办、
 * 不工作状态都不打扰」。这里把它拆成可判定的枚举，让调用方在发起行为前
 * 先问一句，而不是各自在内部写 `if (state === 'sleeping') return`。
 */
export type PetActivity = 'speak' | 'animate' | 'balance-check' | 'todo-remind' | 'proactive' | 'notify';
export declare const ALL_ACTIVITIES: readonly PetActivity[];
/** 睡眠期间被拦下的一笔记录。 */
export interface SuppressedActivity {
    readonly activity: PetActivity;
    readonly at: number;
    readonly detail?: string;
}
export interface SleepGateOptions {
    readonly machine: PetStateMachine;
    readonly now?: () => number;
    /** 最多记多少条，超出丢最早的。默认 100。 */
    readonly maxSuppressed?: number;
}
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
export declare class SleepGate {
    private readonly machine;
    private readonly now;
    private readonly maxSuppressed;
    private suppressed;
    constructor(options: SleepGateOptions);
    /** 当前是否睡着。每次实时问状态机，不缓存。 */
    get sleeping(): boolean;
    /** 这个行为此刻能不能做。睡着时一律不能。 */
    allows(activity: PetActivity): boolean;
    /**
     * 尝试执行一个行为。
     *
     * 返回 true 表示放行，调用方继续；返回 false 表示被睡眠拦下，
     * 已记入待补偿列表。睡着时调用方什么都不用做，不需要再写分支。
     */
    request(activity: PetActivity, detail?: string): boolean;
    /** 取出并清空被拦记录。醒来后调一次，由宿主决定怎么补偿。 */
    drain(): readonly SuppressedActivity[];
    /** 清空但不返回。用户手动叫醒、明确表示不想补的时候用。 */
    clear(): void;
    /** 当前积压条数。宿主可以据此决定醒来时要不要提。 */
    get pending(): number;
}
