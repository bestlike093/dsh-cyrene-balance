/**
 * 断言层：关于这个人，什么是真的。
 *
 * 和 `packages/memory` 的分工：
 * - MemoryStore 记「聊过什么」，一条条摘要；
 * - 这里记「她认定的事实」，带出处、可修订、可分档使用。
 *
 * 三个刻意的取舍：
 * 1. 抽取用规则，不用模型。规则召回有限，但不会把玩笑写成人设。
 *    需要更高召回时由调用方传入 `extractor`，模型结果仍要过同一道闸门。
 * 2. 闸门在写入前跑，不在读取时补。脏数据一旦入库，后面每个消费者都要防。
 * 3. 用法（mentionPolicy）跟着断言走，不跟着语气走。
 *    同一件事，可以只在合适的时候轻轻提，也可以永远不提。
 */
export const MENTION_POLICIES = [
    'direct',
    'soft_echo',
    'tone_only',
    'avoid_unless_asked'
];
/* ------------------------------ 闸门 ------------------------------ */
/** 转述他人：主谓是别人，不是用户自己。 */
const QUOTED_OTHER = /(他|她|他们|她们|我朋友|我同事|我同学|我室友|我家人|我妈|我爸|我哥|我姐)\s*(说|讲|觉得|认为|抱怨|吐槽)/;
/** 角色扮演与假设。 */
const ROLEPLAY = /(假如|如果|要是|假设)\s*(我|人家)?\s*(是|变成|成了)|扮演|假装我是/;
/** 临时状态：当天有效，不进长期断言。 */
const TEMPORARY = /(今天|今晚|现在|刚刚|刚才|这两天|最近有点)\S{0,6}(累|困|饿|烦|忙|不舒服|难受)/;
/** 未兑现的打算：进 open loop，不进事实。 */
const UNFULFILLED = /(打算|准备|想要|想学|计划|下次|改天|回头|过几天|以后要)/;
/** 分句用的标点；一句话里既有临时状态又有长期偏好时，要能分开处置。 */
const CLAUSE_SPLIT = /[，,。；;！!？?\n]+/u;
const GATES = [
    { reason: 'quoted_other', pattern: QUOTED_OTHER },
    { reason: 'roleplay', pattern: ROLEPLAY },
    { reason: 'temporary', pattern: TEMPORARY },
    { reason: 'unfulfilled', pattern: UNFULFILLED }
];
function splitClauses(text) {
    return text
        .split(CLAUSE_SPLIT)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}
const EXTRACT_RULES = [
    { attribute: '称呼', multiValued: false, pattern: /(?:我叫|我的名字是|叫我)\s*([^\s，。,.！!？?]{1,12})/, importance: 0.9, mentionPolicy: 'direct', singleValued: true },
    { attribute: '居住地', multiValued: false, pattern: /我(?:住在|家在|目前在)\s*([^\s，。,.！!？?]{1,16})/, importance: 0.8, mentionPolicy: 'soft_echo', singleValued: true },
    { attribute: '职业', multiValued: false, pattern: /我是(?:一名|个)?\s*([^\s，。,.！!？?]{2,10}(?:师|生|员|工|手|编辑|设计|程序员|老师|医生))/, importance: 0.8, mentionPolicy: 'soft_echo', singleValued: true },
    { attribute: '生日', multiValued: false, pattern: /我(?:的)?生日(?:是)?\s*([0-9]{1,2}\s*月\s*[0-9]{1,2}\s*[日号])/, importance: 0.95, mentionPolicy: 'direct', singleValued: true },
    { attribute: '喜欢', multiValued: true, pattern: /我(?:还是|也|很|最|特别|真的)*喜欢\s*([^\s，。,.！!？?]{1,18})/, importance: 0.65, mentionPolicy: 'soft_echo' },
    { attribute: '讨厌', multiValued: true, pattern: /我(?:还是|也|很|最|特别|真的)*(?:讨厌|不喜欢|受不了)\s*([^\s，。,.！!？?]{1,18})/, importance: 0.7, mentionPolicy: 'avoid_unless_asked' },
    { attribute: '习惯', multiValued: true, pattern: /我(?:通常|一般|习惯|总是)\s*([^\s，。,.！!？?]{1,24})/, importance: 0.6, mentionPolicy: 'tone_only' },
    { attribute: '在意', multiValued: true, pattern: /我(?:很|有点)?在意\s*([^\s，。,.！!？?]{1,18})/, importance: 0.7, mentionPolicy: 'avoid_unless_asked' }
];
function normalizeValue(raw) {
    return raw.trim().replace(/[，。,.！!？?、；;：:]+$/u, '');
}
function looksLikeOtherPerson(value) {
    return /^(他|她|他们|她们|别人|大家)/.test(value);
}
export const DEFAULT_ASSERTION_MIN_CONFIDENCE = 0.55;
/**
 * 从一段用户发言里抽候选断言。
 *
 * 闸门按子句判定：同一句话里「我住在重庆，最近有点累」只丢后半句，
 * 前半句照样能记下来。整段一刀切会让真实的偏好被一句临时状态连坐，
 * 长期下来记性会越来越差。
 *
 * 转述、假设、未兑现的打算仍然只在命中那一句里生效，不影响同段的其他自述。
 */
export function extractAssertions(text, options = {}) {
    const rejected = [];
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return { candidates: [], rejected: [{ text, reason: 'empty' }] };
    }
    // 命中的子句整句丢弃，未命中的子句继续参与抽取。
    const kept = [];
    for (const clause of splitClauses(trimmed)) {
        const gate = GATES.find((item) => item.pattern.test(clause));
        if (gate !== undefined) {
            rejected.push({ text: clause, reason: gate.reason });
            continue;
        }
        kept.push(clause);
    }
    const minConfidence = options.minConfidence ?? DEFAULT_ASSERTION_MIN_CONFIDENCE;
    const candidates = [];
    const seen = new Set();
    for (const clause of kept) {
        for (const rule of EXTRACT_RULES) {
            const match = rule.pattern.exec(clause);
            const raw = match?.[1];
            if (raw === undefined)
                continue;
            const value = normalizeValue(raw);
            if (value.length === 0 || looksLikeOtherPerson(value))
                continue;
            const key = `${rule.attribute}:${value}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            candidates.push({
                subject: 'user',
                attribute: rule.attribute,
                value,
                multiValued: rule.multiValued,
                evidence: clause,
                confidence: 0.75,
                importance: rule.importance,
                mentionPolicy: rule.mentionPolicy,
                decayMode: rule.attribute === '讨厌' || rule.attribute === '在意' ? 'scar' : 'normal'
            });
        }
    }
    if (options.extractor !== undefined) {
        for (const extra of options.extractor(trimmed)) {
            if (extra.evidence.trim().length === 0)
                continue;
            const key = `${extra.attribute}:${extra.value}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            candidates.push(extra);
        }
    }
    const accepted = candidates.filter((candidate) => candidate.confidence >= minConfidence);
    for (const dropped of candidates) {
        if (dropped.confidence < minConfidence) {
            rejected.push({ text: `${dropped.attribute}=${dropped.value}`, reason: 'low_confidence' });
        }
    }
    return { candidates: accepted, rejected };
}
const DEFAULT_NORMAL_HALF_LIFE = 45 * 24 * 60 * 60_000;
const DEFAULT_SLOW_HALF_LIFE = 180 * 24 * 60 * 60_000;
const DEFAULT_FLOOR = 0.05;
/** 粗排最多保留的候选数；再多也不会进精排，避免长跑后记忆库变大拖慢每轮对话。 */
const MAX_RECALL_CANDIDATES = 200;
/**
 * 高频但几乎不携带信息的词。它们拆成 bigram 后从 token 里剔掉，
 * 否则「我们今天」「那个事情」这类句子会和几乎所有记忆都产生弱相关。
 */
const STOP_WORDS = [
    '我们', '你们', '他们', '她们', '这个', '那个', '这些', '那些', '就是', '然后',
    '因为', '所以', '但是', '如果', '可以', '什么', '怎么', '一下', '现在', '今天',
    '明天', '昨天', '已经', '还是', '不是', '没有', '一个', '这样', '那样', '知道',
    '觉得', '真的', '其实', '应该', '可能', '自己', '时候', '东西', '事情', '感觉',
    '有点', '一直', '开始', '结束', '关于', '对于', '而且', '或者', '不过'
];
const STOP_BIGRAMS = new Set();
for (const word of STOP_WORDS) {
    for (let index = 0; index + 1 < word.length; index += 1) {
        STOP_BIGRAMS.add(word.slice(index, index + 2));
    }
}
function bigrams(text) {
    const clean = text.replace(/[\s，。,.！!？?、；;：:（）()【】"']/gu, '');
    const out = new Set();
    for (let index = 0; index + 1 < clean.length; index += 1) {
        const token = clean.slice(index, index + 2);
        if (!STOP_BIGRAMS.has(token))
            out.add(token);
    }
    if (clean.length === 1 && !STOP_BIGRAMS.has(clean))
        out.add(clean);
    return out;
}
function isAssertion(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return (typeof record['id'] === 'string' &&
        typeof record['attribute'] === 'string' &&
        typeof record['value'] === 'string' &&
        Array.isArray(record['evidence']) &&
        typeof record['createdAt'] === 'number');
}
/**
 * 断言库。
 *
 * 所有写入都会跑一遍冲突处理：
 * - 单值属性出现新值 → 旧断言被 supersede，但记录保留；
 * - 多值属性出现同值 → 只累积证据，不新增条目；
 * - 多值属性出现不同值 → 各自独立，绝不互相取代。
 */
export class AssertionStore {
    items = new Map();
    superseded = new Set();
    sequence = 0;
    now;
    normalHalfLife;
    slowHalfLife;
    floor;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.normalHalfLife = options.normalHalfLifeMs ?? DEFAULT_NORMAL_HALF_LIFE;
        this.slowHalfLife = options.slowHalfLifeMs ?? DEFAULT_SLOW_HALF_LIFE;
        this.floor = options.floor ?? DEFAULT_FLOOR;
    }
    toJSON() {
        return {
            version: 1,
            sequence: this.sequence,
            items: this.all(),
            superseded: [...this.superseded]
        };
    }
    /** 坏条目逐条丢弃，不因为一条脏数据让整库读不出来。 */
    static fromJSON(raw, options = {}) {
        const store = new AssertionStore(options);
        if (typeof raw !== 'object' || raw === null)
            return store;
        const record = raw;
        const items = Array.isArray(record['items']) ? record['items'] : [];
        for (const item of items) {
            if (isAssertion(item))
                store.items.set(item.id, item);
        }
        const superseded = Array.isArray(record['superseded']) ? record['superseded'] : [];
        for (const id of superseded) {
            if (typeof id === 'string')
                store.superseded.add(id);
        }
        const sequence = record['sequence'];
        store.sequence = typeof sequence === 'number' && Number.isFinite(sequence) ? sequence : store.items.size;
        return store;
    }
    get size() {
        return this.items.size;
    }
    all() {
        return [...this.items.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    }
    /** 只返回仍生效的断言；被替代的旧值不在这里。 */
    live() {
        return this.all().filter((item) => !this.superseded.has(item.id));
    }
    ingest(text, options = {}) {
        const { candidates } = extractAssertions(text, options);
        return candidates.map((candidate) => this.add(candidate));
    }
    add(candidate, now = this.now()) {
        if (candidate.evidence.trim().length === 0) {
            throw new Error('断言必须有出处：evidence 不能为空');
        }
        if (!candidate.multiValued) {
            for (const existing of this.live()) {
                if (existing.attribute === candidate.attribute && existing.subject === candidate.subject) {
                    this.superseded.add(existing.id);
                }
            }
        }
        else {
            for (const existing of this.live()) {
                if (existing.attribute === candidate.attribute &&
                    existing.subject === candidate.subject &&
                    existing.value === candidate.value) {
                    this.items.set(existing.id, {
                        ...existing,
                        evidence: [...existing.evidence, candidate.evidence].slice(-8),
                        confidence: Math.min(1, existing.confidence + 0.05),
                        lastTouchedAt: now
                    });
                    return this.items.get(existing.id);
                }
            }
        }
        this.sequence += 1;
        const record = {
            id: `as-${String(this.sequence).padStart(5, '0')}`,
            subject: candidate.subject,
            attribute: candidate.attribute,
            value: candidate.value,
            multiValued: candidate.multiValued,
            evidence: [candidate.evidence],
            confidence: candidate.confidence,
            importance: candidate.importance ?? 0.5,
            mentionPolicy: candidate.mentionPolicy ?? 'soft_echo',
            decayMode: candidate.decayMode ?? 'normal',
            createdAt: now,
            lastTouchedAt: now,
            mentionCount: 0,
            corrections: 0
        };
        this.items.set(record.id, record);
        return record;
    }
    /** 用户改口：旧值保留，新值接管；与「被替代」不同，这里会留下链。 */
    revise(id, value, evidence, now = this.now()) {
        const target = this.items.get(id);
        if (target === undefined)
            throw new Error(`断言不存在：${id}`);
        this.superseded.add(id);
        const next = this.add({
            subject: target.subject,
            attribute: target.attribute,
            value,
            multiValued: target.multiValued,
            evidence,
            confidence: target.confidence,
            importance: target.importance,
            mentionPolicy: target.mentionPolicy,
            decayMode: target.decayMode
        }, now);
        this.items.set(next.id, { ...next, supersedes: id });
        return this.items.get(next.id);
    }
    /** 有效强度：按衰减模式折算，远期事实会自己退到背景里。 */
    strength(item, now = this.now()) {
        if (item.decayMode === 'no_decay')
            return 1;
        const age = Math.max(0, now - item.createdAt);
        if (item.decayMode === 'scar')
            return 0.6 + 0.4 * 0.5 ** (age / (this.slowHalfLife * 4));
        const halfLife = item.decayMode === 'slow' ? this.slowHalfLife : this.normalHalfLife;
        return item.importance * 0.4 + 0.6 * 0.5 ** (age / halfLife);
    }
    expired(now = this.now()) {
        return this.live().filter((item) => this.strength(item, now) < this.floor);
    }
    /**
     * 按当前这句话召回。
     *
     * 排序权重：相关 0.5、重要 0.25、新鲜 0.15、置信 0.1。
     * `avoid_unless_asked` 默认不出现；tone_only 会出现，但调用方只能拿它调语气。
     */
    recall(query, options = {}) {
        const now = options.now ?? this.now();
        const allow = new Set(options.allowPolicies ?? ['direct', 'soft_echo', 'tone_only']);
        const queryTokens = bigrams(query);
        // 先按「重要 + 新鲜 + 置信」粗排，只让前 200 条进入相关性精排。
        // 记忆库长跑后条目会越积越多，全量算 bigram 交集没有必要。
        const pool = [];
        for (const item of this.live()) {
            if (!allow.has(item.mentionPolicy))
                continue;
            if (options.subject !== undefined && item.subject !== options.subject)
                continue;
            const age = Math.max(0, now - item.createdAt);
            const freshness = 0.5 ** (age / this.normalHalfLife);
            const base = 0.25 * item.importance * this.strength(item, now) +
                0.15 * freshness +
                0.1 * item.confidence;
            pool.push({ item, base });
        }
        pool.sort((a, b) => b.base - a.base);
        const candidates = pool.slice(0, MAX_RECALL_CANDIDATES);
        // IDF：越少条目共有的 token 权重越高。否则「今天」「我们」这类词
        // 会把所有记忆的相关性一起抬高，最后排出来的还是重要度。
        const targets = candidates.map(({ item }) => bigrams(`${item.attribute}${item.value}${item.evidence.join('')}`));
        const docFreq = new Map();
        for (const target of targets) {
            for (const token of queryTokens) {
                if (target.has(token))
                    docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
            }
        }
        const tokenWeight = new Map();
        let totalWeight = 0;
        for (const token of queryTokens) {
            const df = docFreq.get(token) ?? 0;
            const weight = Math.log(1 + (candidates.length + 1) / (df + 1));
            tokenWeight.set(token, weight);
            totalWeight += weight;
        }
        const scored = [];
        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            const target = targets[index];
            if (candidate === undefined || target === undefined)
                continue;
            const { item, base } = candidate;
            let hitWeight = 0;
            for (const token of queryTokens) {
                if (!target.has(token))
                    continue;
                hitWeight += tokenWeight.get(token) ?? 0;
            }
            const relevance = totalWeight === 0 ? 0 : hitWeight / totalWeight;
            scored.push({ assertion: item, score: 0.5 * relevance + base });
        }
        scored.sort((a, b) => b.score - a.score);
        const limit = options.limit ?? 6;
        return scored.slice(0, limit);
    }
    /**
     * 被自然提及之后的反馈。
     *
     * 一次纠正就够：用户说「不是这样」，这条以后就不再主动提，
     * 不需要再问一遍确认，也不需要模型重新判断。
     */
    feedback(id, reaction, now = this.now()) {
        const target = this.items.get(id);
        if (target === undefined)
            throw new Error(`断言不存在：${id}`);
        let next;
        switch (reaction) {
            case 'accepted':
                next = {
                    ...target,
                    confidence: Math.min(1, target.confidence + 0.08),
                    importance: Math.min(1, target.importance + 0.05),
                    mentionCount: target.mentionCount + 1,
                    lastTouchedAt: now
                };
                break;
            case 'comforted':
                next = {
                    ...target,
                    importance: Math.min(1, target.importance + 0.08),
                    mentionPolicy: target.mentionPolicy === 'direct' ? 'soft_echo' : target.mentionPolicy,
                    mentionCount: target.mentionCount + 1,
                    lastTouchedAt: now
                };
                break;
            case 'corrected':
                next = {
                    ...target,
                    confidence: Math.max(0, target.confidence - 0.3),
                    mentionPolicy: 'avoid_unless_asked',
                    corrections: target.corrections + 1,
                    lastTouchedAt: now
                };
                break;
            case 'awkward':
                next = {
                    ...target,
                    mentionPolicy: 'tone_only',
                    corrections: target.corrections + 1,
                    lastTouchedAt: now
                };
                break;
            case 'ignored':
                next = { ...target, mentionCount: target.mentionCount + 1, lastTouchedAt: now };
                break;
        }
        this.items.set(id, next);
        return next;
    }
    /** 供提示词分组的纯文本；只输出可以直接说的话，不输出内部字段。 */
    render(items) {
        const direct = items.filter((item) => item.assertion.mentionPolicy === 'direct');
        const soft = items.filter((item) => item.assertion.mentionPolicy === 'soft_echo');
        const tone = items.filter((item) => item.assertion.mentionPolicy === 'tone_only');
        const lines = [];
        if (direct.length > 0) {
            lines.push(`可以直接说起的：${direct.map((item) => `${item.assertion.attribute}=${item.assertion.value}`).join('；')}`);
        }
        if (soft.length > 0) {
            lines.push(`可以轻轻带一句、不要复述的：${soft.map((item) => item.assertion.value).join('；')}`);
        }
        if (tone.length > 0) {
            lines.push(`只用来把握分寸、不要提起的：${tone.map((item) => item.assertion.attribute).join('；')}`);
        }
        return lines.join('\n');
    }
}
