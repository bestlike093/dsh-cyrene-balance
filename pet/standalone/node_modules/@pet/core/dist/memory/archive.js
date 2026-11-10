/**
 * 记忆归档。
 *
 * 来自 Coopanion / dsh-world 的做法：记忆不切碎、不进向量库，
 * 原文按天留着，需要时再回捞。理由很朴素——一个人的生活，量没有那么大。
 *
 * 这里只做文本层的渲染与解析，不碰文件系统。
 * 落盘与版本保留交给宿主（Windows 版可以直接用 git 管理这份 md）。
 */
export const MEMORY_KINDS = ['talk', 'event', 'note'];
const DAY_HEADER = /^## (\d{4})-(\d{2})-(\d{2})\s*$/;
const ENTRY_HEADER = /^### (\d{2}):(\d{2}) · (talk|event|note)\s*$/;
function pad(value, length = 2) {
    return String(value).padStart(length, '0');
}
/** 取本地日期键 `YYYY-MM-DD`。offsetMinutes 为相对 UTC 的偏移，默认用运行环境。 */
export function dayKey(at, offsetMinutes) {
    if (offsetMinutes === undefined) {
        const date = new Date(at);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    const shifted = new Date(at + offsetMinutes * 60_000);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
function timeKey(at, offsetMinutes) {
    if (offsetMinutes === undefined) {
        const date = new Date(at);
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    const shifted = new Date(at + offsetMinutes * 60_000);
    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
/** 按天分组，天与天、天内的条目都按时间升序。 */
export function groupByDay(entries, offsetMinutes) {
    const groups = new Map();
    for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
        const key = dayKey(entry.at, offsetMinutes);
        const bucket = groups.get(key);
        if (bucket === undefined) {
            groups.set(key, [entry]);
        }
        else {
            bucket.push(entry);
        }
    }
    return groups;
}
/**
 * 渲染成 Markdown。
 *
 * 天用 `##`，条目用 `###`，正文一律走引用块 `>`。
 * 正文加前缀是为了让解析器只认「裸的 `###`」为标题——否则正文里
 * 随手写一句 `### 小标题` 就会把归档切坏，而且坏得悄无声息。
 */
export function renderArchive(entries, offsetMinutes) {
    const groups = groupByDay(entries, offsetMinutes);
    const blocks = [];
    for (const [day, items] of groups) {
        blocks.push(`## ${day}`);
        for (const item of items) {
            blocks.push(`### ${timeKey(item.at, offsetMinutes)} · ${item.kind}`);
            blocks.push(item.text
                .split('\n')
                .map((line) => (line.length === 0 ? '>' : `> ${line}`))
                .join('\n'));
        }
    }
    return blocks.join('\n\n');
}
/**
 * 从 Markdown 还原条目。
 *
 * 容错优先：任何 `### ` 开头的行都结束当前条目。认得出时分与类型就开新条目，
 * 认不出就只当分隔符——宁可丢一条坏标题之后的零散正文，也不让它把
 * 后续正常条目全吞进去。
 */
export function parseArchive(markdown, options = {}) {
    const offset = options.offsetMinutes;
    const now = options.now ?? Date.now();
    const entries = [];
    let currentDay = null;
    let pending = null;
    let body = [];
    const flush = () => {
        if (pending === null)
            return;
        const text = body.join('\n').replace(/^\n+|\n+$/g, '');
        if (text.length === 0) {
            body = [];
            pending = null;
            return;
        }
        const base = currentDay ?? dayOf(now, offset);
        // 用 UTC 拼时间再减偏移，避免宿主机时区干扰解析结果。
        const utc = Date.UTC(base.year, base.month - 1, base.day, pending.hour, pending.minute);
        const at = offset === undefined ? localToStamp(base, pending.hour, pending.minute) : utc - offset * 60_000;
        entries.push({ at, kind: pending.kind, text });
        body = [];
        pending = null;
    };
    for (const rawLine of markdown.split(/\r?\n/)) {
        const dayMatch = DAY_HEADER.exec(rawLine);
        if (dayMatch !== null) {
            flush();
            currentDay = {
                year: Number(dayMatch[1]),
                month: Number(dayMatch[2]),
                day: Number(dayMatch[3])
            };
            continue;
        }
        if (rawLine.startsWith('### ')) {
            flush();
            const entryMatch = ENTRY_HEADER.exec(rawLine);
            if (entryMatch !== null) {
                pending = {
                    hour: Number(entryMatch[1]),
                    minute: Number(entryMatch[2]),
                    kind: entryMatch[3]
                };
            }
            continue;
        }
        if (pending !== null) {
            // 正文走引用块；没有前缀的行也照收，手改过的归档不至于整条丢失。
            if (rawLine === '>') {
                body.push('');
            }
            else if (rawLine.startsWith('> ')) {
                body.push(rawLine.slice(2));
            }
            else {
                body.push(rawLine);
            }
        }
    }
    flush();
    return entries;
}
function dayOf(at, offsetMinutes) {
    if (offsetMinutes === undefined) {
        const date = new Date(at);
        return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
    }
    const shifted = new Date(at + offsetMinutes * 60_000);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate()
    };
}
function localToStamp(day, hour, minute) {
    return new Date(day.year, day.month - 1, day.day, hour, minute, 0, 0).getTime();
}
