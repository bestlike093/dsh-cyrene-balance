import { ErrorCode, fixHintOf } from '@pet/shared';
const FALLBACK_FIX_HINT = '无额外修复建议，按日志中的 code 排查。';
function isErrorCode(code) {
    return Object.values(ErrorCode).includes(code);
}
function sectionData(section) {
    if (typeof section.data !== 'object' || section.data === null || Array.isArray(section.data))
        return {};
    return section.data;
}
function asText(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function describeSection(section) {
    if (section.data === undefined)
        return section.message ?? (section.ok ? '已就绪' : '');
    if (typeof section.data !== 'object' || section.data === null || Array.isArray(section.data)) {
        try {
            return JSON.stringify(section.data);
        }
        catch {
            return '';
        }
    }
    const data = section.data;
    return Object.entries(data)
        // recoveredFrom 单独渲染，不混进 detail，避免顺手被复制导出。
        .filter(([key]) => key !== 'recoveredFrom')
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' · ');
}
/**
 * fixHint 的取值顺序（17.2.17）：错误码表 → 数据源自带 → 兜底文案。
 * 空字符串也算「没给」，否则界面会出现一条没有建议的修复建议。
 */
function resolveFixHint(section, data) {
    if (section.code !== undefined && isErrorCode(section.code)) {
        const hint = fixHintOf(section.code);
        if (hint.length > 0)
            return hint;
    }
    const declared = asText(data.fixHint);
    if (declared !== undefined)
        return declared;
    return FALLBACK_FIX_HINT;
}
/**
 * 把快照整理成 group → kind 两级视图。
 *
 * 分组顺序按首次出现；组内按 kind 字典序，保证同一份快照每次渲染位置一致。
 */
export function buildPanelView(snapshot, labels = {}) {
    const groups = new Map();
    for (const section of snapshot.sections) {
        const data = sectionData(section);
        const group = asText(data.group) ?? 'general';
        const kind = asText(data.kind) ?? section.name;
        const recoveredFrom = asText(data.recoveredFrom);
        const row = {
            id: section.name,
            label: labels[section.name] ?? section.name,
            group,
            kind,
            level: section.level ?? (section.ok ? 'ok' : 'error'),
            detail: describeSection(section),
            fixHint: resolveFixHint(section, data),
            ...(section.code === undefined ? {} : { code: section.code }),
            ...(recoveredFrom === undefined ? {} : { recoveredFrom })
        };
        const bucket = groups.get(group);
        if (bucket === undefined)
            groups.set(group, [row]);
        else
            bucket.push(row);
    }
    const ordered = [];
    for (const [group, rows] of groups) {
        ordered.push({
            group,
            rows: [...rows].sort((left, right) => left.kind.localeCompare(right.kind))
        });
    }
    return {
        title: `桌宠诊断 ${snapshot.version}`,
        generatedAt: snapshot.generatedAt,
        ok: snapshot.sections.every((section) => (section.level ?? (section.ok ? 'ok' : 'error')) !== 'error'),
        groups: ordered
    };
}
export function panelRows(view) {
    return view.groups.flatMap((group) => group.rows);
}
