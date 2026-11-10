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
export const CLIENT_OPERATIONS = ['capture', 'move', 'click', 'press'];
/** 最少要过的警告次数。低于这个数的配置会被钳回来。 */
export const MIN_REQUIRED_WARNINGS = 3;
export const DEFAULT_REQUIRED_WARNINGS = 3;
/** 默认武装时长：30 分钟。够跑一轮日常，结束后自动收回。 */
export const DEFAULT_ARM_DURATION_MS = 30 * 60 * 1000;
/** 两次警告之间的最小间隔，防止连点三下直接过。 */
export const DEFAULT_WARNING_COOLDOWN_MS = 15 * 1000;
/**
 * 警告文案，按次数递进。
 *
 * 第一次讲风险，第二次讲后果，第三次讲怎么退出。
 * 写死在这里，不交给调用方传，避免被换成一句轻飘飘的「确定吗」。
 *
 * 措辞可以轻快，但要留够分量：这三句是账号封禁前最后三道栅栏，不能说得像撒娇。
 */
export const ARMING_WARNINGS = [
    '人家的手要伸到你的鼠标上啦♪ 先打个招呼：从这一步起，我按下的每一下，游戏都可能当成外挂。',
    '还要继续吗？再认认真真说一遍——真被判定成第三方工具，赔进去的是你的号，这种封禁通常连申诉的门都不给开。',
    '最后一次。钥匙现在递到你手里了：接下来三十分钟我可以碰，你只要说一句「停下」，人家的手就立刻收回来，一秒都不拖。'
];
export const DEFAULT_CLIENT_CONTROL_CONFIG = {
    requiredWarnings: DEFAULT_REQUIRED_WARNINGS,
    armDurationMs: DEFAULT_ARM_DURATION_MS,
    warningCooldownMs: DEFAULT_WARNING_COOLDOWN_MS
};
export class ClientControlDisabledError extends Error {
    operation;
    constructor(operation) {
        super(`钥匙还在抽屉里哦，人家不能碰你的游戏。这次想做的事先记下了：${operation}`);
        this.name = 'ClientControlDisabledError';
        this.operation = operation;
    }
}
function normalizeConfig(config = {}) {
    const required = config.requiredWarnings ?? DEFAULT_REQUIRED_WARNINGS;
    return {
        // 下限钳制：配置写 1 也不让它一次点过。
        requiredWarnings: Math.max(MIN_REQUIRED_WARNINGS, Math.trunc(required)),
        armDurationMs: Math.max(1, Math.trunc(config.armDurationMs ?? DEFAULT_ARM_DURATION_MS)),
        warningCooldownMs: Math.max(0, Math.trunc(config.warningCooldownMs ?? DEFAULT_WARNING_COOLDOWN_MS))
    };
}
export class ClientControl {
    config;
    warningsGiven = 0;
    lastWarningAt;
    armedUntil;
    constructor(config = {}) {
        this.config = normalizeConfig(config);
    }
    get requiredWarnings() {
        return this.config.requiredWarnings;
    }
    /**
     * 请求开启。
     *
     * 每次调用给一次警告，次数够了才真的武装。
     * 冷却期内的重复调用不算数，避免「连点三下」当成三次确认。
     */
    requestArm(now) {
        if (this.isArmed(now)) {
            return {
                state: 'armed',
                armed: false,
                remaining: 0
            };
        }
        if (this.lastWarningAt !== undefined && now - this.lastWarningAt < this.config.warningCooldownMs) {
            return {
                state: this.stateOf(now),
                armed: false,
                remaining: this.config.requiredWarnings - this.warningsGiven
            };
        }
        this.warningsGiven += 1;
        this.lastWarningAt = now;
        if (this.warningsGiven >= this.config.requiredWarnings) {
            this.armedUntil = now + this.config.armDurationMs;
            return {
                state: 'armed',
                warning: ARMING_WARNINGS[ARMING_WARNINGS.length - 1],
                armed: true,
                remaining: 0
            };
        }
        const index = Math.min(this.warningsGiven - 1, ARMING_WARNINGS.length - 1);
        return {
            state: 'warning',
            warning: ARMING_WARNINGS[index],
            armed: false,
            remaining: this.config.requiredWarnings - this.warningsGiven
        };
    }
    /** 手动收回。任何时候调用都立即回落到 disabled，并清空已累积的警告。 */
    disarm() {
        this.armedUntil = undefined;
        this.warningsGiven = 0;
        this.lastWarningAt = undefined;
    }
    isArmed(now) {
        if (this.armedUntil === undefined)
            return false;
        if (now >= this.armedUntil) {
            // 到期顺手清掉，避免下次读到一个过期的 armed。
            this.armedUntil = undefined;
            this.warningsGiven = 0;
            this.lastWarningAt = undefined;
            return false;
        }
        return true;
    }
    stateOf(now) {
        if (this.isArmed(now))
            return 'armed';
        return this.warningsGiven > 0 ? 'warning' : 'disabled';
    }
    /**
     * 操作总闸。
     *
     * 武装中放行全部操作；未武装一律拒绝，未知操作也拒绝。
     */
    assertAllowed(operation, now) {
        if (!this.isArmed(now)) {
            throw new ClientControlDisabledError(operation);
        }
        if (!CLIENT_OPERATIONS.includes(operation)) {
            throw new ClientControlDisabledError(operation);
        }
    }
    status(now) {
        const state = this.stateOf(now);
        return {
            state,
            warningsGiven: this.warningsGiven,
            requiredWarnings: this.config.requiredWarnings,
            ...(this.armedUntil === undefined ? {} : { armedUntil: this.armedUntil }),
            ...(this.lastWarningAt === undefined ? {} : { lastWarningAt: this.lastWarningAt })
        };
    }
}
