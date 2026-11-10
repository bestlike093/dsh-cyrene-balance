/**
 * 直接操作游戏客户端：武装阶梯。
 *
 * 这是整个项目里风险最高的一块。模拟点击和按键会被游戏判定为第三方工具，
 * 最坏后果是账号封禁，而且封了不会退。所以入口不设一个「开关」，
 * 设成一段必须走完的阶梯：
 *
 * disabled → 连续 N 次警告 → armed（带时限）→ 超时或手动停下回落
 *
 * 三条硬约束：
 * 1. 默认 disabled，第一次请求只给警告，不会开启
 * 2. 警告次数下限是 3，配置写 1 也会被钳回 3，不给「一次点过」留口子
 * 3. armed 有时限，到点自动回落，不需要谁记得去关
 *
 * 这一层只做判定，不碰输入。真正的模拟由宿主实现，按这里的结论决定放不放行。
 */
export type ClientControlState = 'disabled' | 'warning' | 'armed';
/** 允许在 armed 期间执行的操作。抓帧算读，其余三个算写。 */
export type ClientOperation = 'capture' | 'move' | 'click' | 'press';
export declare const CLIENT_OPERATIONS: readonly ClientOperation[];
/** 最少要过的警告次数。低于这个数的配置会被钳回来。 */
export declare const MIN_REQUIRED_WARNINGS = 3;
export declare const DEFAULT_REQUIRED_WARNINGS = 3;
/** 默认武装时长：30 分钟。够跑一轮日常，结束后自动收回。 */
export declare const DEFAULT_ARM_DURATION_MS: number;
/** 两次警告之间的最小间隔，防止连点三下直接过。 */
export declare const DEFAULT_WARNING_COOLDOWN_MS: number;
/**
 * 警告文案，按次数递进。
 *
 * 第一次讲风险，第二次讲后果，第三次讲怎么退出。
 * 写死在这里，不交给调用方传，避免被换成一句轻飘飘的「确定吗」。
 *
 * 措辞可以轻快，但要留够分量：这三句是账号封禁前最后三道栅栏，不能说得像撒娇。
 */
export declare const ARMING_WARNINGS: readonly string[];
export interface ClientControlConfig {
    /** 需要走过几次警告。低于 3 会被钳到 3。 */
    readonly requiredWarnings: number;
    /** 武装后多久自动收回。 */
    readonly armDurationMs: number;
    /** 两次警告的最小间隔。 */
    readonly warningCooldownMs: number;
}
export declare const DEFAULT_CLIENT_CONTROL_CONFIG: ClientControlConfig;
export interface ClientControlStatus {
    readonly state: ClientControlState;
    readonly warningsGiven: number;
    readonly requiredWarnings: number;
    /** 武装到期时间；未武装时没有这一项。 */
    readonly armedUntil?: number;
    readonly lastWarningAt?: number;
}
export interface ArmDecision {
    readonly state: ClientControlState;
    /** 这一次调用给出的警告。冷却期内重复调用时没有新警告。 */
    readonly warning?: string;
    /** 是否已经走完阶梯、这一次真的开启了。 */
    readonly armed: boolean;
    /** 还差几次。 */
    readonly remaining: number;
}
export declare class ClientControlDisabledError extends Error {
    readonly operation: string;
    constructor(operation: string);
}
export declare class ClientControl {
    private readonly config;
    private warningsGiven;
    private lastWarningAt;
    private armedUntil;
    constructor(config?: Partial<ClientControlConfig>);
    get requiredWarnings(): number;
    /**
     * 请求开启。
     *
     * 每次调用给一次警告，次数够了才真的武装。
     * 冷却期内的重复调用不算数，避免「连点三下」当成三次确认。
     */
    requestArm(now: number): ArmDecision;
    /** 手动收回。任何时候调用都立即回落到 disabled，并清空已累积的警告。 */
    disarm(): void;
    isArmed(now: number): boolean;
    stateOf(now: number): ClientControlState;
    /**
     * 操作总闸。
     *
     * 武装中放行全部操作；未武装一律拒绝，未知操作也拒绝。
     */
    assertAllowed(operation: string, now: number): asserts operation is ClientOperation;
    status(now: number): ClientControlStatus;
}
