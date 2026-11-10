/**
 * 反思：把「刚聊完的一段时间」压成几句她自己记得住的话。
 *
 * 这里不调模型。首版只做三件确定性的事：
 * 1. 统计这段时间的节奏与情绪走向；
 * 2. 把没说完的话记成 open loop，等下次自然接上；
 * 3. 判断这次值不值得留下一条自省（而不是每轮都写）。
 *
 * 需要更细的语义时由调用方传入 `narrator`，产出的文本仍只当作草稿，
 * 不会绕过断言层直接写进长期记忆。
 */
const LOOP_PATTERN = /(明天|后天|周末|下周|下次|改天|回头|等我|稍后|一会儿|晚点)[^\s，。,.！!？?]{0,24}/;
const RESOLVED_PATTERN = /(搞定了|做完了|弄好了|已经好了|结束了|通过了|完成了|解决了)/;
const HOUR_MS = 60 * 60 * 1000;
/**
 * 「明天」「周末」这类说法换算成适合回访的时间点。
 *
 * 不是精确日程，只求别在当天就问「面试怎么样了」：
 * 长时说法落到第二天或那一天上午，短时说法至少等两小时。
 */
export function loopDueAt(hint, createdAt) {
    const word = typeof hint === 'string' ? hint.trim() : '';
    if (word === '')
        return undefined;
    const morningOf = (days, hour = 9) => {
        const date = new Date(createdAt);
        date.setDate(date.getDate() + days);
        date.setHours(hour, 0, 0, 0);
        return date.getTime();
    };
    if (word === '明天')
        return morningOf(1);
    if (word === '后天')
        return morningOf(2);
    if (word === '周末') {
        // 最近的周六上午；如果那个时间已经过去了，就顺到第二天。
        const offset = (6 - new Date(createdAt).getDay() + 7) % 7;
        const candidate = morningOf(offset, 10);
        return candidate > createdAt ? candidate : morningOf(offset + 1, 10);
    }
    if (word === '下周')
        return morningOf(7, 10);
    if (word === '下次' || word === '改天' || word === '回头')
        return createdAt + 24 * HOUR_MS;
    // 等我、稍后、一会儿、晚点：给两小时，别刚说完就追着问。
    return createdAt + 2 * HOUR_MS;
}
const DEFAULT_EVERY_TURNS = 12;
const DEFAULT_MIN_INTERVAL = 20 * 60_000;
function trimTo(text, max) {
    return text.length <= max ? text : `${text.slice(0, max)}…`;
}
function bigrams(text) {
    const clean = text.replace(/[\s，。,.！!？?、；;：:（）()【】"']/gu, '');
    const out = new Set();
    for (let index = 0; index + 1 < clean.length; index += 1) {
        out.add(clean.slice(index, index + 2));
    }
    return out;
}
function overlap(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let hit = 0;
    for (const token of a) {
        if (b.has(token))
            hit += 1;
    }
    return hit;
}
function isOpenLoop(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return (typeof record['id'] === 'string' &&
        typeof record['text'] === 'string' &&
        typeof record['createdAt'] === 'number' &&
        (record['status'] === 'open' || record['status'] === 'resolved' || record['status'] === 'expired'));
}
function isReflection(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return (typeof record['id'] === 'string' &&
        typeof record['at'] === 'number' &&
        typeof record['note'] === 'string' &&
        Array.isArray(record['openLoopIds']));
}
export class ReflectionEngine {
    buffer = [];
    loopItems = new Map();
    sequence = 0;
    lastReflectionAt = 0;
    now;
    everyTurns;
    minInterval;
    narrator;
    reflections = [];
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.everyTurns = options.everyTurns ?? DEFAULT_EVERY_TURNS;
        this.minInterval = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL;
        this.narrator = options.narrator;
    }
    observe(turn) {
        this.buffer.push(turn);
        if (this.buffer.length > 200)
            this.buffer.splice(0, this.buffer.length - 200);
        if (turn.role !== 'user')
            return;
        const now = this.now();
        if (RESOLVED_PATTERN.test(turn.content)) {
            // 先按语义找：说「面试搞定了」就该关掉「明天要去面试」，
            // 而不是机械地关掉最近那条。找不到相关的，才退化为关最近一条。
            const candidate = this.pickLoopToClose(turn.content);
            if (candidate !== undefined) {
                this.loopItems.set(candidate.id, { ...candidate, status: 'resolved' });
            }
        }
        const match = LOOP_PATTERN.exec(turn.content);
        if (match === null)
            return;
        const hint = match[1];
        const dueAt = loopDueAt(hint, now);
        this.sequence += 1;
        const loop = {
            id: `loop-${String(this.sequence).padStart(4, '0')}`,
            text: trimTo(turn.content, 60),
            createdAt: now,
            status: 'open',
            ...(hint === undefined ? {} : { dueHint: hint }),
            ...(dueAt === undefined ? {} : { dueAt })
        };
        this.loopItems.set(loop.id, loop);
    }
    pickLoopToClose(text) {
        const open = [...this.loopItems.values()]
            .filter((item) => item.status === 'open')
            .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
        if (open.length === 0)
            return undefined;
        const tokens = bigrams(text);
        let best;
        let bestScore = 0;
        for (const item of open) {
            const score = overlap(bigrams(item.text), tokens);
            if (score > bestScore) {
                best = item;
                bestScore = score;
            }
        }
        // 完全没有语义交集时，退化成关掉最近一条——总比一条都关不掉好。
        return best ?? open[0];
    }
    loops(status = 'open') {
        return [...this.loopItems.values()]
            .filter((item) => item.status === status)
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    }
    resolveLoop(id) {
        const target = this.loopItems.get(id);
        if (target === undefined || target.status !== 'open')
            return false;
        this.loopItems.set(id, { ...target, status: 'resolved' });
        return true;
    }
    /** 超过 7 天还没接上的话头自动过期，免得下次突然提起一件旧事。 */
    expireLoops(now = this.now(), ttlMs = 7 * 24 * 60 * 60_000) {
        let expired = 0;
        for (const [id, item] of this.loopItems) {
            if (item.status === 'open' && now - item.createdAt > ttlMs) {
                this.loopItems.set(id, { ...item, status: 'expired' });
                expired += 1;
            }
        }
        return expired;
    }
    shouldReflect(now = this.now()) {
        if (this.buffer.length === 0)
            return false;
        if (this.buffer.length >= this.everyTurns)
            return true;
        return this.lastReflectionAt > 0 && now - this.lastReflectionAt >= this.minInterval;
    }
    /**
     * 生成一次反思。
     *
     * 没有 narrator 时用模板句子：读起来像日记，不像日志。
     * 无论哪条路径，`note` 都只进自我档案，不会出现在聊天里。
     */
    reflect(mood, now = this.now()) {
        if (this.buffer.length === 0)
            return null;
        const turns = [...this.buffer];
        const stats = this.statsOf(turns);
        const openLoops = this.loops('open');
        const note = this.narrator?.(turns, stats) ??
            this.templateNote(stats, openLoops.length, mood);
        this.sequence += 1;
        const reflection = {
            id: `rf-${String(this.sequence).padStart(4, '0')}`,
            at: now,
            turnCount: stats.turnCount,
            userTurnCount: stats.userTurnCount,
            note,
            openLoopIds: openLoops.map((item) => item.id),
            moodAtStart: mood ?? null
        };
        this.reflections.push(reflection);
        if (this.reflections.length > 60)
            this.reflections.shift();
        this.buffer.splice(0, this.buffer.length);
        this.lastReflectionAt = now;
        return reflection;
    }
    history() {
        return [...this.reflections];
    }
    toJSON() {
        return {
            version: 1,
            sequence: this.sequence,
            lastReflectionAt: this.lastReflectionAt,
            loops: [...this.loopItems.values()],
            reflections: [...this.reflections]
        };
    }
    /** 缓冲区（尚未成形的对话片段）不落盘，重启后从下一句重新开始积累。 */
    static fromJSON(raw, options = {}) {
        const engine = new ReflectionEngine(options);
        if (typeof raw !== 'object' || raw === null)
            return engine;
        const record = raw;
        const loops = Array.isArray(record['loops']) ? record['loops'] : [];
        for (const item of loops) {
            if (isOpenLoop(item))
                engine.loopItems.set(item.id, item);
        }
        const reflections = Array.isArray(record['reflections']) ? record['reflections'] : [];
        for (const item of reflections) {
            if (isReflection(item))
                engine.reflections.push(item);
        }
        const sequence = record['sequence'];
        engine.sequence = typeof sequence === 'number' && Number.isFinite(sequence) ? sequence : 0;
        const lastReflectionAt = record['lastReflectionAt'];
        engine.lastReflectionAt =
            typeof lastReflectionAt === 'number' && Number.isFinite(lastReflectionAt) ? lastReflectionAt : 0;
        return engine;
    }
    statsOf(turns) {
        const userTurns = turns.filter((turn) => turn.role === 'user');
        const totalLength = userTurns.reduce((sum, turn) => sum + turn.content.length, 0);
        return {
            turnCount: turns.length,
            userTurnCount: userTurns.length,
            assistantTurnCount: turns.length - userTurns.length,
            averageUserLength: userTurns.length === 0 ? 0 : Math.round(totalLength / userTurns.length),
            openLoops: this.loops('open').length
        };
    }
    templateNote(stats, openLoops, mood) {
        const pace = stats.averageUserLength >= 30
            ? '说了挺多'
            : stats.averageUserLength >= 10
                ? '聊得比较随意'
                : '话不多';
        const weather = mood === undefined
            ? ''
            : mood.valence >= 0.35
                ? '心情是亮的'
                : mood.valence <= -0.2
                    ? '心里有点沉'
                    : '情绪平稳';
        const tail = openLoops > 0 ? `还有 ${openLoops} 件没说完的事，下次别急着问。` : '没有留下悬着的话头。';
        const parts = [`这一段时间聊了 ${stats.turnCount} 轮，${pace}`];
        if (weather.length > 0)
            parts.push(weather);
        return `${parts.join('，')}。${tail}`;
    }
}
