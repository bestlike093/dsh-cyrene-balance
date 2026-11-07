/** 模块权限白名单。默认零权限，用户逐项开启。 */
export type Permission = 'ui.render' | 'ui.panel' | 'ui.click-through' | 'net.egress' | 'fs.user-assets.read' | 'dsh.context.read' | 'dsh.decision.commit' | 'vault.seal' | 'memory.read' | 'memory.write';
export declare const ALL_PERMISSIONS: readonly Permission[];
/**
 * 模块向侧边栏注册的面板。
 *
 * 模块只交 HTML，拿不到宿主 DOM 节点；挂载、定位与销毁都由宿主完成。
 * `id` 只需在模块内唯一，宿主会拼上模块 id 作为全局键。
 */
export interface PanelSpec {
    readonly id: string;
    readonly title: string;
    /** 排序权重，小的在前；缺省 100 */
    readonly order?: number;
    readonly html: string;
}
export type RenderMode = 'embedded' | 'standalone' | 'fixed:card' | 'headless';
/**
 * 宿主能力键。模块只能声明这十二项，宿主按探测结果逐项点亮；
 * 缺失项不阻断加载，但触发对应模块的降级占位。
 *
 * ⚠️ `approval` 与 `contracts/crypto.ts` 的 `Capability` 共享同一字面量。
 * 两者语义不同：这里是「宿主是否接管审批」，那里是「模块声明的能力」。
 * 跨域比较必须经各自类型收敛，禁止裸用字符串。
 */
export type HostCapability = 'ask' | 'approval' | 'taskProgress' | 'settings' | 'tray' | 'window' | 'llmCall' | 'sessionRead' | 'storage' | 'fileAccess' | 'voiceInput' | 'skillCatalog';
/**
 * 能力名的唯一真源。
 *
 * `approval` 同时是宿主能力名与 `contracts/crypto.ts` 的 `Capability` 字面量。
 * 在能力上下文里裸写字符串，读代码的人无法判断来源；
 * 这个对象是 ③-d 扫描脚本的对照基准，别处一律引用它。
 */
export declare const HOST_CAPABILITY: {
    readonly ask: "ask";
    readonly approval: "approval";
    readonly taskProgress: "taskProgress";
    readonly settings: "settings";
    readonly tray: "tray";
    readonly window: "window";
    readonly llmCall: "llmCall";
    readonly sessionRead: "sessionRead";
    readonly storage: "storage";
    readonly fileAccess: "fileAccess";
    readonly voiceInput: "voiceInput";
    readonly skillCatalog: "skillCatalog";
};
/** 顺序即声明顺序；诊断输出依赖它保持稳定。 */
export declare const HOST_CAPABILITIES: readonly HostCapability[];
/** 宿主形态。`electron-only` 能力在纯插件形态下不存在，应报「不适用」而非「缺失」。 */
export type HostForm = 'any' | 'electron-only';
/**
 * 每项能力的宿主形态。`Record<HostCapability, ...>` 保证扩项时漏写会编译失败 ——
 * 形态限定靠类型检查，不靠注释。
 */
export declare const HOST_CAPABILITY_FORM: Readonly<Record<HostCapability, HostForm>>;
/**
 * 模块分级。
 *
 * 分级不是标签：它决定这个模块能不能关、关的时候要不要警告、默认开还是关、
 * 崩了以后影响半径有多大。新增等级必须同时在 `MODULE_TIER_POLICY` 补一条，
 * 漏写会编译失败 —— 分级靠类型检查保证，不靠注释和文档。
 */
export type ModuleTier = 'core' | 'essential' | 'general' | 'dangerous' | 'critical';
/** 关闭时的确认强度。`forbidden` 表示不允许用户单独关闭。 */
export type TierCloseGuard = 'forbidden' | 'confirm-with-consequences' | 'none';
/** 打开时的确认强度。`multi-step` 表示需要读说明 → 勾选知悉 → 再次确认。 */
export type TierOpenGuard = 'none' | 'risk-notice' | 'multi-step';
export interface TierPolicy {
    readonly tier: ModuleTier;
    readonly label: string;
    /**
     * 首次安装时的默认开关。
     * `inherit` 表示沿用现有配置，不做任何迁移 —— 用于「一般」级，
     * 避免升级时把用户原本开着的功能悄悄关掉。
     */
    readonly defaultEnabled: boolean | 'inherit';
    readonly closeGuard: TierCloseGuard;
    readonly openGuard: TierOpenGuard;
    /** 每次应用启动后是否强制回到关闭。 */
    readonly resetOnLaunch: boolean;
    /**
     * 故障影响半径。
     * `stop-service` 让她整体停止服务（停输入、停模型、停网络出口），
     * 但不清空用户数据；`module-only` 只把该模块收起来。
     */
    readonly failureScope: 'stop-service' | 'module-only';
}
/** 分级策略的唯一真源。诊断、设置页、开关流程都读它，不要在别处再写一份。 */
export declare const MODULE_TIER_POLICY: Readonly<Record<ModuleTier, TierPolicy>>;
/** 顺序即声明顺序：从最不能关到最不该默认开。设置页按这个顺序分组。 */
export declare const MODULE_TIERS: readonly ModuleTier[];
export interface ModuleMeta {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly permissions: readonly Permission[];
    /** 分级；决定开关规则与故障半径。 */
    readonly tier: ModuleTier;
    /**
     * 依赖的其他模块 id。
     * 缺失时该模块进入 `degraded` 并写明缺谁，不阻断其他模块启动。
     * 模块之间不得直接互相 import，只能靠这里声明关系。
     */
    readonly requires?: readonly string[];
    /** 依赖的宿主能力；任一项缺失即降级。不填表示无要求。 */
    readonly hostCapabilities?: readonly HostCapability[];
    /** 最小宿主版本（semver）；宿主低于此版本时降级。 */
    readonly minHostVersion?: string;
}
export interface ModuleConfig {
    readonly enabled: boolean;
    readonly granted: readonly Permission[];
    readonly options: Readonly<Record<string, unknown>>;
}
export interface DiagResult {
    readonly ok: boolean;
    readonly code?: string;
    readonly message?: string;
    readonly details?: Readonly<Record<string, unknown>>;
}
/** 模块内所有监听器 / 定时器 / 订阅都登记到这里，teardown 统一执行。 */
export interface DisposerRegistry {
    add(fn: () => void): void;
    disposeAll(): void;
}
export interface ModuleContext {
    readonly root: ShadowRoot;
    readonly config: ModuleConfig;
    readonly disposers: DisposerRegistry;
}
/** 插件里的插件：任一模块失败都不影响其他模块与主进程。 */
export interface IPetalModule {
    readonly meta: ModuleMeta;
    bootstrap(ctx: ModuleContext): Promise<void>;
    teardown(): Promise<void>;
    diagnose?(): Promise<DiagResult>;
}
