/**
 * 表现层共享广播（S7-b）。
 *
 * 主窗与子窗共用同一条通道：主窗持有 Publisher 一侧，子窗只拿 Subscriber 一侧。
 * 类型层就没有上行入口，所以「子窗反向改主窗主题」不是靠约定拦住的。
 *
 * 订阅端按 patch 覆盖语义理解（幂等），即使将来真的重复推送也无害。
 */
export class PresentationBus {
    listeners = new Set();
    /** 唯一推送出口；所有向下分发都从这里出去。 */
    async publish(patch) {
        for (const listener of [...this.listeners])
            listener(patch);
    }
    /** 返回取消函数；模块卸载时必须调用，否则监听器泄漏。 */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    /** 诊断用：当前监听器数量。 */
    listenerCount() {
        return this.listeners.size;
    }
}
