const DEFAULT_CONVERSATION = '';
export class SubscriptionRegistry {
    registry = new Map();
    add(senderId, dispose) {
        this.addConversation(senderId, DEFAULT_CONVERSATION, dispose);
    }
    addConversation(senderId, convId, dispose) {
        let conversations = this.registry.get(senderId);
        if (conversations === undefined) {
            conversations = new Map();
            this.registry.set(senderId, conversations);
        }
        let set = conversations.get(convId);
        if (set === undefined) {
            set = new Set();
            conversations.set(convId, set);
        }
        set.add(dispose);
    }
    remove(senderId, dispose) {
        const conversations = this.registry.get(senderId);
        if (conversations === undefined)
            return;
        for (const [convId, set] of conversations) {
            set.delete(dispose);
            if (set.size === 0)
                conversations.delete(convId);
        }
        if (conversations.size === 0)
            this.registry.delete(senderId);
    }
    dispose(senderId, convId) {
        const conversations = this.registry.get(senderId);
        if (conversations === undefined)
            return;
        if (convId !== undefined) {
            const set = conversations.get(convId);
            if (set === undefined)
                return;
            conversations.delete(convId);
            if (conversations.size === 0)
                this.registry.delete(senderId);
            this.throwIfFailed(senderId, this.release(set));
            return;
        }
        this.registry.delete(senderId);
        const failures = [];
        for (const set of conversations.values()) {
            failures.push(...this.release(set));
        }
        this.throwIfFailed(senderId, failures);
    }
    has(senderId, convId) {
        const conversations = this.registry.get(senderId);
        if (conversations === undefined)
            return false;
        if (convId === undefined)
            return conversations.size > 0;
        return conversations.has(convId);
    }
    size(senderId, convId) {
        const conversations = this.registry.get(senderId);
        if (conversations === undefined)
            return 0;
        if (convId !== undefined)
            return conversations.get(convId)?.size ?? 0;
        let total = 0;
        for (const set of conversations.values())
            total += set.size;
        return total;
    }
    senderIds() {
        return [...this.registry.keys()];
    }
    reset() {
        this.registry.clear();
    }
    release(set) {
        const failures = [];
        for (const dispose of set) {
            try {
                dispose();
            }
            catch (error) {
                failures.push(error);
            }
        }
        return failures;
    }
    throwIfFailed(senderId, failures) {
        if (failures.length === 0)
            return;
        throw new AggregateError(failures, `订阅释放失败：sender ${senderId} 有 ${failures.length} 条监听器抛错`);
    }
}
