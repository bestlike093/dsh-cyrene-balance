/**
 * 桌面主进程 IPC 注册契约。
 *
 * 每条 invoke 通道只暴露「名字 + 入参形状」，由注册表门禁与快照共同锁定；
 * 名字改动或参数顺序变化都应当让快照失败，而不是等到渲染侧运行时才发现。
 */
export interface IpcChannelContract {
    readonly channel: string;
    readonly params: readonly string[];
}
/** 互斥通道的忙响应：第二次并发 invoke 直接拒绝，不启动第二份副作用。 */
export interface BusyResult {
    readonly ok: false;
    readonly reason: 'busy';
}
