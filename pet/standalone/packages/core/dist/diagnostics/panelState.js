/**
 * 诊断刷新控制器。
 *
 * 与 ModuleLoader 的迟到 resolve 同构：连续刷新时，先发起的请求可能后回来。
 * 每次发起递增 generation，回来后比对；不匹配就整包丢弃，不写状态、不渲染。
 */
export function createPanelController(options) {
    let current = { kind: 'pending' };
    let generation = 0;
    let disposed = false;
    const publish = (next) => {
        current = next;
        options.render(next);
    };
    return {
        async refresh() {
            if (disposed)
                return;
            generation += 1;
            const mine = generation;
            // 新一轮一开始就回到 pending：上一轮的值已经不是最新事实。
            if (current.kind !== 'pending')
                publish({ kind: 'pending' });
            try {
                const snapshot = await options.load();
                if (disposed || mine !== generation)
                    return;
                publish({ kind: 'ready', snapshot });
            }
            catch (error) {
                if (disposed || mine !== generation)
                    return;
                publish({ kind: 'error', reason: error instanceof Error ? error.message : String(error) });
            }
        },
        status: () => current,
        generation: () => generation,
        dispose() {
            disposed = true;
            // 作废所有在途请求：回来也不会再写状态。
            generation += 1;
        }
    };
}
