/**
 * 主动开口的机会账本：跨重启记住「说过几次、上次什么时候、对方回没回」。
 *
 * 借鉴 AstrBot 陪伴插件的「机会生命周期」：
 * 一次主动开口从候选变成一条有记录的机会，说了什么方向、结果如何、
 * 对方后来有没有接话，都留下来。下一拍据此决定还要不要开口，
 * 而不是只看一个进程内的计时器。
 *
 * 纯逻辑：时间从参数进来，不读文件、不碰网络，可从 `@pet/core/browser` 导出。
 */
import { dateKey } from './agenda.js';
export const DEFAULT_DAILY_LIMIT = 8;
export const DEFAULT_DUPLICATE_WINDOW_MS = 6 * 60 * 60_000;
const MAX_RECORDS = 24;
const MAX_UNANSWERED_STREAK = 4;
/** 未回应越多，下一次开口就等得越久；封顶 2.5 倍，避免彻底不再说话。 */
const INTERVAL_SCALES = [1, 1, 1.5, 2, 2.5];
/**
 * 好感分层：亲近的人可以多听几句，疏远时少打扰一点。
 * 只调「主动开口」的节奏，不影响被叫到时要不要回。
 */
const FAVOR_TIERS = [
    { min: 80, bonus: 3, scale: 0.7 },
    { min: 60, bonus: 1, scale: 0.85 },
    { min: 20, bonus: 0, scale: 1 },
    { min: 0, bonus: -2, scale: 1.3 }
];
function favorTier(favor) {
    // 0 表示还没有好感记录（刚认识），按中性处理；不许被当成「疏远」。
    if (!Number.isFinite(favor) || favor <= 0)
        return { bonus: 0, scale: 1 };
    const value = Math.min(100, favor);
    for (const tier of FAVOR_TIERS) {
        if (value >= tier.min)
            return { bonus: tier.bonus, scale: tier.scale };
    }
    return { bonus: 0, scale: 1 };
}
function asCount(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
function asText(value) {
    return typeof value === 'string' ? value : '';
}
function normalizeKind(value) {
    return value === 'absence' || value === 'loop' || value === 'agenda' ? value : 'auto';
}
export class OpeningLedger {
    now;
    dailyLimit;
    duplicateWindowMs;
    favor;
    day = '';
    spokenToday = 0;
    lastSpokenAt = 0;
    unansweredStreak = 0;
    records = [];
    sequence = 0;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.dailyLimit = Math.max(1, asCount(options.dailyLimit, DEFAULT_DAILY_LIMIT));
        this.duplicateWindowMs = Math.max(0, asCount(options.duplicateWindowMs, DEFAULT_DUPLICATE_WINDOW_MS));
        this.favor = typeof options.favor === 'function' ? options.favor : () => 50;
        this.day = dateKey(this.now());
    }
    /** 好感分层后的当日上限：再疏远也至少留一次，别把话说死。 */
    effectiveDailyLimit() {
        const tier = favorTier(this.favor());
        return Math.max(1, this.dailyLimit + tier.bonus);
    }
    /** 跨天只重置「今天说了几次」，上次开口时间保留，跨午夜的冷却仍然有效。 */
    roll(at) {
        const today = dateKey(at);
        if (this.day === today)
            return;
        this.day = today;
        this.spokenToday = 0;
    }
    pacing(at = this.now()) {
        this.roll(at);
        const streak = Math.min(this.unansweredStreak, MAX_UNANSWERED_STREAK);
        const tier = favorTier(this.favor());
        const dailyLimit = this.effectiveDailyLimit();
        const minutesSinceLast = this.lastSpokenAt > 0 ? Math.max(0, Math.floor((at - this.lastSpokenAt) / 60_000)) : null;
        return {
            day: this.day,
            spokenToday: this.spokenToday,
            dailyLimit,
            lastSpokenAt: this.lastSpokenAt,
            unansweredStreak: this.unansweredStreak,
            intervalScale: INTERVAL_SCALES[streak] ?? INTERVAL_SCALES[INTERVAL_SCALES.length - 1] ?? 1,
            favorScale: tier.scale,
            minutesSinceLast,
            blockedReason: this.spokenToday >= dailyLimit ? 'daily_limit' : null
        };
    }
    /**
     * 这一刻能不能开口。
     *
     * agenda 段由节目单自己的认领记录去重，这里不按指纹拦，
     * 否则「工作」这种每天都会出现的段会被跨天误伤。
     */
    allows(kind, reason, fingerprint, at = this.now()) {
        this.roll(at);
        if (this.spokenToday >= this.effectiveDailyLimit())
            return { allowed: false, reason: 'daily_limit' };
        if (kind === 'agenda')
            return { allowed: true, reason: null };
        const since = at - this.duplicateWindowMs;
        const duplicated = this.records.some((record) => record.outcome === 'spoken' &&
            record.fingerprint === fingerprint &&
            record.at >= since);
        if (duplicated)
            return { allowed: false, reason: 'duplicate' };
        return { allowed: true, reason: null };
    }
    /**
     * QQ 群插话的共享闸门：只查「今天总共说了几次」和同方向重复，
     * 不看桌面端的冷却，也不改未回应计数。
     *
     * 群消息节奏和桌面完全不同：把群里的沉默算成「她不回我」，
     * 会让桌面端正常开口被一起拖慢。共享的只是日预算这一层。
     */
    allowsShared(fingerprint, at = this.now()) {
        return this.allows('auto', '', fingerprint, at);
    }
    /** QQ 群那边真的说出去了：只计入今天的总次数，不动桌面端的冷却与未回应节奏。 */
    spokenShared(fingerprint, at = this.now()) {
        this.roll(at);
        this.spokenToday += 1;
        return this.push('auto', '', fingerprint, at, 'spoken');
    }
    /** 一句话真的说出去了。失败的那次不要调用，下一拍还有机会。 */
    spoken(kind, reason, fingerprint, at = this.now()) {
        this.roll(at);
        this.spokenToday += 1;
        this.lastSpokenAt = at;
        this.unansweredStreak += 1;
        return this.push(kind, reason, fingerprint, at, 'spoken');
    }
    /** 生成失败或没有可说的话：留下证据，但不计入今天、也不进入冷却。 */
    failed(kind, reason, fingerprint, at = this.now()) {
        return this.push(kind, reason, fingerprint, at, 'failed');
    }
    /** 用户真的接话了。连续未回应计数清零，节奏回到正常。 */
    userReplied() {
        this.unansweredStreak = 0;
    }
    /**
     * 给主动提示词的一行节奏提醒。
     *
     * 只在今天已经开口过时才给，避免第一句话就被「你今天说了几次」带跑。
     */
    describeForPrompt(at = this.now()) {
        this.roll(at);
        if (this.spokenToday === 0)
            return '';
        const parts = [`今天你已经主动开口 ${this.spokenToday} 次`];
        if (this.minutesSinceLast(at) !== null) {
            parts.push(`上次在 ${this.minutesSinceLast(at)} 分钟前`);
        }
        if (this.unansweredStreak >= 2)
            parts.push('对方还没有接话');
        const last = [...this.records].reverse().find((record) => record.outcome === 'spoken');
        if (last !== undefined && last.reason !== '')
            parts.push(`上次的方向是「${last.reason}」`);
        return `${parts.join('，')}。这一句换一个角度，不要重复上次的话题。`;
    }
    minutesSinceLast(at) {
        if (this.lastSpokenAt <= 0)
            return null;
        return Math.max(0, Math.floor((at - this.lastSpokenAt) / 60_000));
    }
    push(kind, reason, fingerprint, at, outcome) {
        this.sequence += 1;
        const record = {
            id: `opening-${at}-${this.sequence}`,
            kind: normalizeKind(kind),
            reason: asText(reason).slice(0, 80),
            fingerprint: asText(fingerprint).slice(0, 120),
            at,
            outcome
        };
        this.records = [...this.records, record].slice(-MAX_RECORDS);
        return record;
    }
    toJSON() {
        this.roll(this.now());
        return {
            version: 1,
            day: this.day,
            spokenToday: this.spokenToday,
            lastSpokenAt: this.lastSpokenAt,
            unansweredStreak: this.unansweredStreak,
            records: [...this.records]
        };
    }
    /** 任意一层坏掉都只回到空账本，不让主动开口整体失效。 */
    static fromJSON(raw, options = {}) {
        const ledger = new OpeningLedger(options);
        if (raw === null || typeof raw !== 'object')
            return ledger;
        const record = raw;
        ledger.day = asText(record['day']) !== '' ? asText(record['day']) : dateKey(ledger.now());
        ledger.spokenToday = asCount(record['spokenToday']);
        ledger.lastSpokenAt = asCount(record['lastSpokenAt']);
        ledger.unansweredStreak = asCount(record['unansweredStreak']);
        const rows = Array.isArray(record['records']) ? record['records'] : [];
        for (const row of rows) {
            if (row === null || typeof row !== 'object')
                continue;
            const item = row;
            const at = asCount(item['at']);
            if (at <= 0)
                continue;
            ledger.records.push({
                id: asText(item['id']) !== '' ? asText(item['id']) : `opening-${at}-restored`,
                kind: normalizeKind(item['kind']),
                reason: asText(item['reason']).slice(0, 80),
                fingerprint: asText(item['fingerprint']).slice(0, 120),
                at,
                outcome: item['outcome'] === 'failed' ? 'failed' : 'spoken'
            });
        }
        ledger.records = ledger.records.slice(-MAX_RECORDS);
        ledger.roll(ledger.now());
        return ledger;
    }
}
