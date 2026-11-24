/**
 * 需求状态：连接、新鲜、成就、休息四类需求。
 *
 * 数值只改变主动冒泡的频率与语气权重，不进入模型上下文，也不对外发送。
 * 默认关闭；关闭时所有需求恒为 0，调度器不会因为「需求」而打扰用户。
 */
import { EMOTION, TIME } from '../standard.mjs'

export const NEED_KEYS = ['connection', 'novelty', 'achievement', 'rest'];
export const NEED_LABELS = {
    connection: '连接',
    novelty: '新鲜',
    achievement: '成就',
    rest: '休息'
};
/** 每小时自然回升的速度，0..1/小时；标准值统一来自 standard。 */
export const DEFAULT_NEED_GROWTH = EMOTION.needs.growthPerHour;
const NEED_MIN = EMOTION.needs.levelMin;
const NEED_MAX = EMOTION.needs.levelMax;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function emptyLevels() {
    return { connection: NEED_MIN, novelty: NEED_MIN, achievement: NEED_MIN, rest: NEED_MIN };
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
        this.growth = { ...DEFAULT_NEED_GROWTH };
        const custom = options.growthPerHour;
        if (custom !== null && typeof custom === 'object') {
            for (const key of NEED_KEYS) {
                const value = Number(custom[key]);
                if (Number.isFinite(value)) {
                    this.growth[key] = clamp(value, NEED_MIN, NEED_MAX);
                }
            }
        }
        this.updatedAt = this.now();
    }
    get isEnabled() {
        return this.enabled;
    }
    setEnabled(enabled) {
        this.enabled = enabled === true;
        this.levels = emptyLevels();
        /* 停用期间不累积；重新启用也从这一刻的零开始，不拿旧时间一次灌满。 */
        this.updatedAt = this.now();
    }
    /** 时间流逝：按每小时速度回升，封顶 1。 */
    advance(elapsedMs = this.now() - this.updatedAt) {
        if (!this.enabled)
            return;
        if (!Number.isFinite(elapsedMs) || elapsedMs <= 0)
            return;
        const hours = elapsedMs / TIME.HOUR;
        for (const key of NEED_KEYS) {
            this.levels[key] = clamp(this.levels[key] + this.growth[key] * hours, NEED_MIN, NEED_MAX);
        }
        this.updatedAt = this.now();
    }
    /** 某类需求被满足：数值下降，最低 0。未知需求键直接忽略。 */
    satisfy(key, amount = EMOTION.needs.defaultSatisfy) {
        if (!this.enabled)
            return;
        if (!NEED_KEYS.includes(key))
            return;
        if (!Number.isFinite(Number(amount)))
            return;
        this.advance();
        this.levels[key] = clamp(this.levels[key] - clamp(Number(amount), NEED_MIN, NEED_MAX), NEED_MIN, NEED_MAX);
        this.updatedAt = this.now();
    }
    /** 用问卷或偏好初始化，值会被夹到 0..1。 */
    setLevels(partial) {
        if (!this.enabled)
            return;
        if (partial === null || typeof partial !== 'object')
            return;
        for (const key of NEED_KEYS) {
            const value = partial[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                this.levels[key] = clamp(value, NEED_MIN, NEED_MAX);
            }
        }
        this.updatedAt = this.now();
    }
    snapshot() {
        if (!this.enabled) {
            return { levels: emptyLevels(), dominant: null, dominantGap: 0, updatedAt: this.now() };
        }
        this.advance();
        /* 先排序再判领先差：最强的和第二名咬得太近时，不假装有主导需求。 */
        const ranked = [...NEED_KEYS].sort((a, b) => this.levels[b] - this.levels[a]);
        const highest = this.levels[ranked[0]] ?? 0;
        const runnerUp = this.levels[ranked[1]] ?? 0;
        const lead = highest - runnerUp;
        return {
            levels: { ...this.levels },
            dominant: lead >= EMOTION.needs.dominantGap ? ranked[0] : null,
            dominantGap: Math.round(lead * EMOTION.needs.snapshotPrecision) / EMOTION.needs.snapshotPrecision,
            updatedAt: this.updatedAt
        };
    }
}
