/**
 * 类型安全事件总线。
 * 单个监听器抛错不影响其他监听器，也不向上冒泡打断主循环。
 */
export class EventBus {
    listeners = new Map();
    on(type, listener) {
        let set = this.listeners.get(type);
        if (set === undefined) {
            set = new Set();
            this.listeners.set(type, set);
        }
        set.add(listener);
        return () => {
            this.off(type, listener);
        };
    }
    off(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }
    emit(type, payload) {
        const set = this.listeners.get(type);
        if (set === undefined || set.size === 0)
            return;
        for (const listener of [...set]) {
            try {
                ;
                listener(payload);
            }
            catch {
                // 单个监听器失败不阻断其他监听器
            }
        }
    }
    count(type) {
        if (type === undefined) {
            let total = 0;
            for (const set of this.listeners.values())
                total += set.size;
            return total;
        }
        return this.listeners.get(type)?.size ?? 0;
    }
    clear() {
        this.listeners.clear();
    }
}
//# sourceMappingURL=EventBus.js.map