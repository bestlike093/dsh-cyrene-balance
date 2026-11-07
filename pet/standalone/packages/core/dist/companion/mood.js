/**
 * 三维心情底色（valence / arousal / tension）。
 *
 * 和 `emotion/localEmotion.ts` 的分工：
 * - 那边是「这句话让她的表情瞬间变一下」，TTL 30 秒，逐句判定；
 * - 这里是「这一阵她心里是什么天气」，按小时回归，跨会话保留。
 *
 * 心情只作为输入送进提示词和表情选择，不直接生成台词。
 * 任何时刻都不允许把数值写进给用户看的话里——喜欢的是感觉，不是读数。
 */
/** 单次事件在强度 1.0 时的位移。实际位移按 intensity 线性缩放。 */
export const MOOD_EFFECTS = {
    praised: { valence: 0.22, arousal: 0.12, tension: -0.08 },
    cared: { valence: 0.18, arousal: 0.04, tension: -0.12 },
    apologized: { valence: 0.1, arousal: -0.04, tension: -0.15 },
    conflict: { valence: -0.32, arousal: 0.18, tension: 0.42 },
    ignored: { valence: -0.12, arousal: -0.06, tension: 0.12 },
    greeted: { valence: 0.12, arousal: 0.08, tension: -0.05 },
    user_tired: { valence: -0.04, arousal: -0.1, tension: 0.06 },
    user_happy: { valence: 0.14, arousal: 0.1, tension: -0.04 },
    playful: { valence: 0.16, arousal: 0.16, tension: -0.06 },
    late_night: { valence: -0.05, arousal: -0.18, tension: 0.04 }
};
/** 基线：略微偏正、偏安静。她要有一个自己的常态，而不是每次从零开始。 */
export const MOOD_BASELINE = { valence: 0.05, arousal: 0.35, tension: 0.15 };
export const DEFAULT_MOOD_HALF_LIFE_MS = 40 * 60_000;
function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
}
function clampState(state) {
    return {
        valence: clamp(state.valence, -1, 1),
        arousal: clamp(state.arousal, 0, 1),
        tension: clamp(state.tension, 0, 1)
    };
}
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
const SIGNAL_RULES = [
    { kind: 'praised', pattern: /可爱|好棒|厉害|喜欢你|真好|谢谢你/, intensity: 0.8 },
    { kind: 'cared', pattern: /早点睡|别熬夜|注意身体|吃药|多喝水|辛苦了/, intensity: 0.75 },
    { kind: 'apologized', pattern: /对不起|抱歉|不好意思|是我不好/, intensity: 0.7 },
    { kind: 'conflict', pattern: /烦死|别说了|闭嘴|滚|讨厌你|不想理你/, intensity: 0.85 },
    { kind: 'user_tired', pattern: /好累|累了|困了|撑不住|加班|没睡好/, intensity: 0.7 },
    { kind: 'user_happy', pattern: /太好了|开心|顺利|通过了|成功了|赢了/, intensity: 0.75 },
    { kind: 'playful', pattern: /哈哈|嘿嘿|笑死|好玩|逗你/, intensity: 0.6 },
    { kind: 'greeted', pattern: /早安|早上好|晚上好|我回来了|在吗/, intensity: 0.5 }
];
export function detectMoodSignals(text) {
    const signals = [];
    for (const rule of SIGNAL_RULES) {
        if (rule.pattern.test(text))
            signals.push({ kind: rule.kind, intensity: rule.intensity });
    }
    return signals;
}
/**
 * 心情状态机。
 *
 * 三条硬约束：
 * 1. 回归永远朝基线走，不会因为长时间没说话就飘到极端；
 * 2. 单次事件位移有上限，避免一句话把底色掀翻；
 * 3. `updatedAt` 一定前进，重复 tick 不会重复衰减。
 */
export class MoodEngine {
    now;
    baseline;
    halfLife;
    state;
    updatedAt;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.baseline = clampState(options.baseline ?? MOOD_BASELINE);
        this.halfLife = options.halfLifeMs ?? DEFAULT_MOOD_HALF_LIFE_MS;
        this.state = clampState(options.initial ?? this.baseline);
        this.updatedAt = this.now();
    }
    /** 先把这段时间的回归结算掉，再返回快照。读取本身也算一次前进。 */
    snapshot() {
        this.settle(this.now());
        return { ...this.state, updatedAt: this.updatedAt };
    }
    get current() {
        return this.snapshot();
    }
    settle(now) {
        const elapsed = now - this.updatedAt;
        if (elapsed <= 0)
            return;
        if (this.halfLife <= 0) {
            this.state = this.baseline;
            this.updatedAt = now;
            return;
        }
        const keep = 0.5 ** (elapsed / this.halfLife);
        this.state = clampState({
            valence: this.baseline.valence + (this.state.valence - this.baseline.valence) * keep,
            arousal: this.baseline.arousal + (this.state.arousal - this.baseline.arousal) * keep,
            tension: this.baseline.tension + (this.state.tension - this.baseline.tension) * keep
        });
        this.updatedAt = now;
    }
    apply(kind, intensity = 1) {
        const effect = MOOD_EFFECTS[kind];
        const weight = clamp(intensity, 0, 1);
        const now = this.now();
        this.settle(now);
        this.state = clampState({
            valence: this.state.valence + effect.valence * weight,
            arousal: this.state.arousal + effect.arousal * weight,
            tension: this.state.tension + effect.tension * weight
        });
        this.updatedAt = now;
        return { ...this.state, updatedAt: this.updatedAt };
    }
    applySignals(signals) {
        for (const signal of signals)
            this.apply(signal.kind, signal.intensity);
        return this.snapshot();
    }
    applyText(text) {
        return this.applySignals(detectMoodSignals(text));
    }
    /**
     * 映射到现有词表。
     *
     * 顺序有意义：张力高优先于一切，其次看唤醒度和愉快度的组合。
     * 边界值取「更保守的那一侧」，避免平静被读成兴奋。
     */
    toEmotionTag(state = this.current) {
        const { valence, arousal, tension } = state;
        if (tension >= 0.55 && valence < 0)
            return 'angry';
        if (tension >= 0.5 && valence >= 0)
            return 'thinking';
        if (valence <= -0.35)
            return arousal >= 0.55 ? 'surprised' : 'sad';
        if (valence >= 0.45) {
            if (arousal >= 0.7)
                return 'excited';
            if (tension <= 0.2 && arousal <= 0.45)
                return 'gentle';
            return 'happy';
        }
        if (arousal <= 0.18)
            return 'tired';
        if (valence >= 0.2 && tension <= 0.25)
            return 'shy';
        return 'neutral';
    }
    /** 供提示词使用的一句话描述；不含任何数值。 */
    describe(state = this.current) {
        const { valence, arousal, tension } = state;
        const mood = valence >= 0.35 ? '心情不错' : valence <= -0.25 ? '有点低落' : '心情平常';
        const energy = arousal >= 0.65 ? '精神很足' : arousal <= 0.25 ? '有点没力气' : '状态一般';
        const edge = tension >= 0.55 ? '心里绷着一根弦' : tension <= 0.2 ? '很放松' : '';
        return edge.length > 0 ? `${mood}，${energy}，${edge}` : `${mood}，${energy}`;
    }
    toJSON() {
        const snapshot = this.snapshot();
        return { version: 1, ...snapshot };
    }
    /** 反序列化时任何字段不合法都退回基线，并保留 updatedAt 以便继续回归。 */
    static fromJSON(raw, options = {}) {
        const baseline = clampState(options.baseline ?? MOOD_BASELINE);
        const now = options.now?.() ?? Date.now();
        if (typeof raw !== 'object' || raw === null) {
            return new MoodEngine({ ...options, baseline, initial: baseline });
        }
        const record = raw;
        const initial = {
            valence: isFiniteNumber(record['valence']) ? clamp(record['valence'], -1, 1) : baseline.valence,
            arousal: isFiniteNumber(record['arousal']) ? clamp(record['arousal'], 0, 1) : baseline.arousal,
            tension: isFiniteNumber(record['tension']) ? clamp(record['tension'], 0, 1) : baseline.tension
        };
        const engine = new MoodEngine({ ...options, baseline, initial });
        const stamp = record['updatedAt'];
        if (isFiniteNumber(stamp) && stamp <= now) {
            // 恢复时把时间戳拨回存盘那一刻，让离线期间的回归照样生效。
            ;
            engine.updatedAt = stamp;
        }
        return engine;
    }
}
