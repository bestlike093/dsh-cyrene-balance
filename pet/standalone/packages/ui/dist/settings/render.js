/**
 * 设置界面渲染（纯 DOM，零依赖）
 *
 * 硬约束：
 * - ⛔ 禁止 innerHTML 拼接 —— 所有文本走 textContent（注入面，见 10.1b/d）
 * - ⛔ 不引用任何宿主 API（无 Electron / IPC / dsh）
 * - ✅ 返回 dispose()，必须清理全部监听器（否则模块卸载时泄漏）
 * - ✅ 只读态「可见」—— 不只禁用，还要显示原因（降级状态可见）
 * - ✅ 凭据「从不持有」—— sensitive 字段的输入直接交给上层，不写进 values。
 *      零窗口，比「提交后清除」强一个量级：后者存在从输入到清除的泄漏期。
 */
/**
 * 敏感字段：凭据类。值不得进入 values，也不得回填到 DOM。
 * 单独导出，便于测试直接断言这条判定，不必起 DOM。
 */
export function isSensitiveField(f) {
    return f.sensitive === true || f.kind === 'key';
}
/** 已保存态的占位符。静态常量，不是从存储读出来的。 */
const SAVED_PLACEHOLDER = '••••••••（已保存）';
const EMPTY_PLACEHOLDER = '未设置';
function el(tag, className) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    return node;
}
/** 错误提示节点：按字段定位，支持多条（不对错误文本做 innerHTML） */
function setFieldError(container, messages) {
    const box = container.querySelector('[data-role="error"]');
    if (!box)
        return;
    box.textContent = '';
    for (const m of messages) {
        const li = el('li');
        li.textContent = m;
        box.appendChild(li);
    }
    box.hidden = messages.length === 0;
}
export function renderSettings(root, registry, options = {}) {
    const cleanups = [];
    // values 的键集合 = 全部非敏感字段。敏感字段连 initial 都不接受，
    // 这样 read() 的键集合是确定的，测试可以用「恰等」而不是「不含某键」。
    const values = new Map();
    for (const { fields } of registry.grouped()) {
        for (const f of fields) {
            if (isSensitiveField(f))
                continue;
            values.set(f.id, options.initial?.[f.id] ?? '');
        }
    }
    for (const { group, fields } of registry.grouped()) {
        const section = el('section', 'settings-group');
        section.dataset.group = group.id;
        const title = el('h2', 'settings-group-title');
        title.textContent = group.label;
        section.appendChild(title);
        for (const f of fields) {
            section.appendChild(renderField(f, values, cleanups, options));
        }
        root.appendChild(section);
    }
    return {
        dispose() {
            for (const c of cleanups)
                c();
            cleanups.length = 0;
            root.textContent = '';
        },
        read() {
            return Object.freeze(Object.fromEntries(values));
        }
    };
}
function renderField(f, values, cleanups, options) {
    const row = el('div', 'settings-field');
    row.dataset.field = f.id;
    const label = el('label', 'settings-field-label');
    label.textContent = f.label;
    label.htmlFor = `settings-${f.id}`;
    row.appendChild(label);
    const errorBox = el('ul', 'settings-field-error');
    errorBox.dataset.role = 'error';
    errorBox.hidden = true;
    // 只读态：禁用 + 显示原因（缺一不可）
    if (f.readonly === true) {
        const input = el('input', 'settings-input');
        input.id = `settings-${f.id}`;
        input.disabled = true;
        input.type = 'text';
        input.value = values.get(f.id) ?? '';
        row.appendChild(input);
        const reason = el('p', 'settings-field-reason');
        reason.textContent = f.readonlyReason ?? '当前不可用';
        row.appendChild(reason);
        row.appendChild(errorBox);
        return row;
    }
    // 凭据字段：不回填、不写 values、不留副本
    if (isSensitiveField(f)) {
        const input = el('input', 'settings-input');
        input.id = `settings-${f.id}`;
        input.type = 'password';
        input.value = '';
        const status = options.sensitiveStatus?.[f.id];
        input.placeholder = status?.saved === true ? SAVED_PLACEHOLDER : EMPTY_PLACEHOLDER;
        const onInput = () => {
            // 值直接交给上层，渲染层不保留
            options.onSensitiveInput?.(f.id, input.value);
        };
        input.addEventListener('input', onInput);
        cleanups.push(() => input.removeEventListener('input', onInput));
        row.appendChild(input);
        const statusLine = el('p', 'settings-field-status');
        statusLine.dataset.role = 'status';
        statusLine.textContent =
            status?.saved === true
                ? status.savedAt === undefined
                    ? '已保存'
                    : `已保存 · ${status.savedAt}`
                : '未设置';
        row.appendChild(statusLine);
        if (f.hint) {
            const hint = el('p', 'settings-field-hint');
            hint.textContent = f.hint;
            row.appendChild(hint);
        }
        row.appendChild(errorBox);
        return row;
    }
    if (f.kind === 'select') {
        const select = el('select', 'settings-input');
        select.id = `settings-${f.id}`;
        for (const opt of f.options ?? []) {
            const o = el('option');
            o.value = opt.value;
            o.textContent = opt.label;
            select.appendChild(o);
        }
        const onChange = () => {
            values.set(f.id, select.value);
        };
        select.addEventListener('change', onChange);
        cleanups.push(() => select.removeEventListener('change', onChange));
        row.appendChild(select);
    }
    else {
        const input = el('input', 'settings-input');
        input.id = `settings-${f.id}`;
        input.type = 'text';
        input.value = values.get(f.id) ?? '';
        const onInput = () => {
            values.set(f.id, input.value);
            if (f.validate) {
                // 空数组 = 通过。取提示优先用 hint（面向一般人），没有再退回错误码。
                const errs = f.validate(input.value);
                setFieldError(row, errs.map((e) => e.hint ?? e.reason));
            }
        };
        input.addEventListener('input', onInput);
        cleanups.push(() => input.removeEventListener('input', onInput));
        row.appendChild(input);
    }
    if (f.hint) {
        const hint = el('p', 'settings-field-hint');
        hint.textContent = f.hint;
        row.appendChild(hint);
    }
    row.appendChild(errorBox);
    return row;
}
