export interface ManifestEntry {
    readonly sha256: string;
    readonly size: number;
    /** 指向同一份字节的引用名；删到只剩零个才允许移除 blob。 */
    readonly refs: string[];
    readonly createdAt: number;
}
export interface AddRefResult {
    readonly created: boolean;
    readonly refCount: number;
}
/**
 * 内容寻址的 blob 清单。
 *
 * SHA 相同只代表字节相同，不代表语义相同：同一份内容可以被多个名字引用。
 * 删除必须走 removeRef，直到 refs 为空才释放 blob。
 */
export declare class BlobManifest {
    private readonly entries;
    private readonly inFlight;
    addRef(sha256: string, ref: string, size: number, now?: number): AddRefResult;
    removeRef(sha256: string, ref: string): {
        removedBlob: boolean;
        refCount: number;
    };
    refsOf(sha256: string): readonly string[];
    has(sha256: string): boolean;
    get blobCount(): number;
    get refCount(): number;
    /**
     * 同一个 hash 的写 blob 只跑一次；后到的调用等第一个完成。
     * 解决并发上传「都未命中 → 都写 blob」的竞态。
     */
    withBlob(sha256: string, producer: () => Promise<void>): Promise<void>;
}
