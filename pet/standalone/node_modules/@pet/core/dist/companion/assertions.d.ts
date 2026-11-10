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
export type MentionPolicy = 'direct' | 'soft_echo' | 'tone_only' | 'avoid_unless_asked';
export declare const MENTION_POLICIES: readonly MentionPolicy[];
export type AssertionSubject = 'user' | 'self';
/** normal 会随时间变淡；no_decay 永不变淡；slow 半衰期更长；scar 极慢且只在被问起时出现。 */
export type DecayMode = 'normal' | 'no_decay' | 'slow' | 'scar';
export interface Assertion {
    readonly id: string;
    readonly subject: AssertionSubject;
    readonly attribute: string;
    readonly value: string;
    readonly multiValued: boolean;
    /** 原始消息片段，至少一条。空证据的断言不允许入库。 */
    readonly evidence: readonly string[];
    readonly confidence: number;
    readonly importance: number;
    readonly mentionPolicy: MentionPolicy;
    readonly decayMode: DecayMode;
    readonly createdAt: number;
    readonly lastTouchedAt: number;
    /** 单值属性改口时指向被替代的旧断言；旧值保留，供「你以前不是……」使用 */
    readonly supersedes?: string;
    readonly mentionCount: number;
    readonly corrections: number;
}
export interface AssertionCandidate {
    readonly subject: AssertionSubject;
    readonly attribute: string;
    readonly value: string;
    readonly multiValued: boolean;
    readonly evidence: string;
    readonly confidence: number;
    readonly importance?: number;
    readonly mentionPolicy?: MentionPolicy;
    readonly decayMode?: DecayMode;
}
export type RejectReason = 'empty' | 'quoted_other' | 'roleplay' | 'temporary' | 'unfulfilled' | 'no_evidence' | 'low_confidence';
export interface Extracted {
    readonly candidates: readonly AssertionCandidate[];
    readonly rejected: readonly {
        readonly text: string;
        readonly reason: RejectReason;
    }[];
}
export interface ExtractOptions {
    /** 外部抽取器（通常是模型）；返回的候选仍要过闸门。 */
    readonly extractor?: (text: string) => readonly AssertionCandidate[];
    readonly minConfidence?: number;
}
export declare const DEFAULT_ASSERTION_MIN_CONFIDENCE = 0.55;
/**
 * 从一段用户发言里抽候选断言。
 *
 * 闸门按子句判定：同一句话里「我住在重庆，最近有点累」只丢后半句，
 * 前半句照样能记下来。整段一刀切会让真实的偏好被一句临时状态连坐，
 * 长期下来记性会越来越差。
 *
 * 转述、假设、未兑现的打算仍然只在命中那一句里生效，不影响同段的其他自述。
 */
export declare function extractAssertions(text: string, options?: ExtractOptions): Extracted;
export interface RecallOptions {
    /** 允许出现的档位；默认排除 avoid_unless_asked。 */
    readonly allowPolicies?: readonly MentionPolicy[];
    readonly limit?: number;
    readonly now?: number;
    readonly subject?: AssertionSubject;
}
export interface ScoredAssertion {
    readonly assertion: Assertion;
    readonly score: number;
}
export type MentionReaction = 'accepted' | 'comforted' | 'awkward' | 'corrected' | 'ignored';
export interface AssertionStoreOptions {
    readonly now?: () => number;
    readonly normalHalfLifeMs?: number;
    readonly slowHalfLifeMs?: number;
    readonly floor?: number;
}
export interface AssertionStoreSnapshot {
    readonly version: 1;
    readonly sequence: number;
    readonly items: readonly Assertion[];
    readonly superseded: readonly string[];
}
/**
 * 断言库。
 *
 * 所有写入都会跑一遍冲突处理：
 * - 单值属性出现新值 → 旧断言被 supersede，但记录保留；
 * - 多值属性出现同值 → 只累积证据，不新增条目；
 * - 多值属性出现不同值 → 各自独立，绝不互相取代。
 */
export declare class AssertionStore {
    private readonly items;
    private readonly superseded;
    private sequence;
    private readonly now;
    private readonly normalHalfLife;
    private readonly slowHalfLife;
    private readonly floor;
    constructor(options?: AssertionStoreOptions);
    toJSON(): AssertionStoreSnapshot;
    /** 坏条目逐条丢弃，不因为一条脏数据让整库读不出来。 */
    static fromJSON(raw: unknown, options?: AssertionStoreOptions): AssertionStore;
    get size(): number;
    all(): readonly Assertion[];
    /** 只返回仍生效的断言；被替代的旧值不在这里。 */
    live(): readonly Assertion[];
    ingest(text: string, options?: ExtractOptions): readonly Assertion[];
    add(candidate: AssertionCandidate, now?: number): Assertion;
    /** 用户改口：旧值保留，新值接管；与「被替代」不同，这里会留下链。 */
    revise(id: string, value: string, evidence: string, now?: number): Assertion;
    /** 有效强度：按衰减模式折算，远期事实会自己退到背景里。 */
    strength(item: Assertion, now?: number): number;
    expired(now?: number): readonly Assertion[];
    /**
     * 按当前这句话召回。
     *
     * 排序权重：相关 0.5、重要 0.25、新鲜 0.15、置信 0.1。
     * `avoid_unless_asked` 默认不出现；tone_only 会出现，但调用方只能拿它调语气。
     */
    recall(query: string, options?: RecallOptions): readonly ScoredAssertion[];
    /**
     * 被自然提及之后的反馈。
     *
     * 一次纠正就够：用户说「不是这样」，这条以后就不再主动提，
     * 不需要再问一遍确认，也不需要模型重新判断。
     */
    feedback(id: string, reaction: MentionReaction, now?: number): Assertion;
    /** 供提示词分组的纯文本；只输出可以直接说的话，不输出内部字段。 */
    render(items: readonly ScoredAssertion[]): string;
}
