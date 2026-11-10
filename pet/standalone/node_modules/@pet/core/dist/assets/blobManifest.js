/**
 * 内容寻址的 blob 清单。
 *
 * SHA 相同只代表字节相同，不代表语义相同：同一份内容可以被多个名字引用。
 * 删除必须走 removeRef，直到 refs 为空才释放 blob。
 */
export class BlobManifest {
    entries = new Map();
    inFlight = new Map();
    addRef(sha256, ref, size, now = Date.now()) {
        const existing = this.entries.get(sha256);
        if (existing === undefined) {
            this.entries.set(sha256, { sha256, size, refs: [ref], createdAt: now });
            return { created: true, refCount: 1 };
        }
        if (!existing.refs.includes(ref)) {
            existing.refs.push(ref);
        }
        return { created: false, refCount: existing.refs.length };
    }
    removeRef(sha256, ref) {
        const existing = this.entries.get(sha256);
        if (existing === undefined)
            return { removedBlob: false, refCount: 0 };
        const index = existing.refs.indexOf(ref);
        if (index >= 0)
            existing.refs.splice(index, 1);
        if (existing.refs.length === 0) {
            this.entries.delete(sha256);
            return { removedBlob: true, refCount: 0 };
        }
        return { removedBlob: false, refCount: existing.refs.length };
    }
    refsOf(sha256) {
        return this.entries.get(sha256)?.refs ?? [];
    }
    has(sha256) {
        return this.entries.has(sha256);
    }
    get blobCount() {
        return this.entries.size;
    }
    get refCount() {
        let total = 0;
        for (const entry of this.entries.values())
            total += entry.refs.length;
        return total;
    }
    /**
     * 同一个 hash 的写 blob 只跑一次；后到的调用等第一个完成。
     * 解决并发上传「都未命中 → 都写 blob」的竞态。
     */
    async withBlob(sha256, producer) {
        const running = this.inFlight.get(sha256);
        if (running !== undefined)
            return running;
        const task = (async () => {
            await producer();
        })();
        this.inFlight.set(sha256, task);
        try {
            await task;
        }
        finally {
            this.inFlight.delete(sha256);
        }
    }
}
