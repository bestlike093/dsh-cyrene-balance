import { type PanelViewModel } from './panelView.js';
export type CopyResult = {
    readonly ok: true;
    readonly text: string;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function redactReport(text: string): string;
/**
 * 生成可复制到剪贴板的报告。
 *
 * 导出属于持久化输出，过两道：
 * 1. 所有 code 必须登记在 ErrorCode 中，否则整份拒绝导出；
 * 2. 统一做路径脱敏。
 *
 * recoveredFrom 只出现在界面行里，这里不读取它。
 */
export declare function buildCopyPayload(view: PanelViewModel): CopyResult;
