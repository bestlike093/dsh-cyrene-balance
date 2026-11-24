/**
 * 情绪余波：让情绪在事件结束后缓慢回落，而不是瞬间归零。
 *
 * 这是表现层的近似，不声称她真的有情绪。数值只影响下一次表情与台词的
 * 选择权重，不进入模型上下文，也不上传。
 *
 * 衰减用半衰期：经过一个 halfLifeMs，绝对值减半。读取时惰性结算，
 * 所以没有定时器也能正确衰减。
 */
import { EMOTION, TIME } from '../standard.mjs';

export const DEFAULT_AFTERGLOW_HALF_LIFE_MS = EMOTION.afterglow.halfLifeMinutes * TIME.MINUTE;
export const DEFAULT_AFTERGLOW_WEIGHT = EMOTION.afterglow.impulseWeight;
const DEFAULT_EPSILON = EMOTION.afterglow.epsilon;
function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return min;
    return Math.min(max, Math.max(min, number));
}
/** 半衰期衰减：elapsed <= 0 时原样返回。 */
export function decayByHalfLife(value, elapsedMs, halfLifeMs) {
    if (!Number.isFinite(value) || value === 0)
        return 0;
    if (elapsedMs <= 0 || halfLifeMs <= 0)
        return value;
    return value * 2 ** (-elapsedMs / halfLifeMs);
}
export class EmotionAfterglow {
    now;
    halfLifeMs;
    weight;
    epsilon;
    enabled;
    valence = 0;
    arousal = 0;
    updatedAt;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.halfLifeMs = options.halfLifeMs ?? DEFAULT_AFTERGLOW_HALF_LIFE_MS;
        this.weight = clamp(options.weight ?? DEFAULT_AFTERGLOW_WEIGHT, EMOTION.afterglow.weightMin, EMOTION.afterglow.weightMax);
        this.epsilon = options.epsilon ?? DEFAULT_EPSILON;
        this.enabled = options.enabled ?? false;
        this.updatedAt = this.now();
    }
    get isEnabled() {
        return this.enabled;
    }
    /** 开关只影响后续行为；关闭时立刻清零，不保留残余。 */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled)
            this.reset();
    }
    /** 先结算到当前时刻，再按权重靠近目标值。 */
    impulse(input, weight = this.weight) {
        if (!this.enabled)
            return this.snapshot();
        this.settle();
        const valence = Number(input?.valence);
        const arousal = Number(input?.arousal);
        /* 非法输入按中立处理，不能拿 min 当作默认值把情绪推到 -1。 */
        const targetValence = Number.isFinite(valence) ? clamp(valence, EMOTION.afterglow.valenceMin, EMOTION.afterglow.valenceMax) : 0;
        const targetArousal = Number.isFinite(arousal) ? clamp(arousal, EMOTION.afterglow.arousalMin, EMOTION.afterglow.arousalMax) : 0;
        const ratio = clamp(weight, EMOTION.afterglow.weightMin, EMOTION.afterglow.weightMax);
        this.valence = clamp(this.valence + (targetValence - this.valence) * ratio, EMOTION.afterglow.valenceMin, EMOTION.afterglow.valenceMax);
        this.arousal = clamp(this.arousal + (targetArousal - this.arousal) * ratio, EMOTION.afterglow.arousalMin, EMOTION.afterglow.arousalMax);
        this.updatedAt = this.now();
        return this.snapshot();
    }
    /** 读取时惰性衰减；关闭时按零值返回。 */
    snapshot() {
        if (!this.enabled) {
            return { valence: 0, arousal: 0, updatedAt: this.now() };
        }
        this.settle();
        return {
            valence: this.valence,
            arousal: this.arousal,
            updatedAt: this.updatedAt
        };
    }
    reset() {
        this.valence = 0;
        this.arousal = 0;
        this.updatedAt = this.now();
    }
    settle() {
        const now = this.now();
        const elapsed = now - this.updatedAt;
        if (elapsed <= 0)
            return;
        this.valence = decayByHalfLife(this.valence, elapsed, this.halfLifeMs);
        this.arousal = decayByHalfLife(this.arousal, elapsed, this.halfLifeMs);
        if (Math.abs(this.valence) < this.epsilon)
            this.valence = 0;
        if (Math.abs(this.arousal) < this.epsilon)
            this.arousal = 0;
        this.updatedAt = now;
    }
}
