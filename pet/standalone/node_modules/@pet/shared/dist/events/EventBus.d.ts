export type Listener<T> = (payload: T) => void;
/**
 * 类型安全事件总线。
 * 单个监听器抛错不影响其他监听器，也不向上冒泡打断主循环。
 */
export declare class EventBus<Events extends Record<string, unknown>> {
    private readonly listeners;
    on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void;
    off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void;
    emit<K extends keyof Events>(type: K, payload: Events[K]): void;
    count(type?: keyof Events): number;
    clear(): void;
}
