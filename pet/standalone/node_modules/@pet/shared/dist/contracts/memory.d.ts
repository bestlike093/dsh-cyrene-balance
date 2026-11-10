/**
 * v2.1 记忆契约（文档第 11 章、附录 A.11）。
 * packages/memory 从这里取类型，不再维护第二份定义。
 */
export type MemoryLayer = 'L1' | 'L2';
export type MemoryKind = 'summary' | 'fact' | 'preference' | 'event' | 'tombstone' | 'revision';
export type MemoryScope = 'shared' | 'local';
export declare const MEMORY_KINDS: readonly MemoryKind[];
export interface Turn {
    readonly role: 'user' | 'assistant';
    readonly content: string;
}
export interface MemoryRecord {
    /** HLC 定长字符串，按字典序即时间序 */
    readonly id: string;
    readonly deviceId: string;
    readonly layer: MemoryLayer;
    readonly kind: MemoryKind;
    readonly text: string;
    /** 单亲为链，双亲为并发合并节点 */
    readonly parentIds: readonly string[];
    readonly sessionId: string;
    readonly salience: number;
    readonly ttlMs?: number;
    readonly scope: MemoryScope;
    /** BLAKE3(canonical(text))；当前实现用 SHA-256，套件切换时随 CS 头变化 */
    readonly hash: string;
    readonly sig: string;
}
export interface TokenBudget {
    readonly persona: number;
    readonly facts: number;
    readonly summary: number;
    readonly recent: number;
    readonly event: number;
}
export declare const DEFAULT_TOKEN_BUDGET: TokenBudget;
export interface ContextBundle {
    readonly persona: string;
    readonly facts: readonly string[];
    readonly summaries: readonly string[];
    readonly recentTurns: readonly Turn[];
    readonly currentEvent: string;
    /** SHA-256(装配后的完整上下文)，随 envelope 发送供审计比对 */
    readonly digest: string;
    readonly tokenEstimate: number;
}
export interface SummaryInput {
    readonly sessionId: string;
    readonly turns: readonly Turn[];
    readonly previous?: string;
    readonly siblings: readonly string[];
}
export interface AssembleOptions {
    readonly persona?: string;
    readonly currentEvent?: string;
    readonly budget?: Partial<TokenBudget>;
}
export interface MemorySyncResult {
    readonly pulled: number;
    readonly merged: number;
}
/**
 * 文档签名的两处落地调整，均已在 docs/V2.1-GAP.md 记录：
 * - assemble 的 budget 并入 options，避免位置参数歧义；
 * - chainRoot 改为异步，WebCrypto 只有 Promise 接口；
 * - tombstone 额外返回墓碑记录，便于调用方与诊断复用。
 */
export interface IMemoryStore {
    append(rec: Omit<MemoryRecord, 'id' | 'hash' | 'sig'>): Promise<MemoryRecord>;
    summarize(sessionId: string, force?: boolean): Promise<MemoryRecord | null>;
    tombstone(id: string): Promise<MemoryRecord>;
    /** 生成新版本，旧版本保留为历史但不参与装配；返回新记录 */
    revise(id: string, text: string): Promise<MemoryRecord>;
    assemble(sessionId: string, options?: AssembleOptions): Promise<ContextBundle>;
    decay(now?: number): Promise<number>;
    syncWith(peerId: string): Promise<MemorySyncResult>;
    chainRoot(): Promise<string>;
}
