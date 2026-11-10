function describeData(data) {
    if (data === undefined)
        return '';
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        return Object.entries(data)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(' ');
    }
    try {
        return JSON.stringify(data);
    }
    catch {
        return '';
    }
}
function describeSection(section) {
    if (!section.ok) {
        return [section.code, section.message].filter((part) => part !== undefined).join(': ');
    }
    const parts = [section.code ?? '', describeData(section.data)].filter((part) => part.length > 0);
    return parts.length === 0 ? '已就绪' : parts.join(' · ');
}
/**
 * 把聚合快照整理成可直接渲染的行。
 * 面板只读取快照，不再触发任何探测，避免诊断本身产生副作用。
 */
export function buildDiagnosticsPanel(snapshot, labels = {}) {
    const rows = snapshot.sections.map((section) => ({
        id: section.name,
        label: labels[section.name] ?? section.name,
        level: section.level ?? (section.ok ? 'ok' : 'error'),
        detail: describeSection(section)
    }));
    if (snapshot.sections.length === 0) {
        rows.push({
            id: 'diagnostics',
            label: '诊断数据源',
            level: 'warn',
            detail: '还没有注册任何数据源'
        });
    }
    rows.push({
        id: 'bridge',
        label: '宿主桥接',
        level: snapshot.bridge === 'not-connected' ? 'warn' : 'ok',
        detail: snapshot.bridge
    });
    return {
        title: `桌宠诊断 ${snapshot.version}`,
        generatedAt: snapshot.generatedAt,
        rows,
        ok: rows.every((row) => row.level !== 'error')
    };
}
const LEVEL_TAG = {
    ok: '[OK]',
    warn: '[WARN]',
    error: '[ERROR]'
};
/** 纯文本视图，供 CLI 与日志使用；UI 可以直接消费 rows。 */
export function formatDiagnosticsPanel(panel) {
    const lines = [`${panel.title}（${new Date(panel.generatedAt).toISOString()}）`];
    for (const row of panel.rows) {
        lines.push(`${LEVEL_TAG[row.level]} ${row.label} — ${row.detail}`);
    }
    return lines.join('\n');
}
