/**
 * 本地情绪规则：外呼 LLM 的降级路径。
 *
 * 输入只有原始文本，不依赖任何 LLM 返回结构。规则表可枚举导出，
 * 命中结果带 matchedRule / confidence / producedAt，便于诊断追溯。
 *
 * 情绪只是输入：这里不接触 DialogueQueue，也不产生任何台词。
 */
export const LOCAL_EMOTION_RULES = [
    {
        id: 'gratitude',
        emotion: 'happy',
        confidence: 0.85,
        pattern: /谢谢|感谢|太好了|真好/,
        description: '感谢与肯定'
    },
    {
        id: 'greeting',
        emotion: 'happy',
        confidence: 0.8,
        pattern: /你好|嗨|早上好|晚上好|在吗/,
        description: '日常问候'
    },
    {
        id: 'praise',
        emotion: 'shy',
        confidence: 0.75,
        pattern: /可爱|好棒|厉害|喜欢你/,
        description: '被夸奖'
    },
    {
        id: 'anger',
        emotion: 'angry',
        confidence: 0.8,
        pattern: /生气|讨厌|烦死|气死|滚开/,
        description: '愤怒'
    },
    {
        id: 'sadness',
        emotion: 'sad',
        confidence: 0.8,
        pattern: /难过|想哭|伤心|失落|不开心/,
        description: '难过'
    },
    {
        id: 'fatigue',
        emotion: 'tired',
        confidence: 0.8,
        pattern: /好累|累了|困了|撑不住|疲惫/,
        description: '疲惫'
    },
    {
        id: 'surprise',
        emotion: 'surprised',
        confidence: 0.75,
        pattern: /真的吗|不会吧|天哪|居然|竟然/,
        description: '惊讶'
    },
    {
        id: 'question',
        emotion: 'thinking',
        confidence: 0.7,
        pattern: /[?？]|怎么|为什么|怎么办/,
        description: '疑问'
    },
    {
        id: 'excitement',
        emotion: 'excited',
        confidence: 0.75,
        pattern: /太棒了|好耶|期待|开心/,
        description: '兴奋'
    }
];
export const DEFAULT_EMOTION_TTL_MS = 30_000;
export const DEFAULT_MIN_CONFIDENCE = 0.5;
/** neutral 是合法结果，置信度为 0，不带规则命中。 */
export function neutralEmotion(now) {
    return {
        emotion: 'neutral',
        confidence: 0,
        matchedRule: null,
        producedAt: now,
        source: 'local'
    };
}
/** TTL 从 producedAt 起算，不看读取时刻。 */
export function isEmotionExpired(snapshot, now, ttlMs = DEFAULT_EMOTION_TTL_MS) {
    return now - snapshot.producedAt > ttlMs;
}
/**
 * 纯函数：一段文本跑一遍本地规则。
 *
 * 规则按顺序匹配，第一条命中且置信度达标的胜出；都不达标返回 neutral。
 */
export function analyzeLocalEmotion(text, options = {}) {
    const now = options.now?.() ?? Date.now();
    const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const rules = options.rules ?? LOCAL_EMOTION_RULES;
    for (const rule of rules) {
        if (!rule.pattern.test(text))
            continue;
        if (rule.confidence < minConfidence)
            continue;
        return {
            emotion: rule.emotion,
            confidence: rule.confidence,
            matchedRule: rule.id,
            producedAt: now,
            source: 'local'
        };
    }
    return neutralEmotion(now);
}
/**
 * 带 TTL 的本地情绪状态。
 *
 * `current()` 过期时直接返回 neutral，绝不回退到上一次的值——
 * 旧值看起来完全合法，诊断上很难发现它已经过期。
 */
export class LocalEmotionEngine {
    now;
    ttlMs;
    minConfidence;
    ruleTable;
    last;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.ttlMs = options.ttlMs ?? DEFAULT_EMOTION_TTL_MS;
        this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
        this.ruleTable = options.rules ?? LOCAL_EMOTION_RULES;
    }
    /** 供诊断面板枚举；matchedRule 一定能在这里找到。 */
    get rules() {
        return this.ruleTable;
    }
    analyze(text) {
        const snapshot = analyzeLocalEmotion(text, {
            now: this.now,
            minConfidence: this.minConfidence,
            rules: this.ruleTable
        });
        this.last = snapshot;
        return snapshot;
    }
    current() {
        const now = this.now();
        if (this.last === undefined)
            return neutralEmotion(now);
        if (isEmotionExpired(this.last, now, this.ttlMs))
            return neutralEmotion(now);
        return this.last;
    }
}
