import { PermissionBroker } from './permissionBroker.js';
import { PetalRegistry } from './petalRegistry.js';
import type { SandboxPorts } from './moduleSandbox.js';
import type { DegradeMode, HostCapabilitySnapshot } from './hostCapability.js';
import type { ModuleLoader } from './moduleLoader.js';
import { Scheduler } from '../schedule/scheduler.js';
export { createDisposerRegistry } from './disposer.js';
/**
 * 模块运行状态。
 *
 * `degraded` 与 `failed` 分开：降级是「宿主条件不足，模块按约定收窄功能」，
 * 不是故障。诊断面板不应把它记成错误，否则纯插件形态会长期红着。
 *
 * 状态只能经由宿主的 `transition()` 改写，模块自己拿不到写入口 ——
 * 一个模块卡在非法状态里，不该把整轮启动带崩。
 */
export type ModuleStatus = 'unloaded' | 'loading' | 'ready' | 'degraded' | 'stopping' | 'stopped' | 'failed' | 'disabled';
export interface ModuleRuntime {
    readonly id: string;
    readonly status: ModuleStatus;
    readonly code?: string;
    readonly message?: string;
    /** 降级模式；仅在 `status === 'degraded'` 且因能力缺失时有值。 */
    readonly degradeMode?: DegradeMode;
}
export interface PlaceholderInfo {
    readonly id: string;
    readonly name: string;
    readonly code: string;
    readonly message: string;
}
/** 占位卡句柄：teardown 必须清掉节点与自身挂的监听器。 */
export interface PlaceholderHandle {
    teardown(): void;
}
export type PlaceholderResult = PlaceholderHandle | (() => void) | void;
/** 返回清理句柄或清理函数；宿主在模块恢复或停止时调用。 */
export type PlaceholderFactory = (info: PlaceholderInfo, root: ShadowRoot) => PlaceholderResult;
/** 渲染层向宿主申请窗口尺寸的入口。纯插件形态下没有这个端口。 */
export interface ShellPort {
    /** 按内容自适应窗口。`fixed` 降级时不得调用。 */
    resizeToContent(): void;
}
/** 布局指令：`fixed` 时给固定画布，其余交给宿主。 */
export type LayoutDirective = {
    readonly mode: 'host-managed';
} | {
    readonly mode: 'fixed-canvas';
    readonly width: number;
    readonly height: number;
};
/** 固定画布尺寸，与渲染层默认舞台一致。 */
export declare const FIXED_CANVAS_SIZE: {
    readonly width: 300;
    readonly height: 150;
};
/** 让服务停下来的原因。带上模块 id，界面才能说清楚是哪一块出了问题。 */
export interface ServiceStopReason {
    readonly moduleId: string;
    readonly code: string;
    readonly message: string;
}
/** 写操作结果。拒绝必须带原因，不能返回 undefined 让调用方以为写成功了。 */
export type WriteResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: 'READONLY_DEGRADED';
    readonly message: string;
};
export interface ModuleHostOptions {
    /** 模块挂载点。桌面壳传真实的 ShadowRoot，测试传替身。 */
    readonly root: ShadowRoot;
    readonly timeoutMs?: number;
    readonly scheduler?: Scheduler;
    /** 可选的沙箱端口；不提供时模块调用对应能力会得到 NOT_SUPPORTED */
    readonly sandboxPorts?: SandboxPorts;
    /**
     * 宿主能力快照。不传时视为「宿主未探测」，声明了 hostCapabilities 的模块
     * 一律降级为占位，避免乐观放行。
     */
    readonly hostCapabilities?: HostCapabilitySnapshot;
    /** 自定义占位渲染；不提供时用内置 DOM 实现（非 DOM 环境自动跳过）。 */
    readonly placeholder?: PlaceholderFactory;
    /**
     * 懒加载入口。注册表里没有该 id 时，从这里取模块。
     * 调用方只依赖 loader.load(id)，将来换真 import() 不用改 ModuleHost。
     */
    readonly loader?: ModuleLoader;
    /** 宿主窗口控制入口。纯插件形态不提供，`fixed` 降级也不会走到它。 */
    readonly shell?: ShellPort;
    /**
     * 核心模块失败时的通知。
     *
     * 宿主自己不负责「停输入 / 停模型 / 停网络出口」这些具体动作 ——
     * 它只负责宣布「服务已停止」，把原因交出去，由壳层执行。
     * 这样纯插件形态也能拿到同一个信号。
     */
    readonly onServiceStop?: (reason: ServiceStopReason) => void;
}
/**
 * 模块宿主：负责 bootstrap / teardown 与失败隔离。
 * 单个模块启动失败只把该模块标成 failed 并留下占位，不影响其他模块运行。
 */
export declare class ModuleHost {
    private readonly registry;
    private readonly permissions;
    private readonly options;
    private readonly scheduler;
    private readonly runtimes;
    private readonly placeholders;
    /** 一旦有核心模块失败就记下来，之后不再覆盖 —— 第一条原因才有诊断价值。 */
    private serviceStopReason?;
    constructor(registry: PetalRegistry, permissions: PermissionBroker, options: ModuleHostOptions);
    get timeoutMs(): number;
    /** `stopped` 表示有核心模块失败，整体服务已停。 */
    get serviceState(): 'running' | 'stopped';
    /** 停服原因；服务正常时为 undefined。 */
    get stopReason(): ServiceStopReason | undefined;
    start(id: string): Promise<boolean>;
    /**
     * 按注册顺序启动全部模块。
     * 禁用模块记为 disabled，失败模块留占位；任何单个模块都不阻断整轮启动。
     */
    startAll(): Promise<readonly ModuleRuntime[]>;
    /** 注册表与 loader 的已知 id 合并；loader 让 startAll 也能启动未注册的懒加载模块。 */
    private startIds;
    /** 幂等：未启动过的模块直接返回 false，已停止的返回 true。 */
    stop(id: string): Promise<boolean>;
    stopAll(): Promise<void>;
    statuses(): readonly ModuleRuntime[];
    /**
     * 在模块自己的边界里跑一段回调。
     *
     * 宿主分发事件、定时器、DOM 监听时统一走这里：抛错只把这个模块标成 failed，
     * 不向上冒泡，同轮里的其他模块照常跑。
     *
     * 已停止或禁用的模块不做状态变更 —— 那种情况下的异常可能只是清理残留，
     * 把死掉的模块再判一次 failed，只会让诊断面板长期红着。
     */
    runGuarded(id: string, fn: () => void): boolean;
    /** 当前可见占位的模块 id，供诊断面板与测试核对。 */
    placeholderIds(): readonly string[];
    /**
     * 布局指令。`fixed` 降级下直接返回固定画布，**不触碰宿主窗口接口** ——
     * 纯插件形态没有窗口控制权，这条路径必须能独立成立。
     */
    applyLayout(id: string): LayoutDirective;
    /**
     * 代模块执行写操作。`readonly` 降级下拒绝写入并给出原因，
     * 不把写请求悄悄丢掉 —— 静默丢弃会让用户以为已经保存。
     */
    requestWrite(id: string, apply: () => void): WriteResult;
    /** 诊断面板用：把状态压成一行，避免面板层自己拼字符串。 */
    describe(): string;
    /**
     * 核心模块失败 → 宣布服务停止。
     *
     * 只认第一原因：后面接着崩的模块多半是第一块倒下的连锁反应，
     * 覆盖掉首因，诊断就没法定位了。
     */
    private noteServiceImpact;
    /** 尚未就绪的依赖 id。空数组表示全部就绪；未注册的依赖同样算未就绪。 */
    private unreadyDependencies;
    /**
     * 唯一的状态写入口。
     *
     * 非法跳转不抛错：抛出去会把整轮启动带崩，而一个模块卡在坏状态里
     * 本来就不该影响别人。这里把它留在原状态并记下原因，交给诊断去报。
     */
    private transition;
    private resolveEntry;
    /** 连模块对象都没拿到时的失败路径：仍要留下 failed 状态和占位。 */
    private failDetached;
    private fail;
    private renderPlaceholder;
    private renderPlaceholderFor;
    private clearPlaceholder;
}
