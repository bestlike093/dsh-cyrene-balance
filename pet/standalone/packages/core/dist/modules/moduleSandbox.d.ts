import type { DisposerRegistry, ModuleConfig, ModuleContext, PanelSpec, Permission } from '@pet/shared';
/** 沙箱里能看到的端口。真实实现由桌面壳注入，core 不直接碰网络与磁盘。 */
export interface SandboxPorts {
    readonly fetch?: (input: string, init?: unknown) => Promise<unknown>;
    readonly readAsset?: (path: string) => Promise<Uint8Array>;
    readonly readMemory?: (key: string) => Promise<unknown>;
    readonly writeMemory?: (key: string, value: unknown) => Promise<void>;
    readonly render?: (html: string) => void;
    /** 注册侧边栏面板；返回注销函数 */
    readonly registerPanel?: (spec: PanelSpec) => () => void;
}
/** 面板注册入口。模块只能交 HTML，宿主负责挂载与销毁。 */
export interface SandboxUiPanel {
    register(spec: PanelSpec): () => void;
}
/** 接口按权限逐项挂载：没有授予的能力在对象上根本不存在。 */
export interface SandboxApi {
    readonly net?: {
        fetch(input: string, init?: unknown): Promise<unknown>;
    };
    readonly fs?: {
        readAsset(path: string): Promise<Uint8Array>;
    };
    readonly memory?: {
        read?: (key: string) => Promise<unknown>;
        write?: (key: string, value: unknown) => Promise<void>;
    };
    readonly ui?: {
        /** 仅在授予 ui.render 时存在 */
        readonly render?: (html: string) => void;
        /** 仅在授予 ui.panel 时存在 */
        readonly panel?: SandboxUiPanel;
    };
}
export interface SandboxModuleContext extends ModuleContext {
    readonly api: SandboxApi;
    readonly granted: readonly Permission[];
}
export interface SandboxOptions {
    readonly root: ShadowRoot;
    readonly config: ModuleConfig;
    readonly granted: readonly Permission[];
    readonly ports?: SandboxPorts;
    readonly disposers?: DisposerRegistry;
}
export interface RealmGuardOptions {
    /** true 表示模块已获授 net.egress，保留全局网络入口。 */
    readonly allowNetwork: boolean;
    /** 默认 globalThis；测试可传替身。 */
    readonly target?: Record<string, unknown>;
}
/**
 * 在模块执行期间遮蔽全局出网入口。
 *
 * 这是「同 realm 内的最小缓解」，不是隔离：模块只要把 fetch 提前存下来，
 * 或换个还没被挡住的对象，就能越过。真正的边界在 Worker（见 workerSandbox.ts）。
 * 遮蔽期结束后按原 descriptor 还原，不留下永久副作用。
 */
export declare function installRealmNetworkGuard(options: RealmGuardOptions): () => void;
/**
 * 构建模块上下文。
 * 权限判断在构建时完成，运行期不再给未授权模块补接口。
 */
export declare function createSandboxContext(options: SandboxOptions): SandboxModuleContext;
