/**
 * 角色节目单：她一天在做什么。
 *
 * 和 `game/dailySchedule.ts` 无关——那边是用户的游戏排班，这里是角色自己的生活。
 *
 * 三条底线：
 * 1. 一天必须被完整覆盖，任何时刻都能回答「她现在在做什么」；
 * 2. 模型生成的内容先过校验，重叠、越界、空标题都会被剔掉；
 * 3. 到点不等于执行：先认领，再允许产生主动行为，防止重复触发。
 *
 * 纯逻辑：时间从参数传入，不读文件、不碰网络，可从 `@pet/core/browser` 导出。
 */
export const SEGMENT_KINDS = [
    'sleep',
    'meal',
    'work',
    'study',
    'chore',
    'leisure',
    'rest',
    'commute',
    'other'
];
export const MINUTES_PER_DAY = 24 * 60;
export const MAX_SEGMENTS = 24;
export const MIN_SEGMENT_MINUTES = 10;
const MAX_TITLE_CHARS = 24;
/** 内置的一天。模型不可用时也不会出现「空白的一天」。 */
export const DEFAULT_SEGMENTS = [
    { id: 'sleep', startMinute: 0, endMinute: 7 * 60, title: '睡觉', kind: 'sleep' },
    { id: 'morning', startMinute: 7 * 60, endMinute: 8 * 60, title: '起床，慢慢醒过来', kind: 'rest' },
    { id: 'breakfast', startMinute: 8 * 60, endMinute: 9 * 60, title: '吃早饭', kind: 'meal' },
    { id: 'focus', startMinute: 9 * 60, endMinute: 12 * 60, title: '做自己的事', kind: 'work' },
    { id: 'lunch', startMinute: 12 * 60, endMinute: 13 * 60, title: '午饭', kind: 'meal' },
    { id: 'nap', startMinute: 13 * 60, endMinute: 14 * 60, title: '小睡一会儿', kind: 'rest' },
    { id: 'afternoon', startMinute: 14 * 60, endMinute: 18 * 60, title: '下午的琐事', kind: 'chore' },
    { id: 'dinner', startMinute: 18 * 60, endMinute: 19 * 60, title: '晚饭', kind: 'meal' },
    { id: 'evening', startMinute: 19 * 60, endMinute: 22 * 60, title: '闲下来', kind: 'leisure' },
    { id: 'night', startMinute: 22 * 60, endMinute: MINUTES_PER_DAY, title: '洗漱，准备睡', kind: 'rest' }
];
function isInteger(value) {
    return typeof value === 'number' && Number.isInteger(value);
}
/** 本地日期键。用本地时间，因为节目单跟着人的生活节奏走。 */
export function dateKey(now) {
    const date = new Date(now);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}
/** 当前时刻是一天里的第几分钟。 */
export function minuteOfDay(now) {
    const date = new Date(now);
    return date.getHours() * 60 + date.getMinutes();
}
export function formatMinute(minute) {
    const safe = Math.max(0, Math.min(MINUTES_PER_DAY, Math.trunc(minute)));
    const hour = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${`${hour}`.padStart(2, '0')}:${`${rest}`.padStart(2, '0')}`;
}
/** 一次返回全部问题，方便调用方决定是整份丢弃还是逐条修。 */
export function validateSegments(segments) {
    const issues = [];
    if (segments.length === 0) {
        issues.push({ field: 'segments', message: '节目单是空的' });
        return issues;
    }
    if (segments.length > MAX_SEGMENTS) {
        issues.push({ field: 'segments', message: `最多 ${MAX_SEGMENTS} 段，收到 ${segments.length}` });
    }
    const ids = new Set();
    for (const segment of segments) {
        if (segment.id === '')
            issues.push({ field: 'id', message: '段缺少 id' });
        if (ids.has(segment.id))
            issues.push({ field: 'id', message: `id 重复：${segment.id}` });
        ids.add(segment.id);
        if (!isInteger(segment.startMinute) || !isInteger(segment.endMinute)) {
            issues.push({ field: 'time', message: `${segment.id} 的时间必须是整数分钟` });
            continue;
        }
        if (segment.startMinute < 0 || segment.endMinute > MINUTES_PER_DAY) {
            issues.push({ field: 'time', message: `${segment.id} 超出一整天` });
        }
        if (segment.endMinute - segment.startMinute < MIN_SEGMENT_MINUTES) {
            issues.push({ field: 'time', message: `${segment.id} 少于 ${MIN_SEGMENT_MINUTES} 分钟` });
        }
        if (segment.title.trim() === '') {
            issues.push({ field: 'title', message: `${segment.id} 没有标题` });
        }
        else if (segment.title.length > MAX_TITLE_CHARS) {
            issues.push({ field: 'title', message: `${segment.id} 标题超过 ${MAX_TITLE_CHARS} 字` });
        }
    }
    const sorted = [...segments].sort((a, b) => a.startMinute - b.startMinute);
    for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (previous !== undefined && current !== undefined && current.startMinute < previous.endMinute) {
            issues.push({
                field: 'time',
                message: `${previous.id} 与 ${current.id} 时间重叠`
            });
        }
    }
    return issues;
}
/**
 * 清洗模型输出。
 *
 * - 丢掉结构不合法的段；
 * - 按开始时间排序；
 * - 重叠时保留先出现的那一段（模型通常把重要的写在前面）；
 * - 默认把缝隙补成「留白」，保证任何时刻都有答案。
 */
export function normalizeSegments(raw, options = {}) {
    const accepted = [];
    const usedIds = new Set();
    for (const item of raw) {
        if (typeof item !== 'object' || item === null)
            continue;
        const record = item;
        const start = record['startMinute'];
        const end = record['endMinute'];
        if (!isInteger(start) || !isInteger(end))
            continue;
        if (start < 0 || end > MINUTES_PER_DAY || end - start < MIN_SEGMENT_MINUTES)
            continue;
        const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
        if (title === '')
            continue;
        const kindValue = record['kind'];
        const kind = SEGMENT_KINDS.includes(String(kindValue))
            ? kindValue
            : 'other';
        let id = typeof record['id'] === 'string' && record['id'].trim() !== ''
            ? record['id'].trim()
            : `seg-${start}`;
        if (usedIds.has(id))
            id = `${id}-${start}`;
        usedIds.add(id);
        const memo = typeof record['memo'] === 'string' ? record['memo'].trim() : '';
        const candidate = {
            id,
            startMinute: start,
            endMinute: end,
            title: title.slice(0, MAX_TITLE_CHARS),
            kind,
            ...(memo === '' ? {} : { memo: memo.slice(0, 60) })
        };
        const overlaps = accepted.some((segment) => candidate.startMinute < segment.endMinute && segment.startMinute < candidate.endMinute);
        if (overlaps)
            continue;
        accepted.push(candidate);
    }
    accepted.sort((a, b) => a.startMinute - b.startMinute);
    if (options.fillGaps === false)
        return accepted;
    return fillGaps(accepted);
}
/** 把没被覆盖的时间补成「留白」，保证时间线连续。 */
export function fillGaps(segments) {
    if (segments.length === 0)
        return [];
    const filled = [];
    let cursor = 0;
    for (const segment of segments) {
        if (segment.startMinute > cursor) {
            filled.push({
                id: `gap-${cursor}`,
                startMinute: cursor,
                endMinute: segment.startMinute,
                title: '留白',
                kind: 'other'
            });
        }
        filled.push(segment);
        cursor = Math.max(cursor, segment.endMinute);
    }
    if (cursor < MINUTES_PER_DAY) {
        filled.push({
            id: `gap-${cursor}`,
            startMinute: cursor,
            endMinute: MINUTES_PER_DAY,
            title: '留白',
            kind: 'other'
        });
    }
    return filled;
}
/** 从模型输出建一份可用的节目单；清洗后仍然为空就退回内置。 */
export function buildPlan(raw, options) {
    const normalized = normalizeSegments(raw, {
        fillGaps: options.fillGaps !== false
    });
    const segments = normalized.length === 0 ? [...DEFAULT_SEGMENTS] : normalized;
    return {
        date: dateKey(options.now),
        generatedAt: options.now,
        source: normalized.length === 0 ? 'default' : (options.source ?? 'model'),
        segments
    };
}
/**
 * 沿用上一份节目的结构，只把日期换掉。
 *
 * 生成失败时用它，宁可沿用昨天的节奏，也不要给她一个空白的一天。
 */
export function carryOver(previous, now) {
    const day = dateKey(now);
    const segments = previous.segments.map((segment) => ({
        ...segment,
        id: `${day}-${segment.id}`
    }));
    return { date: day, generatedAt: now, source: 'carryover', segments };
}
export function defaultPlan(now) {
    return { date: dateKey(now), generatedAt: now, source: 'default', segments: [...DEFAULT_SEGMENTS] };
}
/**
 * 从存盘数据恢复。
 *
 * 结构坏了就退回内置一天；日期不是今天时沿用旧结构，避免每次重启都回到默认作息。
 */
export function planFromJSON(raw, now) {
    if (typeof raw !== 'object' || raw === null)
        return defaultPlan(now);
    const record = raw;
    const rawSegments = Array.isArray(record['segments']) ? record['segments'] : [];
    const segments = normalizeSegments(rawSegments);
    if (segments.length === 0)
        return defaultPlan(now);
    const storedDate = typeof record['date'] === 'string' ? record['date'] : '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(storedDate) ? storedDate : dateKey(now);
    const storedSource = record['source'];
    const source = storedSource === 'model' || storedSource === 'carryover' || storedSource === 'default'
        ? storedSource
        : 'default';
    const generatedAt = typeof record['generatedAt'] === 'number' && Number.isFinite(record['generatedAt'])
        ? record['generatedAt']
        : now;
    const plan = { date, generatedAt, source, segments };
    return date === dateKey(now) ? plan : carryOver(plan, now);
}
/** 这一份是不是今天（或指定日期）的。 */
export function isPlanFor(plan, now) {
    return plan.date === dateKey(now);
}
/** 此刻所在的段。节目单覆盖完整一天，所以正常情况下不会返回 null。 */
export function segmentAt(plan, now) {
    const minute = minuteOfDay(now);
    for (const segment of plan.segments) {
        if (minute >= segment.startMinute && minute < segment.endMinute)
            return segment;
    }
    return null;
}
/** 接下来的一段；当天已到末尾时返回 null。 */
export function nextSegment(plan, now) {
    const minute = minuteOfDay(now);
    for (const segment of plan.segments) {
        if (segment.startMinute > minute)
            return segment;
    }
    return null;
}
/**
 * 给提示词用的一小段话。
 *
 * 只写「现在」和「接下来」，不铺整张表——铺开会让每句话都变成日程播报。
 */
export function planNote(plan, now) {
    const current = segmentAt(plan, now);
    const next = nextSegment(plan, now);
    const lines = [];
    if (current !== null) {
        const range = `${formatMinute(current.startMinute)}–${formatMinute(current.endMinute)}`;
        lines.push(`你此刻正在做：${current.title}（${range}）。`);
        if (current.memo !== undefined && current.memo !== '')
            lines.push(current.memo);
    }
    if (next !== null) {
        lines.push(`接下来是：${next.title}（${formatMinute(next.startMinute)} 开始）。`);
    }
    return lines.join('\n');
}
/** 压缩顺序：越靠前越先让位；吃饭和睡觉放最后。 */
const TRIM_ORDER = [
    'other',
    'leisure',
    'rest',
    'chore',
    'commute',
    'work',
    'study',
    'meal',
    'sleep'
];
function trimRank(kind) {
    const at = TRIM_ORDER.indexOf(kind);
    return at < 0 ? TRIM_ORDER.length - 1 : at;
}
/**
 * 一次被打断之后，把今天剩下的时间重新排一遍。
 *
 * 被打断的这段时间不会凭空消失：先记成一段「和你说说话」，
 * 她手头没做完的事从这段之后接着做，后面所有安排整体顺延。
 * 顺延出来的差额从后面各段里按「越不重要越先让」的顺序压缩，
 * 睡觉和吃饭排在最后，不会因为多聊了一会儿就没了晚饭。
 *
 * 不动的情况：没有被打断、正在睡觉（半夜聊几句不该把整夜切碎）、
 * 或者后面根本压不出这么多时间——这时宁可保持原样。
 */
export function rescheduleAfter(plan, options) {
    const unchanged = (reason) => ({
        changed: false,
        plan,
        reason,
        shiftedMinutes: 0,
        trimmedMinutes: 0
    });
    const delay = Math.round(Number(options.delayMinutes));
    // 太短的打断不值得改日程，也会把某一段压到十分钟以下。
    if (!Number.isFinite(delay) || delay < MIN_SEGMENT_MINUTES)
        return unchanged('no-delay');
    const nowMinute = minuteOfDay(options.now);
    const current = segmentAt(plan, options.now);
    if (current === null)
        return unchanged('no-current');
    if (current.kind === 'sleep')
        return unchanged('sleeping');
    const index = plan.segments.findIndex((segment) => segment.id === current.id);
    if (index < 0)
        return unchanged('no-current');
    const minLength = Math.max(1, Math.round(options.minSegmentMinutes ?? MIN_SEGMENT_MINUTES));
    const locked = plan.segments.slice(0, index);
    const rest = plan.segments.slice(index + 1);
    const remaining = Math.max(1, current.endMinute - nowMinute);
    const lengths = rest.map((segment) => segment.endMinute - segment.startMinute);
    const shrinkable = lengths.reduce((sum, length) => sum + Math.max(0, length - minLength), 0);
    if (shrinkable < delay)
        return unchanged('no-room');
    const order = rest
        .map((segment, i) => ({ i, rank: trimRank(segment.kind) }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i);
    let need = delay;
    for (const entry of order) {
        if (need <= 0)
            break;
        const length = Number(lengths[entry.i] ?? 0);
        const cut = Math.min(need, Math.max(0, length - minLength));
        if (cut > 0) {
            lengths[entry.i] = length - cut;
            need -= cut;
        }
    }
    // 理论上不会走到这里：上面已经确认可压缩量够。真不够就当无事发生。
    if (need > 0)
        return unchanged('no-room');
    const segments = [...locked];
    let cursor = nowMinute;
    // 已经被做掉的那一段也要留在时间线上，不然中间会空出一截。
    if (nowMinute > current.startMinute) {
        segments.push({
            ...current,
            id: `${current.id}-done`,
            startMinute: current.startMinute,
            endMinute: nowMinute,
            memo: '这一小段已经做完了'
        });
    }
    const chatEnd = cursor + delay;
    segments.push({
        id: `${current.id}-chat`,
        startMinute: cursor,
        endMinute: chatEnd,
        title: '和你说说话',
        kind: 'leisure',
        memo: '刚才被打断了，先把这会儿留给你'
    });
    cursor = chatEnd;
    segments.push({ ...current, startMinute: cursor, endMinute: cursor + remaining });
    cursor += remaining;
    rest.forEach((segment, i) => {
        const length = Number(lengths[i] ?? 0);
        segments.push({ ...segment, startMinute: cursor, endMinute: cursor + length });
        cursor += length;
    });
    // 时间线必须覆盖到 24:00；压缩量算得准时这里不会触发。
    if (cursor < MINUTES_PER_DAY) {
        segments.push({
            id: `gap-${cursor}`,
            startMinute: cursor,
            endMinute: MINUTES_PER_DAY,
            title: '留白',
            kind: 'other'
        });
    }
    return {
        changed: true,
        plan: {
            date: plan.date,
            generatedAt: plan.generatedAt,
            source: plan.source,
            segments
        },
        reason: 'ok',
        shiftedMinutes: delay,
        trimmedMinutes: delay
    };
}
/**
 * 认领记录。
 *
 * 「到点」和「执行」分开：同一段一天只能被认领一次，进程重启后也能接上。
 * 认领后才发现不该打扰，可以 `release` 退回；这比「先执行再补记」安全。
 */
export class AgendaClaims {
    claimed = new Map();
    static key(date, segmentId) {
        return `${date}#${segmentId}`;
    }
    isClaimed(date, segmentId) {
        return this.claimed.has(AgendaClaims.key(date, segmentId));
    }
    /** 认领当前段。已经认领过返回 null，调用方据此跳过。 */
    claim(plan, now) {
        const segment = segmentAt(plan, now);
        if (segment === null)
            return null;
        const key = AgendaClaims.key(plan.date, segment.id);
        if (this.claimed.has(key))
            return null;
        this.claimed.set(key, now);
        return segment;
    }
    /** 主动放弃认领，下一轮可以重新尝试。 */
    release(date, segmentId) {
        this.claimed.delete(AgendaClaims.key(date, segmentId));
    }
    /** 只保留今天的记录，避免跨天累积。 */
    prune(now) {
        const today = dateKey(now);
        for (const key of [...this.claimed.keys()]) {
            if (!key.startsWith(`${today}#`))
                this.claimed.delete(key);
        }
    }
    get size() {
        return this.claimed.size;
    }
    toJSON() {
        return { version: 1, claims: Object.fromEntries(this.claimed) };
    }
    static fromJSON(raw) {
        const claims = new AgendaClaims();
        if (typeof raw !== 'object' || raw === null)
            return claims;
        const record = raw;
        const source = record['claims'];
        if (typeof source === 'object' && source !== null) {
            for (const [key, value] of Object.entries(source)) {
                if (typeof value === 'number' && Number.isFinite(value))
                    claims.claimed.set(key, value);
            }
        }
        return claims;
    }
}
