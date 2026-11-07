/*
 * 样式全部内联，只读 --dsh-placeholder-* 变量。
 * 模块失败时它的 ShadowRoot 可能压根没建起来，
 * 占位卡不能指望模块样式表存在。
 */
const CARD_STYLE = [
    'display:flex',
    'flex-direction:column',
    'gap:6px',
    'padding:12px 14px',
    'border-radius:12px',
    'border:1px solid var(--dsh-placeholder-border, #f0c9d8)',
    'background:var(--dsh-placeholder-bg, #fff7fa)',
    'color:var(--dsh-placeholder-fg, #3b2b33)',
    'font:13px/1.5 system-ui, sans-serif'
].join(';');
const TITLE_STYLE = 'font-weight:600';
const REASON_STYLE = 'opacity:.85';
const CODE_STYLE = 'font-family:ui-monospace, monospace;opacity:.6';
const ACTIONS_STYLE = 'display:flex;gap:8px;margin-top:2px';
const BUTTON_STYLE = [
    'border:1px solid var(--dsh-placeholder-border, #f0c9d8)',
    'background:transparent',
    'color:inherit',
    'border-radius:8px',
    'padding:2px 10px',
    'font:inherit',
    'cursor:pointer'
].join(';');
/**
 * 宿主统一渲染的占位卡。
 *
 * 监听器与节点都归这张卡自己管：teardown 先摘监听器再移除节点，
 * 传了 disposers 时由宿主在停止模块时统一释放。
 */
export function createPlaceholderCard(options) {
    const document = options.document;
    const { info } = options;
    const card = document.createElement('div');
    card.setAttribute('data-petal-placeholder', info.id);
    card.setAttribute('role', 'status');
    card.style.cssText = CARD_STYLE;
    const title = document.createElement('div');
    title.style.cssText = TITLE_STYLE;
    title.textContent = `${info.name} 暂不可用`;
    const reason = document.createElement('div');
    reason.style.cssText = REASON_STYLE;
    reason.textContent = info.message;
    const code = document.createElement('div');
    code.style.cssText = CODE_STYLE;
    code.textContent = info.code;
    card.append(title, reason, code);
    const cleanups = [];
    const listen = (button, handler) => {
        button.addEventListener('click', handler);
        cleanups.push(() => {
            button.removeEventListener('click', handler);
        });
    };
    const actions = document.createElement('div');
    actions.style.cssText = ACTIONS_STYLE;
    if (options.onRetry !== undefined) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重试';
        retry.style.cssText = BUTTON_STYLE;
        listen(retry, options.onRetry);
        actions.append(retry);
    }
    if (options.onDiagnose !== undefined) {
        const diagnose = document.createElement('button');
        diagnose.type = 'button';
        diagnose.textContent = '查看诊断';
        diagnose.style.cssText = BUTTON_STYLE;
        listen(diagnose, options.onDiagnose);
        actions.append(diagnose);
    }
    if (actions.childElementCount > 0)
        card.append(actions);
    let disposed = false;
    const teardown = () => {
        if (disposed)
            return;
        disposed = true;
        // 先摘监听器，再移除节点：晚到的回调也不会打到已经没有容器的卡上。
        while (cleanups.length > 0)
            cleanups.pop()?.();
        card.remove();
    };
    options.disposers?.add(teardown);
    return { element: card, teardown };
}
