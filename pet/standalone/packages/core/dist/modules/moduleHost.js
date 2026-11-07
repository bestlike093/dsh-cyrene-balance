import { ErrorCode, PetError, isPetError } from '@pet/shared';
import { PermissionBroker } from './permissionBroker.js';
import { PetalRegistry } from './petalRegistry.js';
import { createDisposerRegistry } from './disposer.js';
import { createSandboxContext, installRealmNetworkGuard } from './moduleSandbox.js';
import { evaluateModuleHost } from './hostCapability.js';
import { createPlaceholderCard } from './placeholderCard.js';
import { Scheduler } from '../schedule/scheduler.js';
export { createDisposerRegistry } from './disposer.js';
/**
 * 合法跳转表。
 *
 * 这张表是「状态由宿主统一维护」的落地形式：不在表里的跳转一律拒绝，
 * 而不是靠各调用点自觉。新增状态必须同时补这里，否则编译失败。
 */
const ALLOWED_TRANSITIONS = {
    // 刚解析出来，还没尝试启动；也允许被直接取消
    unloaded: ['loading', 'stopping', 'disabled'],
    loading: ['ready', 'degraded', 'failed', 'stopping'],
    ready: ['stopping', 'degraded', 'failed'],
    // 降级之后仍可能恢复，也可能直接被停掉
    degraded: ['ready', 'stopping', 'failed'],
    stopping: ['stopped', 'failed'],
    // 停掉之后允许重新启用
    stopped: ['loading', 'disabled'],
    // 失败允许重试，也允许直接放弃
    failed: ['loading', 'stopping', 'stopped', 'disabled'],
    disabled: ['unloaded', 'loading']
};
/** 固定画布尺寸，与渲染层默认舞台一致。 */
export const FIXED_CANVAS_SIZE = { width: 300, height: 150 };
/**
 * 内置占位：与宿主容器同源渲染，样式自足，不依赖失败模块的 ShadowRoot。
 * 非 DOM 环境（单测 / 主进程）直接跳过，不影响生命周期。
 */
function defaultPlaceholder(info, root) {
    const document = root.ownerDocument;
    if (document === undefined || typeof document.createElement !== 'function')
        return;
    return createPlaceholderCard({ document, info });
}
function toCleanup(result) {
    if (result === undefined)
        return undefined;
    if (typeof result === 'function')
        return result;
    return () => {
        result.teardown();
    };
}
/**
 * 模块宿主：负责 bootstrap / teardown 与失败隔离。
 * 单个模块启动失败只把该模块标成 failed 并留下占位，不影响其他模块运行。
 */
export class ModuleHost {
    registry;
    permissions;
    options;
    scheduler;
    runtimes = new Map();
    placeholders = new Map();
    /** 一旦有核心模块失败就记下来，之后不再覆盖 —— 第一条原因才有诊断价值。 */
    serviceStopReason;
    constructor(registry, permissions, options) {
        this.registry = registry;
        this.permissions = permissions;
        this.options = options;
        this.scheduler = options.scheduler ?? new Scheduler();
    }
    get timeoutMs() {
        return this.options.timeoutMs ?? 5_000;
    }
    /** `stopped` 表示有核心模块失败，整体服务已停。 */
    get serviceState() {
        return this.serviceStopReason === undefined ? 'running' : 'stopped';
    }
    /** 停服原因；服务正常时为 undefined。 */
    get stopReason() {
        return this.serviceStopReason;
    }
    async start(id) {
        let entry;
        try {
            entry = await this.resolveEntry(id);
        }
        catch (error) {
            const code = isPetError(error) ? error.code : ErrorCode.LOAD_FAILED;
            const message = error instanceof Error ? error.message : String(error);
            this.failDetached(id, code, message);
            return false;
        }
        if (entry.config.enabled === false) {
            this.runtimes.set(id, { module: entry.module, config: entry.config, status: 'disabled' });
            this.clearPlaceholder(id);
            return false;
        }
        const existing = this.runtimes.get(id);
        const missingDependencies = this.unreadyDependencies(entry.module.meta);
        // 已经 ready 且依赖仍然就绪，直接返回。
        // 依赖在启动之后被停掉的情况也要复查 —— 状态挂 ready 但实际用不了，
        // 比直接降级更糟，因为没人会去修。
        if (existing?.status === 'ready' && missingDependencies.length === 0)
            return true;
        // 依赖先于能力：缺了别的模块，宿主能力再齐也起不来。
        // 缺依赖只降级自己，不阻断其他模块 —— 这是「互不影响」的第一条。
        if (missingDependencies.length > 0) {
            const detail = missingDependencies
                .map((dep) => `${dep}=${this.runtimes.get(dep)?.status ?? 'unregistered'}`)
                .join(', ');
            this.runtimes.set(id, {
                module: entry.module,
                config: entry.config,
                status: 'degraded',
                code: 'DEPENDENCY_MISSING',
                message: `依赖未就绪：${detail}`
            });
            this.clearPlaceholder(id);
            return false;
        }
        const snapshot = this.options.hostCapabilities;
        const compatibility = evaluateModuleHost(entry.module.meta, snapshot ?? { version: '0.0.0-unknown', available: [] });
        if (!compatibility.ok) {
            // 没传快照 = 宿主未探测。这时「缺能力」是未知而非已知，
            // 一律按可见降级处理，避免把「不知道」当成「确定没有」而静默吞掉。
            if (snapshot === undefined) {
                this.fail(id, entry, ErrorCode.NOT_SUPPORTED, compatibility.message ?? '宿主能力未探测');
                return false;
            }
            // 形态不适用：模块本就不该在这个宿主里存在，静默不启，不占位、不记失败。
            if (compatibility.reason === 'not-applicable') {
                this.runtimes.set(id, {
                    module: entry.module,
                    config: entry.config,
                    status: 'degraded',
                    code: 'HOST_NOT_APPLICABLE',
                    message: compatibility.message
                });
                this.clearPlaceholder(id);
                return false;
            }
            // 版本过低：用户需要知道，保留失败与占位。
            if (compatibility.reason === 'version') {
                this.fail(id, entry, ErrorCode.NOT_SUPPORTED, compatibility.message ?? '宿主版本过低');
                return false;
            }
            // 能力缺失且降级要求可见：占位。
            if (compatibility.degradeMode === 'placeholder') {
                this.fail(id, entry, ErrorCode.NOT_SUPPORTED, compatibility.message ?? '宿主能力不足');
                return false;
            }
            // silent / readonly / fixed：不启动、不占位、不记失败，交给上层按模式收窄功能。
            this.runtimes.set(id, {
                module: entry.module,
                config: entry.config,
                status: 'degraded',
                code: 'CAPABILITY_DEGRADED',
                message: compatibility.message,
                ...(compatibility.degradeMode === undefined ? {} : { degradeMode: compatibility.degradeMode })
            });
            this.clearPlaceholder(id);
            return false;
        }
        const missing = (entry.module.meta.permissions ?? []).filter((permission) => !this.permissions.has(permission));
        if (missing.length > 0) {
            for (const permission of missing)
                this.permissions.recordDenied(permission);
            this.fail(id, entry, ErrorCode.PERMISSION_DENIED, `缺少权限：${missing.join(', ')}`);
            return false;
        }
        const disposers = createDisposerRegistry();
        const runtime = {
            module: entry.module,
            config: entry.config,
            status: 'unloaded',
            disposers
        };
        this.runtimes.set(id, runtime);
        // 进入 loading 之后才允许跳到 ready / degraded / failed，
        // 这条路径由跳转表约束，不在表里的转换会被拒绝并留在原状态。
        this.transition(runtime, 'loading');
        try {
            const granted = (entry.module.meta.permissions ?? []).filter((permission) => this.permissions.has(permission));
            const context = createSandboxContext({
                root: this.options.root,
                config: entry.config,
                granted,
                ...(this.options.sandboxPorts === undefined ? {} : { ports: this.options.sandboxPorts }),
                disposers
            });
            // 同 realm 里最容易被顺手拿来出网的就是全局 fetch 一族。
            // 未授予 net.egress 时在 bootstrap 期间遮住它们，结束（含超时/抛错）后还原。
            const restoreRealm = installRealmNetworkGuard({ allowNetwork: granted.includes('net.egress') });
            try {
                await this.scheduler.runWithTimeout(() => entry.module.bootstrap(context), this.timeoutMs);
            }
            finally {
                restoreRealm();
            }
            this.transition(runtime, 'ready');
            delete runtime.code;
            delete runtime.message;
            this.clearPlaceholder(id);
            return true;
        }
        catch (error) {
            const code = isPetError(error) ? error.code : ErrorCode.LOAD_FAILED;
            const message = error instanceof Error ? error.message : String(error);
            this.transition(runtime, 'failed');
            runtime.code = code;
            runtime.message = message;
            this.noteServiceImpact(entry.module.meta, code, message);
            disposers.disposeAll();
            this.renderPlaceholder(entry.module, code, message);
            return false;
        }
    }
    /**
     * 按注册顺序启动全部模块。
     * 禁用模块记为 disabled，失败模块留占位；任何单个模块都不阻断整轮启动。
     */
    async startAll() {
        for (const id of this.startIds()) {
            await this.start(id);
        }
        return this.statuses();
    }
    /** 注册表与 loader 的已知 id 合并；loader 让 startAll 也能启动未注册的懒加载模块。 */
    startIds() {
        const ids = new Set(this.registry.list().map((entry) => entry.id));
        for (const id of this.options.loader?.ids() ?? [])
            ids.add(id);
        return [...ids];
    }
    /** 幂等：未启动过的模块直接返回 false，已停止的返回 true。 */
    async stop(id) {
        const runtime = this.runtimes.get(id);
        if (runtime === undefined) {
            this.clearPlaceholder(id);
            return false;
        }
        if (runtime.status === 'stopped' || runtime.status === 'disabled') {
            this.clearPlaceholder(id);
            return true;
        }
        this.transition(runtime, 'stopping');
        try {
            // 先 teardown：模块清理时可能还要访问自己的容器，提前摘掉 DOM 会让它半途中断。
            await runtime.module?.teardown();
        }
        catch (error) {
            runtime.code = isPetError(error) ? error.code : ErrorCode.UNKNOWN;
            runtime.message = error instanceof Error ? error.message : String(error);
        }
        finally {
            runtime.disposers?.disposeAll();
            this.transition(runtime, 'stopped');
            this.clearPlaceholder(id);
        }
        return true;
    }
    async stopAll() {
        for (const id of [...this.runtimes.keys()]) {
            await this.stop(id);
        }
    }
    statuses() {
        return [...this.runtimes.entries()].map(([id, runtime]) => ({
            id,
            status: runtime.status,
            ...(runtime.code === undefined ? {} : { code: runtime.code }),
            ...(runtime.message === undefined ? {} : { message: runtime.message }),
            ...(runtime.degradeMode === undefined ? {} : { degradeMode: runtime.degradeMode })
        }));
    }
    /**
     * 在模块自己的边界里跑一段回调。
     *
     * 宿主分发事件、定时器、DOM 监听时统一走这里：抛错只把这个模块标成 failed，
     * 不向上冒泡，同轮里的其他模块照常跑。
     *
     * 已停止或禁用的模块不做状态变更 —— 那种情况下的异常可能只是清理残留，
     * 把死掉的模块再判一次 failed，只会让诊断面板长期红着。
     */
    runGuarded(id, fn) {
        const runtime = this.runtimes.get(id);
        if (runtime === undefined)
            return false;
        try {
            fn();
            return true;
        }
        catch (error) {
            const code = isPetError(error) ? error.code : ErrorCode.UNKNOWN;
            const message = error instanceof Error ? error.message : String(error);
            runtime.code = code;
            runtime.message = message;
            if (runtime.status === 'ready' || runtime.status === 'degraded') {
                this.transition(runtime, 'failed');
                this.noteServiceImpact(runtime.module?.meta, code, message);
                this.renderPlaceholderFor(id, runtime.module?.meta.name ?? id, code, message);
            }
            return false;
        }
    }
    /** 当前可见占位的模块 id，供诊断面板与测试核对。 */
    placeholderIds() {
        return [...this.placeholders.keys()];
    }
    /**
     * 布局指令。`fixed` 降级下直接返回固定画布，**不触碰宿主窗口接口** ——
     * 纯插件形态没有窗口控制权，这条路径必须能独立成立。
     */
    applyLayout(id) {
        const runtime = this.runtimes.get(id);
        if (runtime?.degradeMode === 'fixed') {
            return { mode: 'fixed-canvas', width: FIXED_CANVAS_SIZE.width, height: FIXED_CANVAS_SIZE.height };
        }
        this.options.shell?.resizeToContent();
        return { mode: 'host-managed' };
    }
    /**
     * 代模块执行写操作。`readonly` 降级下拒绝写入并给出原因，
     * 不把写请求悄悄丢掉 —— 静默丢弃会让用户以为已经保存。
     */
    requestWrite(id, apply) {
        const runtime = this.runtimes.get(id);
        if (runtime?.degradeMode === 'readonly') {
            return {
                ok: false,
                code: 'READONLY_DEGRADED',
                message: '写入被拒绝：宿主未提供写接口，本次修改未保存'
            };
        }
        apply();
        return { ok: true };
    }
    /** 诊断面板用：把状态压成一行，避免面板层自己拼字符串。 */
    describe() {
        if (this.runtimes.size === 0)
            return 'modules: none';
        return this.statuses()
            .map((runtime) => `${runtime.id}=${runtime.status}${runtime.code ? `(${runtime.code})` : ''}`)
            .join(', ');
    }
    /**
     * 核心模块失败 → 宣布服务停止。
     *
     * 只认第一原因：后面接着崩的模块多半是第一块倒下的连锁反应，
     * 覆盖掉首因，诊断就没法定位了。
     */
    noteServiceImpact(meta, code, message) {
        if (meta === undefined || meta.tier !== 'core')
            return;
        if (this.serviceStopReason !== undefined)
            return;
        this.serviceStopReason = { moduleId: meta.id, code, message };
        this.options.onServiceStop?.(this.serviceStopReason);
    }
    /** 尚未就绪的依赖 id。空数组表示全部就绪；未注册的依赖同样算未就绪。 */
    unreadyDependencies(meta) {
        return (meta.requires ?? []).filter((dep) => this.runtimes.get(dep)?.status !== 'ready');
    }
    /**
     * 唯一的状态写入口。
     *
     * 非法跳转不抛错：抛出去会把整轮启动带崩，而一个模块卡在坏状态里
     * 本来就不该影响别人。这里把它留在原状态并记下原因，交给诊断去报。
     */
    transition(runtime, next) {
        if (runtime.status === next)
            return;
        const allowed = ALLOWED_TRANSITIONS[runtime.status];
        if (!allowed.includes(next)) {
            runtime.code = 'ILLEGAL_TRANSITION';
            runtime.message = `非法状态跳转：${runtime.status} → ${next}`;
            return;
        }
        runtime.status = next;
    }
    async resolveEntry(id) {
        const existing = this.registry.get(id);
        if (existing !== undefined)
            return existing;
        const loader = this.options.loader;
        if (loader === undefined) {
            throw new PetError(ErrorCode.LOAD_FAILED, `模块未注册：${id}`);
        }
        const module = await loader.load(id, { timeoutMs: this.timeoutMs });
        this.registry.register(module);
        const entry = this.registry.get(id);
        if (entry === undefined) {
            throw new PetError(ErrorCode.LOAD_FAILED, `模块注册失败：${id}`);
        }
        return entry;
    }
    /** 连模块对象都没拿到时的失败路径：仍要留下 failed 状态和占位。 */
    failDetached(id, code, message) {
        this.runtimes.set(id, { status: 'failed', code, message });
        this.renderPlaceholderFor(id, id, code, message);
    }
    fail(id, entry, code, message) {
        this.runtimes.set(id, {
            module: entry.module,
            config: entry.config,
            status: 'failed',
            code,
            message
        });
        this.noteServiceImpact(entry.module.meta, code, message);
        this.renderPlaceholder(entry.module, code, message);
    }
    renderPlaceholder(module, code, message) {
        this.renderPlaceholderFor(module.meta.id, module.meta.name, code, message);
    }
    renderPlaceholderFor(id, name, code, message) {
        this.clearPlaceholder(id);
        const factory = this.options.placeholder ?? defaultPlaceholder;
        const cleanup = toCleanup(factory({ id, name, code, message }, this.options.root));
        if (cleanup !== undefined)
            this.placeholders.set(id, cleanup);
    }
    clearPlaceholder(id) {
        const cleanup = this.placeholders.get(id);
        if (cleanup === undefined)
            return;
        this.placeholders.delete(id);
        cleanup();
    }
}
