/** 状态到提示的映射。`disposed` 不提示——模型已释放，提示会盖在下一个模型上。 */
export function noticeFor(state) {
    switch (state) {
        case 'idle':
        case 'loading':
            return 'loading';
        case 'failed':
            return 'failed';
        case 'ready':
        case 'disposed':
            return 'none';
    }
}
export function createRenderNoticePump(target) {
    let current = 'none';
    let disposed = false;
    return {
        get current() {
            return current;
        },
        push(state) {
            if (disposed)
                return false;
            const next = noticeFor(state);
            if (next === current)
                return false;
            current = next;
            if (next === 'none')
                target.hide();
            else
                target.show(next);
            return true;
        },
        dispose() {
            disposed = true;
        }
    };
}
