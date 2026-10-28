/**
 * v2.1 记忆契约（文档第 11 章、附录 A.11）。
 * packages/memory 从这里取类型，不再维护第二份定义。
 */
export const MEMORY_KINDS = ['summary', 'fact', 'preference', 'event', 'tombstone'];
export const DEFAULT_TOKEN_BUDGET = {
    persona: 300,
    facts: 400,
    summary: 600,
    recent: 800,
    event: 300
};
//# sourceMappingURL=memory.js.map