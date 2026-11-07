/** 逆序释放：后注册的先拆，符合资源依赖方向。单个释放失败不阻断其余清理。 */
export function createDisposerRegistry() {
    const disposers = [];
    return {
        add(fn) {
            disposers.push(fn);
        },
        disposeAll() {
            while (disposers.length > 0) {
                const fn = disposers.pop();
                if (fn === undefined)
                    continue;
                try {
                    fn();
                }
                catch {
                    // 单个释放失败不阻断其余清理
                }
            }
        }
    };
}
