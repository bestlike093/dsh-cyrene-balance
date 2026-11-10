import { HybridClock } from '@pet/shared';
import type { AssembleOptions, ContextBundle, IMemoryStore, MemoryRecord, MemorySyncResult, SummaryInput, TokenBudget, Turn } from '@pet/shared';
export type { AssembleOptions, ContextBundle, MemoryKind, MemoryLayer, MemoryRecord, MemoryScope, SummaryInput, TokenBudget, Turn } from '@pet/shared';
export { DEFAULT_TOKEN_BUDGET } from '@pet/shared';
export interface MemoryStoreOptions {
    readonly deviceId: string;
    readonly clock?: HybridClock;
    readonly now?: () => number;
    /** 由 Vault 的 DSK 提供；缺省时 sig 为空串，表示本地未签名 */
    readonly signer?: (payload: string) => Promise<string>;
    readonly summarizer?: (input: SummaryInput) => Promise<string>;
    readonly budget?: Partial<TokenBudget>;
    readonly summaryEveryTurns?: number;
    readonly summaryMaxAgeMs?: number;
    readonly salienceHalfLifeMs?: number;
    readonly salienceFloor?: number;
    readonly maxTurnsPerSession?: number;
}
export declare function estimateTokens(text: string): number;
/**
 * 记忆层核心。
 * 只负责记录、摘要链与装配；摘要文本由注入的 summarizer 生成，
 * 这样 core 不需要直接依赖 dsh，也方便离线测试。
 */
export declare class MemoryStore implements IMemoryStore {
    private readonly records;
    private readonly turnsBySession;
    private readonly lastSummaryAt;
    private readonly deviceId;
    private readonly clock;
    private readonly now;
    private readonly signer?;
    private readonly summarizer?;
    private readonly budget;
    private readonly everyTurns;
    private readonly summaryMaxAge;
    private readonly halfLife;
    private readonly floor;
    private readonly maxTurns;
    constructor(options: MemoryStoreOptions);
    get device(): string;
    append(input: Omit<MemoryRecord, 'id' | 'hash' | 'sig'>): Promise<MemoryRecord>;
    addTurn(sessionId: string, turn: Turn): void;
    turnsOf(sessionId: string): readonly Turn[];
    latestSummary(sessionId: string): MemoryRecord | undefined;
    private summaries;
    /**
     * 到点才压缩：轮数、时间、当前预算三种触发。
     * 摘要失败时保留原 turns，绝不静默丢弃。
     */
    summarize(sessionId: string, force?: boolean): Promise<MemoryRecord | null>;
    tombstone(id: string): Promise<MemoryRecord>;
    private tombstonedIds;
    /** 被后续版本覆盖的旧记录：保留在历史里，但不再进入装配。 */
    private supersededIds;
    /**
     * 修订一条记忆：生成新版本记录，旧版本保留在历史里但不再进入装配。
     * 原记录不被改动，便于回滚、审计与跨端对账。
     */
    revise(id: string, text: string): Promise<MemoryRecord>;
    effectiveSalience(record: MemoryRecord, now?: number): number;
    /** 低于阈值的条目会被移出装配，但仍保留在记录里。 */
    decay(now?: number): Promise<number>;
    assemble(sessionId: string, options?: AssembleOptions): Promise<ContextBundle>;
    /** 只合并 shared 记录；同 id 视为同一条，保留先到的。 */
    merge(remote: readonly MemoryRecord[]): {
        added: number;
        skipped: number;
    };
    syncable(): readonly MemoryRecord[];
    snapshot(): readonly MemoryRecord[];
    /** 摘要链根：对 shared 摘要的 id+hash 做聚合哈希，供跨端对账比较。 */
    chainRoot(): Promise<string>;
    /**
     * S8 才做跨端同步。首版保留类型正确的存根：
     * 调用方会拿到 NOT_IMPLEMENTED，缺口不会因为留空而被藏起来。
     */
    syncWith(peerId: string): Promise<MemorySyncResult>;
}
