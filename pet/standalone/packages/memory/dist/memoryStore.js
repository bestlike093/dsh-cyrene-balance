import { DEFAULT_TOKEN_BUDGET, ErrorCode, HybridClock, PetError, parseHlc } from '@pet/shared';
export { DEFAULT_TOKEN_BUDGET } from '@pet/shared';
const DEFAULT_EVERY_TURNS = 8;
const DEFAULT_SUMMARY_MAX_AGE = 30 * 60_000;
const DEFAULT_HALF_LIFE = 14 * 24 * 60 * 60_000;
const DEFAULT_FLOOR = 0.1;
const DEFAULT_MAX_TURNS = 200;
function canonical(input) {
    return JSON.stringify([
        input.deviceId,
        input.layer,
        input.kind,
        input.text,
        input.parentIds,
        input.sessionId,
        input.salience,
        input.ttlMs ?? null,
        input.scope
    ]);
}
async function sha256(text) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) {
        throw new PetError(ErrorCode.CRYPTO_SUITE_UNSUPPORTED, '当前运行时没有 WebCrypto，无法计算记忆哈希');
    }
    const bytes = new TextEncoder().encode(text);
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** CJK 字符按 1 字符 ≈ 1 token，ASCII 按 4 字符 ≈ 1 token，取保守值。 */
function isWideCodePoint(code) {
    return ((code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xac00 && code <= 0xd7af) ||
        (code >= 0x20000 && code <= 0x2fa1f));
}
export function estimateTokens(text) {
    let wide = 0;
    let narrow = 0;
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (isWideCodePoint(code))
            wide += 1;
        else
            narrow += 1;
    }
    return Math.ceil(wide + narrow / 4);
}
function takeByBudget(items, budget) {
    const picked = [];
    let used = 0;
    for (const item of items) {
        const cost = estimateTokens(item);
        if (used + cost > budget)
            break;
        picked.push(item);
        used += cost;
    }
    return picked;
}
/** 从最新往回装，预算不够时丢最旧的，返回仍按旧→新排序。 */
function takeRecent(turns, budget) {
    const picked = [];
    let used = 0;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        const turn = turns[index];
        if (turn === undefined)
            continue;
        const cost = estimateTokens(turn.content) + 2;
        if (used + cost > budget)
            break;
        picked.push(turn);
        used += cost;
    }
    return picked.reverse();
}
/**
 * 记忆层核心。
 * 只负责记录、摘要链与装配；摘要文本由注入的 summarizer 生成，
 * 这样 core 不需要直接依赖 dsh，也方便离线测试。
 */
export class MemoryStore {
    records = new Map();
    turnsBySession = new Map();
    lastSummaryAt = new Map();
    deviceId;
    clock;
    now;
    signer;
    summarizer;
    budget;
    everyTurns;
    summaryMaxAge;
    halfLife;
    floor;
    maxTurns;
    constructor(options) {
        if (typeof options.deviceId !== 'string' || options.deviceId.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, 'deviceId 不能为空');
        }
        this.deviceId = options.deviceId;
        this.clock = options.clock ?? new HybridClock(options.deviceId);
        this.now = options.now ?? Date.now;
        this.signer = options.signer;
        this.summarizer = options.summarizer;
        this.budget = { ...DEFAULT_TOKEN_BUDGET, ...options.budget };
        this.everyTurns = options.summaryEveryTurns ?? DEFAULT_EVERY_TURNS;
        this.summaryMaxAge = options.summaryMaxAgeMs ?? DEFAULT_SUMMARY_MAX_AGE;
        this.halfLife = options.salienceHalfLifeMs ?? DEFAULT_HALF_LIFE;
        this.floor = options.salienceFloor ?? DEFAULT_FLOOR;
        this.maxTurns = options.maxTurnsPerSession ?? DEFAULT_MAX_TURNS;
    }
    get device() {
        return this.deviceId;
    }
    async append(input) {
        if (typeof input.text !== 'string') {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '记忆文本必须是字符串');
        }
        const body = canonical(input);
        const id = this.clock.now();
        const hash = await sha256(body);
        const sig = this.signer === undefined ? '' : await this.signer(`${id}:${hash}`);
        const record = { ...input, id, hash, sig };
        this.records.set(id, record);
        return record;
    }
    addTurn(sessionId, turn) {
        const list = this.turnsBySession.get(sessionId) ?? [];
        list.push(turn);
        if (list.length > this.maxTurns)
            list.splice(0, list.length - this.maxTurns);
        this.turnsBySession.set(sessionId, list);
    }
    turnsOf(sessionId) {
        return [...(this.turnsBySession.get(sessionId) ?? [])];
    }
    latestSummary(sessionId) {
        return this.summaries(sessionId).at(-1);
    }
    summaries(sessionId) {
        const superseded = this.supersededIds();
        return [...this.records.values()]
            .filter((record) => record.layer === 'L1' &&
            (record.kind === 'summary' || record.kind === 'revision') &&
            record.sessionId === sessionId &&
            !superseded.has(record.id))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    /**
     * 到点才压缩：轮数、时间、当前预算三种触发。
     * 摘要失败时保留原 turns，绝不静默丢弃。
     */
    async summarize(sessionId, force = false) {
        const turns = this.turnsBySession.get(sessionId) ?? [];
        if (turns.length === 0)
            return null;
        const lastAt = this.lastSummaryAt.get(sessionId) ?? 0;
        const recentCost = turns.reduce((sum, turn) => sum + estimateTokens(turn.content), 0);
        const due = force ||
            turns.length >= this.everyTurns ||
            (lastAt > 0 && this.now() - lastAt >= this.summaryMaxAge) ||
            recentCost > this.budget.recent;
        if (!due || this.summarizer === undefined)
            return null;
        const tail = this.latestSummary(sessionId);
        // await 期间 addTurn 会继续往同一个数组里 push；只清掉这次摘要覆盖的前 n 条。
        const snapshotLength = turns.length;
        let text;
        try {
            text = await this.summarizer({
                sessionId,
                turns: turns.slice(0, snapshotLength),
                ...(tail === undefined ? {} : { previous: tail.text }),
                siblings: []
            });
        }
        catch {
            return null;
        }
        const trimmed = text.trim();
        if (trimmed.length === 0)
            return null;
        const record = await this.append({
            deviceId: this.deviceId,
            layer: 'L1',
            kind: 'summary',
            text: trimmed.slice(0, 1200),
            parentIds: tail === undefined ? [] : [tail.id],
            sessionId,
            salience: 1,
            scope: 'shared'
        });
        const live = this.turnsBySession.get(sessionId) ?? [];
        live.splice(0, snapshotLength);
        this.lastSummaryAt.set(sessionId, this.now());
        return record;
    }
    async tombstone(id) {
        const target = this.records.get(id);
        if (target === undefined) {
            throw new PetError(ErrorCode.MEMORY_NOT_FOUND, `记忆不存在：${id}`);
        }
        return this.append({
            deviceId: this.deviceId,
            layer: 'L2',
            kind: 'tombstone',
            text: '',
            parentIds: [id],
            sessionId: target.sessionId,
            salience: 1,
            scope: 'shared'
        });
    }
    tombstonedIds() {
        const dead = new Set();
        for (const record of this.records.values()) {
            if (record.kind === 'tombstone') {
                for (const parent of record.parentIds)
                    dead.add(parent);
            }
        }
        return dead;
    }
    /** 被后续版本覆盖的旧记录：保留在历史里，但不再进入装配。 */
    supersededIds() {
        const dead = new Set();
        for (const record of this.records.values()) {
            if (record.kind === 'revision') {
                for (const parent of record.parentIds)
                    dead.add(parent);
            }
        }
        return dead;
    }
    /**
     * 修订一条记忆：生成新版本记录，旧版本保留在历史里但不再进入装配。
     * 原记录不被改动，便于回滚、审计与跨端对账。
     */
    async revise(id, text) {
        const target = this.records.get(id);
        if (target === undefined) {
            throw new PetError(ErrorCode.MEMORY_NOT_FOUND, `记忆不存在：${id}`);
        }
        if (target.kind === 'tombstone') {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, `已删除的记忆不能修订：${id}`);
        }
        const trimmed = text.trim();
        if (trimmed.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '修订文本不能为空');
        }
        return this.append({
            deviceId: this.deviceId,
            layer: target.layer,
            kind: 'revision',
            text: trimmed,
            parentIds: [id],
            sessionId: target.sessionId,
            salience: target.salience,
            ...(target.ttlMs === undefined ? {} : { ttlMs: target.ttlMs }),
            scope: target.scope
        });
    }
    effectiveSalience(record, now = this.now()) {
        const created = parseHlc(record.id).wall || now;
        const age = Math.max(0, now - created);
        return record.salience * 0.5 ** (age / this.halfLife);
    }
    /** 低于阈值的条目会被移出装配，但仍保留在记录里。 */
    async decay(now = this.now()) {
        let faded = 0;
        for (const record of this.records.values()) {
            if (record.kind === 'tombstone')
                continue;
            if (this.effectiveSalience(record, now) < this.floor)
                faded += 1;
        }
        return faded;
    }
    async assemble(sessionId, options = {}) {
        const budget = { ...this.budget, ...options.budget };
        const dead = this.tombstonedIds();
        const superseded = this.supersededIds();
        const now = this.now();
        const facts = [...this.records.values()]
            .filter((record) => record.layer === 'L2' &&
            record.kind !== 'tombstone' &&
            record.scope === 'shared' &&
            !dead.has(record.id) &&
            !superseded.has(record.id) &&
            this.effectiveSalience(record, now) >= this.floor)
            .sort((a, b) => {
            const diff = this.effectiveSalience(b, now) - this.effectiveSalience(a, now);
            return diff !== 0 ? diff : a.id < b.id ? 1 : -1;
        });
        const factText = takeByBudget(facts.map((record) => record.text), budget.facts);
        const summaries = this.summaries(sessionId).filter((record) => !dead.has(record.id));
        const summaryText = takeByBudget(summaries.map((record) => record.text), budget.summary);
        const recentTurns = takeRecent(this.turnsBySession.get(sessionId) ?? [], budget.recent);
        const persona = (options.persona ?? '').slice(0, budget.persona * 3);
        const currentEvent = (options.currentEvent ?? '').slice(0, budget.event * 3);
        const digest = await sha256(JSON.stringify({
            persona,
            facts: factText,
            summaries: summaryText,
            recentTurns,
            currentEvent
        }));
        const tokenEstimate = estimateTokens(persona) +
            factText.reduce((sum, item) => sum + estimateTokens(item), 0) +
            summaryText.reduce((sum, item) => sum + estimateTokens(item), 0) +
            recentTurns.reduce((sum, turn) => sum + estimateTokens(turn.content) + 2, 0) +
            estimateTokens(currentEvent);
        return {
            persona,
            facts: factText,
            summaries: summaryText,
            recentTurns,
            currentEvent,
            digest,
            tokenEstimate
        };
    }
    /** 只合并 shared 记录；同 id 视为同一条，保留先到的。 */
    merge(remote) {
        let added = 0;
        let skipped = 0;
        for (const record of remote) {
            if (record.scope !== 'shared' || this.records.has(record.id)) {
                skipped += 1;
                continue;
            }
            this.records.set(record.id, record);
            added += 1;
        }
        return { added, skipped };
    }
    syncable() {
        return [...this.records.values()]
            .filter((record) => record.scope === 'shared')
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    snapshot() {
        return [...this.records.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    /** 摘要链根：对 shared 摘要的 id+hash 做聚合哈希，供跨端对账比较。 */
    async chainRoot() {
        const parts = [...this.records.values()]
            .filter((record) => record.kind === 'summary' && record.scope === 'shared')
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map((record) => `${record.id}:${record.hash}`);
        return sha256(parts.join('|'));
    }
    /**
     * S8 才做跨端同步。首版保留类型正确的存根：
     * 调用方会拿到 NOT_IMPLEMENTED，缺口不会因为留空而被藏起来。
     */
    async syncWith(peerId) {
        throw new PetError(ErrorCode.NOT_IMPLEMENTED, `syncWith 属于 S8，首版未实现（peer=${peerId}）`, {
            details: { stage: 'S8', peerId }
        });
    }
}
