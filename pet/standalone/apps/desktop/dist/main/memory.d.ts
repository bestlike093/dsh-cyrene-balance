export interface MemoryTurn {
    role: string;
    text: string;
    /** 「前天 21:40」这种人话时间；由调用方算好，存储层不认识日期。 */
    when?: string;
}
export interface MemoryDigestInput {
    enabled: boolean;
    available: boolean;
    count: number;
    items: ReadonlyArray<MemoryTurn>;
    historyLength: number;
    /** 当前这句话；给了就按相关度挑，不给就保持「全部较早片段」。 */
    query?: string;
    /** 相关度模式下最多挑几条。 */
    limit?: number;
}
export declare function buildMemoryDigest(input: MemoryDigestInput): string;
