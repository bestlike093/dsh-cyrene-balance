import { buildPanelView } from './panelView.js';
/*
 * 样式自足：只读 --dsh-diag-* 变量并带默认值。
 * 不 import 模块样式，也不要求任何 ShadowRoot 存在。
 */
const PANEL_CSS = `
.dsh-diag {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--dsh-diag-border, #e8d5de);
  background: var(--dsh-diag-bg, #fffafc);
  color: var(--dsh-diag-fg, #33262c);
  font: 13px/1.55 system-ui, sans-serif;
}
.dsh-diag__head { display: flex; align-items: center; gap: 8px; }
.dsh-diag__title { font-weight: 600; }
.dsh-diag__state { opacity: .7; font-size: 12px; }
.dsh-diag__state[data-state="pending"] { color: var(--dsh-diag-pending, #8a6c78); }
.dsh-diag__state[data-state="ready"] { color: var(--dsh-diag-ok, #2f7a4f); }
.dsh-diag__state[data-state="error"] { color: var(--dsh-diag-error, #b1344a); }
.dsh-diag__actions { margin-left: auto; display: flex; gap: 6px; }
.dsh-diag__actions button {
  border: 1px solid var(--dsh-diag-border, #e8d5de);
  background: transparent;
  color: inherit;
  border-radius: 8px;
  padding: 2px 10px;
  font: inherit;
  cursor: pointer;
}
.dsh-diag__group { display: flex; flex-direction: column; gap: 6px; }
.dsh-diag__group-name { font-size: 12px; opacity: .6; letter-spacing: .04em; }
.dsh-diag__row {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 10px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--dsh-diag-row, #fff2f7);
}
.dsh-diag__row[data-level="warn"] { background: var(--dsh-diag-row-warn, #fff7e8); }
.dsh-diag__row[data-level="error"] { background: var(--dsh-diag-row-error, #ffeef1); }
.dsh-diag__kind { font-family: ui-monospace, monospace; opacity: .75; }
.dsh-diag__detail { opacity: .85; }
.dsh-diag__fix { grid-column: 2; font-size: 12px; opacity: .7; }
.dsh-diag__recovered { grid-column: 2; font-size: 12px; opacity: .55; }
`;
function renderRow(document, row) {
    const element = document.createElement('div');
    element.className = 'dsh-diag__row';
    element.dataset.level = row.level;
    element.dataset.kind = row.kind;
    const kind = document.createElement('div');
    kind.className = 'dsh-diag__kind';
    kind.textContent = row.kind;
    const detail = document.createElement('div');
    detail.className = 'dsh-diag__detail';
    detail.textContent =
        row.code === undefined ? `${row.label}: ${row.detail}` : `[${row.code}] ${row.label}: ${row.detail}`;
    const fix = document.createElement('div');
    fix.className = 'dsh-diag__fix';
    fix.textContent = row.fixHint;
    element.append(kind, detail, fix);
    // 只在界面显示：恢复出来的旧路径属于本机证据，不进复制载荷。
    if (row.recoveredFrom !== undefined) {
        const recovered = document.createElement('div');
        recovered.className = 'dsh-diag__recovered';
        recovered.textContent = `已从 ${row.recoveredFrom} 恢复`;
        element.append(recovered);
    }
    return element;
}
/**
 * 挂载诊断面板的 DOM 外壳。
 *
 * 宿主负责容器与样式；模块失败不影响这里，因为整块面板不依赖模块 ShadowRoot。
 * 状态更新由 panelState 的 controller 驱动，本函数只负责把状态画出来。
 */
export function mountDiagnosticsPanel(container, options = {}) {
    const document = container.ownerDocument;
    // 容器已脱离文档：不建节点、不写 state、不抛错。
    if (document === null) {
        return {
            element: null,
            update: () => { },
            dispose: () => { }
        };
    }
    const root = document.createElement('section');
    root.className = 'dsh-diag';
    root.dataset.state = 'pending';
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    const head = document.createElement('div');
    head.className = 'dsh-diag__head';
    const title = document.createElement('span');
    title.className = 'dsh-diag__title';
    title.textContent = '桌宠诊断';
    const state = document.createElement('span');
    state.className = 'dsh-diag__state';
    state.dataset.state = 'pending';
    state.textContent = '正在检查…';
    const actions = document.createElement('div');
    actions.className = 'dsh-diag__actions';
    const cleanups = [];
    const listen = (button, handler) => {
        button.addEventListener('click', handler);
        cleanups.push(() => {
            button.removeEventListener('click', handler);
        });
    };
    if (options.onRetry !== undefined) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重新检查';
        listen(retry, options.onRetry);
        actions.append(retry);
    }
    if (options.onCopy !== undefined) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = '复制报告';
        listen(copy, options.onCopy);
        actions.append(copy);
    }
    head.append(title, state);
    if (actions.childElementCount > 0)
        head.append(actions);
    const body = document.createElement('div');
    root.append(style, head, body);
    container.append(root);
    let disposed = false;
    const update = (status) => {
        if (disposed)
            return;
        body.replaceChildren();
        if (status.kind === 'pending') {
            root.dataset.state = 'pending';
            state.dataset.state = 'pending';
            // 明确写出「尚未返回」：这里不能出现任何等于「已就绪」的符号。
            state.textContent = '正在检查…（结果尚未返回）';
            return;
        }
        if (status.kind === 'error') {
            root.dataset.state = 'error';
            state.dataset.state = 'error';
            state.textContent = '检查失败';
            const reason = document.createElement('div');
            reason.className = 'dsh-diag__detail';
            reason.textContent = status.reason;
            body.append(reason);
            return;
        }
        const view = buildPanelView(status.snapshot);
        root.dataset.state = 'ready';
        state.dataset.state = 'ready';
        state.textContent = view.ok ? '已就绪' : '发现问题';
        title.textContent = view.title;
        for (const group of view.groups) {
            const section = document.createElement('section');
            section.className = 'dsh-diag__group';
            section.dataset.group = group.group;
            const name = document.createElement('div');
            name.className = 'dsh-diag__group-name';
            name.textContent = group.group;
            section.append(name);
            for (const row of group.rows)
                section.append(renderRow(document, row));
            body.append(section);
        }
    };
    return {
        element: root,
        update,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            while (cleanups.length > 0)
                cleanups.pop()?.();
            root.remove();
        }
    };
}
