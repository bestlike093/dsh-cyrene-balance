/**
 * 需求状态：连接、新鲜、成就、休息四类需求。
 *
 * 数值只改变主动冒泡的频率与语气权重，不进入模型上下文，也不对外发送。
 * 默认关闭；关闭时所有需求恒为 0，调度器不会因为「需求」而打扰用户。
 */
export const NEED_KEYS = ['connection', 'novelty', 'achievement', 'rest'];
export const NEED_LABELS = {
    connection: '连接',
    novelty: '新鲜',
    achievement: '成就',
    rest: '休息'
};
/** 每小时自然回升的速度，0..1/小时。 */
export const DEFAULT_NEED_GROWTH = {
    connection: 0.12,
    novelty: 0.08,
    achievement: 0.06,
    rest: 0.15
};
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function emptyLevels() {
    return { connection: 0, novelty: 0, achievement: 0, rest: 0 };
}
export class NeedsState {
    now;
    growth;
    enabled;
    levels = emptyLevels();
    updatedAt;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.enabled = options.enabled ?? false;
        this.growth = { ...DEFAULT_NEED_GROWTH, ...options.growthPerHour };
        this.updatedAt = this.now();
    }
    get isEnabled() {
        return this.enabled;
    }
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled)
            this.levels = emptyLevels();
    }
    /** 时间流逝：按每小时速度回升，封顶 1。 */
    advance(elapsedMs = this.now() - this.updatedAt) {
        if (!this.enabled)
            return;
        if (elapsedMs <= 0)
            return;
        const hours = elapsedMs / 3_600_000;
        for (const key of NEED_KEYS) {
            this.levels[key] = clamp(this.levels[key] + this.growth[key] * hours, 0, 1);
        }
        this.updatedAt = this.now();
    }
    /** 某类需求被满足：数值下降，最低 0。 */
    satisfy(key, amount = 0.4) {
        if (!this.enabled)
            return;
        this.advance();
        this.levels[key] = clamp(this.levels[key] - clamp(amount, 0, 1), 0, 1);
        this.updatedAt = this.now();
    }
    /** 用问卷或偏好初始化，值会被夹到 0..1。 */
    setLevels(partial) {
        if (!this.enabled)
            return;
        for (const key of NEED_KEYS) {
            const value = partial[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                this.levels[key] = clamp(value, 0, 1);
            }
        }
        this.updatedAt = this.now();
    }
    snapshot() {
        if (!this.enabled) {
            return { levels: emptyLevels(), dominant: 'connection', updatedAt: this.now() };
        }
        this.advance();
        let dominant = NEED_KEYS[0] ?? 'connection';
        let highest = this.levels[dominant];
        for (const key of NEED_KEYS) {
            if (this.levels[key] > highest) {
                highest = this.levels[key];
                dominant = key;
            }
        }
        return {
            levels: { ...this.levels },
            dominant,
            updatedAt: this.updatedAt
        };
    }
}
