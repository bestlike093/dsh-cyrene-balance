import { assertPersistableCode } from '@pet/shared';
import { panelRows } from './panelView.js';
/**
 * 路径脱敏。
 *
 * 报告里会出现 C:\Users\<用户名>\...，用户目录名本身就算敏感信息。
 * 只替换用户名那一段，保留盘符与目录结构，排障时仍然可读。
 *
 * 边界（17.2.52 定）：本函数按路径形态工作，不认裸用户名。
 * 「分析报告 / 日志 / 导出不得出现裸用户名」由数据源头保证，
 * 不靠这里事后擦除 —— 形态匹配拿不到没有路径上下文的字符串。
 * 若新增字段要携带本机信息，请写成路径，别写成孤立的用户名。
 */
const USER_PATH_PATTERNS = [
    [/([A-Za-z]:\\Users\\)([^\\/\s"']+)/g, '$1<user>'],
    [/(\/Users\/)([^\/\s"']+)/g, '$1<user>'],
    [/(\/home\/)([^\/\s"']+)/g, '$1<user>']
];
export function redactReport(text) {
    let next = text;
    for (const [pattern, replacement] of USER_PATH_PATTERNS) {
        next = next.replace(pattern, replacement);
    }
    return next;
}
/**
 * 生成可复制到剪贴板的报告。
 *
 * 导出属于持久化输出，过两道：
 * 1. 所有 code 必须登记在 ErrorCode 中，否则整份拒绝导出；
 * 2. 统一做路径脱敏。
 *
 * recoveredFrom 只出现在界面行里，这里不读取它。
 */
export function buildCopyPayload(view) {
    const rows = panelRows(view);
    try {
        for (const row of rows) {
            if (row.code !== undefined)
                assertPersistableCode(row.code);
        }
    }
    catch (error) {
        return {
            ok: false,
            reason: error instanceof Error ? error.message : String(error)
        };
    }
    const lines = [
        `${view.title}`,
        `generatedAt: ${new Date(view.generatedAt).toISOString()}`,
        `ok: ${String(view.ok)}`
    ];
    for (const group of view.groups) {
        lines.push(`[${group.group}]`);
        for (const row of group.rows) {
            const code = row.code === undefined ? '' : ` [${row.code}]`;
            lines.push(`- ${row.kind} (${row.level}) ${row.label}${code}: ${row.detail}`);
            lines.push(`  fix: ${row.fixHint}`);
        }
    }
    return { ok: true, text: redactReport(lines.join('\n')) };
}
