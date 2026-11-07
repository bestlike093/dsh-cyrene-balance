/**
 * 外部服务密钥写通道：set / clear。
 *
 * 生命周期只有一条线：磁盘是唯一真相。
 * - `VaultServiceSecretStore` 没有内存缓存、没有 TTL；每次 set/clear 都是
 *   `load → 改 → save`，进程内明文只在 get 的返回值里短暂存在。
 * - clear 先判断 key 是否存在，不存在时不写盘、不审计；save 失败时磁盘仍是旧值。
 * - 重启后由 `new VaultServiceSecretStore(vault)` 从加密文件重建，不存在
 *   「内存已清、磁盘还在」的中间态。
 *
 * 已知限制：set / clear 是整文件 read-modify-write，并发写不同 service 时
 * 后写者可能基于旧快照覆盖前者。当前调用方是设置页单次点击，暂不加锁。
 */
export interface SecretChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    requireSecretStore: () => {
        set: (serviceId: string, value: string, field?: string) => Promise<void>;
        clear: (serviceId: string, field?: string) => Promise<void>;
    };
    /**
     * 某个服务的凭据落盘后通知宿主。
     * 通道连接持有的是解密后的旧值，必须在写入后重建才能用上新 AppSecret。
     */
    onSecretChanged?: (serviceId: string) => void;
}
export declare function registerSecretChannels(deps: SecretChannelDeps): void;
