/**
 * 按 sender + 会话登记的订阅登记簿。聊天与语音共用同一副骨架。
 *
 * 契约：
 * - 先删后放行：dispose 先移除登记，再逐条释放；异步帧查不到旧 id。
 * - 异常安全：单条释放抛错不阻断其余，错误聚合后抛，不静默吞掉。
 * - 双键粒度：dispose(sender, convId) 只关一个会话的流；dispose(sender) 才是窗口销毁。
 */
export type Dispose = () => void;
export declare class SubscriptionRegistry {
    private readonly registry;
    add(senderId: number, dispose: Dispose): void;
    addConversation(senderId: number, convId: string, dispose: Dispose): void;
    remove(senderId: number, dispose: Dispose): void;
    dispose(senderId: number, convId?: string): void;
    has(senderId: number, convId?: string): boolean;
    size(senderId: number, convId?: string): number;
    senderIds(): number[];
    reset(): void;
    private release;
    private throwIfFailed;
}
