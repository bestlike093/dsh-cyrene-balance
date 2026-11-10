/**
 * 身体状态：精力、困意、睡眠债、饥饿、社交能量、生理周期、梦。
 *
 * 为什么单独一层：
 * - 心情可以从时间推，身体不能。她应该有「今天有点累」「刚睡醒还没缓过来」，
 *   而不是每次开口都精神饱满。
 * - 主动开口要看体力。精力见底时还硬找话题，读起来像客服。
 * - 关机期间时间照走，回来要补算；否则一开机永远是满状态。
 *
 * 这里只存状态，不写台词；怎么说话交给上层。数值永不直接展示给对方。
 *
 * 纯逻辑：不读文件、不碰 Electron、时间从 `now()` 注入，
 * 因此可以从 `@pet/core/browser` 导出，也能在离线测试里跑。
 * 文件读写与落盘节流由宿主（桌面端 `electron/body-state.mjs`）负责。
 */
/** 一次结算最多往前补多久；再久就按这么久算，不假装知道中间发生了什么。 */
export declare const MAX_CATCHUP_MS: number;
/** 结算步长半小时：够细，也不至于离线一周就循环到卡死。 */
export declare const STEP_MS: number;
export declare const MAX_SLEEP_DEBT = 48;
/** 同一段聊天里连着发消息，只按一次算；连发十条不该把社交力气一次扣穿。 */
export declare const CHAT_COOLDOWN_MS = 45000;
/** 单次对话最多扣多少社交力气：长消息更费神，但有上限。 */
export declare const CHAT_COST_MAX = 4;
/** 醒来之后这么久内都算「刚醒」，梦和被打断的倦才值得提。 */
export declare const JUST_WOKE_MS: number;
/** 默认作息。设置里可以改，改了下一轮就生效。 */
export declare const DEFAULT_SLEEP_WINDOW: SleepWindow;
export interface SleepWindow {
    start: string;
    end: string;
}
export interface BodyCycle {
    enabled: boolean;
    lastStart: number;
    length: number;
}
/**
 * 0..100 的富状态，字段与桌面端 `body.json` 一一对应。
 * 迁移时字段名不能改，旧文件要能直接读。
 */
export interface BodyState {
    version: number;
    updatedAt: number;
    energy: number;
    drowsiness: number;
    sleepDebt: number;
    hunger: number;
    socialEnergy: number;
    discomfort: number;
    /** 最近一次醒来；补算睡眠债要用。 */
    lastWakeAt: number;
    /** 最近一次吃饭，用来判断饿是不是「真的该吃了」。 */
    lastMealAt: number;
    /** 最近一次带着梦醒来；没醒过就是 0，不能拿开机时间冒充。 */
    lastDreamAt: number;
    /** 最近一次醒来时，睡梦里被吵醒过几次。 */
    lastWokeInterrupted: number;
    /** 睡着时被消息吵到的次数；醒来会读它。 */
    interrupted: number;
    dream: string;
    cycle: BodyCycle;
}
export interface BodyFlags {
    lowEnergy: boolean;
    sleepy: boolean;
    hungry: boolean;
    drained: boolean;
    exhausted: boolean;
}
export interface BodySnapshot extends BodyState {
    asleep: boolean;
    justWoke: boolean;
    flags: BodyFlags;
    phase: CyclePhase | null;
}
export interface BodyStats {
    energy: number;
    drowsiness: number;
    sleepDebt: number;
    hunger: number;
    socialEnergy: number;
    discomfort: number;
    flags: BodyFlags;
}
export type CyclePhaseName = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';
export interface CyclePhase {
    phase: CyclePhaseName;
    day: number;
}
/** `HH:MM` 转当天第几分钟；非法返回 null。 */
export declare function toMinute(value: unknown): number | null;
/** 跨天窗口（23:30 → 07:30）要拆开判断。 */
export declare function inSleepWindow(ms: number, window?: SleepWindow | null): boolean;
export declare function freshState(now?: number): BodyState;
/**
 * 旧文件缺字段时补齐，不因为版本变化丢整份状态。
 *
 * `updatedAt` 会尽量沿用文件里的时刻：关机期间时间照走，读回后再补算。
 * 只有文件里没有、或时间戳跑到未来（系统时钟被拨回）时才改用 `now`，
 * 避免状态被一个未来时刻冻住。
 */
export declare function readState(raw: unknown, now?: number): BodyState;
/**
 * 把状态从 from 推进到 to。
 *
 * 纯函数：传入一份状态，返回新的一份。单测不用等真实时间。
 * 步长半小时，最多补 72 小时。
 */
export declare function advance(state: BodyState, from: number, to: number, options?: {
    sleepWindow?: SleepWindow | null;
}): BodyState;
/**
 * 一句话体感。给提示词用，不报数值，也不描述成病历。
 * 只挑当下最明显的两三条，避免一次塞满。
 */
export declare function describeBody(state: BodyState | null | undefined): string;
/** 给主动闸用的硬指标，不参与表达。 */
export declare function bodyFlags(state?: BodyState | null): BodyFlags;
/** 生理周期阶段；没开或没记录就返回 null，不猜。 */
export declare function cyclePhase(state: BodyState | null | undefined, now?: number): CyclePhase | null;
export interface BodyRuntimeOptions {
    readonly now?: () => number;
    readonly getSleepWindow?: () => SleepWindow;
    /** 初始状态；不传就从默认值开始。 */
    readonly state?: BodyState;
}
/**
 * 身体运行时：同步、内存态、零依赖。
 *
 * 宿主只负责读盘、落盘与调度；状态怎么走由这里统一决定，
 * 这样桌面端、QQ 和内置模块读到的是同一套身体。
 */
export declare class BodyRuntime {
    private readonly now;
    private readonly getSleepWindow;
    private state;
    /** 上一次真正扣社交力气的时刻；只活在内存里，重启后从这一轮重新算。 */
    private lastChatAt;
    constructor(options?: BodyRuntimeOptions);
    /** 宿主读盘后接管；`updatedAt` 会沿用，下一次 tick 才补算离线时间。 */
    replace(state: BodyState): void;
    /**
     * 推进到此刻。上层每轮聊前调一次即可，内部幂等（时间没变就不动）。
     *
     * 顺便看一次「睡窗边界」：从睡梦里走出来，就当自然醒，
     * 补一句梦。
     */
    tick(at?: number): BodySnapshot;
    /** 睡着时收到消息：记一笔，醒来会知道自己被打断过。 */
    markInterrupted(at?: number): number;
    eat(amount?: number, at?: number): BodySnapshot;
    /**
     * 一次对话的社交消耗；群聊连发时上层可以多调几次。
     *
     * 同一小段时间里连着发，只算一次：连发短句不该被当成说了很多话。
     * 真正让她累的是「持续有人陪着聊」，不是一次输入框里敲了多少句。
     */
    noteChat(cost?: number, at?: number): BodySnapshot;
    /** 醒来：结算梦，重置清醒起点，被打断过就留一句。 */
    wake(at?: number): {
        interrupted: number;
        dream: string;
    };
    snapshot(): BodySnapshot;
    describe(): string;
    stats(): BodyStats;
    /** 需要落盘时的完整状态；不含 `asleep` / `flags` 这类派生字段。 */
    toJSON(): BodyState;
    /**
     * 结算一次醒来：记下梦、把「被吵醒过几次」挪到明面上，再清空当轮的计数。
     *
     * 只在这里写 `lastDreamAt`。开机那一刻不能算「刚醒」，否则每天第一次说话
     * 都会莫名其妙地报一句梦话。
     */
    private applyWake;
}
