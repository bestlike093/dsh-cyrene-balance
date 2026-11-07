/**
 * 带 TTL 的结果缓存。
 *
 * 来自宿主 builtin-tools/ttl-result-cache 的做法：同类查询在一次会话里
 * 会连着来好几次（问完天气问穿衣、问完汇率问换算），每次都打一次外部
 * 接口既慢又费额度。缓存按 key 存，过期就丢，不做持久化。
 *
 * 两个刻意保留的约束：
 *
 * 1. 时间由外部注入，不读 Date.now()。测试要能精确控制「过期」这件事，
 *    否则只能靠 sleep 等真实时间，慢且不稳。
 * 2. 同一个 key 的并发请求只放一个人去打，其余等结果。否则缓存反而
 *    放大了瞬时并发——第一次请求还没回来时，后面几个都是 miss。
 */
export interface CacheEntry<T> {
    readonly value: T;
    readonly expiresAt: number;
}
export interface CacheOptions {
    /** 缓存条数上限，超出时先清过期的，再按插入顺序淘汰最旧的。默认 128。 */
    readonly maxEntries?: number;
}
export declare class TtlCache<T> {
    private readonly now;
    private readonly entries;
    private readonly inflight;
    private readonly maxEntries;
    constructor(now: () => number, options?: CacheOptions);
    /** 命中且未过期返回值，否则 null。过期的条目顺手清掉。 */
    get(key: string): T | null;
    set(key: string, value: T, ttlMs: number): void;
    delete(key: string): boolean;
    clear(): void;
    get size(): number;
    /** 清掉所有已过期条目，返回清掉的条数。 */
    prune(): number;
    /**
     * 取值，没有就调 `load` 去拿。
     *
     * `load` 抛错时不写缓存，也不留痕——下一次调用会重新尝试。
     * 失败结果不能被缓存成「成功」，否则一次网络抖动会让空值活很久。
     */
    remember(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
    private evict;
}
