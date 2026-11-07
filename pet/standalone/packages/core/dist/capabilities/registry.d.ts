/**
 * 能力注册表：哪些默认开着，哪些要用户自己点开。
 *
 * 参照 Cyrene 本体已有的能力清单，把桌宠缺的部分按「风险」而不是按「功能大小」定默认值。
 * 判据很简单：会对外留下痕迹、会消耗资产、会动别人东西的，一律默认关闭。
 *
 * 三种默认状态：
 * - `on`：默认开启，用户想关可以关
 * - `off`：默认关闭，用户点开就能用
 * - `manual`：需要外部依赖，点开前得先配好服务，否则开了也是空转
 *
 * 高风险项（`risk: 'high'`）多一道确认：只在设置里打开不够，
 * 还要在 `acknowledged` 里登记一次，才会真正生效。
 */
export type CapabilityGroup = 'browse' | 'media' | 'social' | 'io' | 'agent' | 'game';
export type CapabilityDefault = 'on' | 'off' | 'manual';
export type CapabilityRisk = 'low' | 'medium' | 'high';
/**
 * 这项能力背后有没有真实调用点。
 *
 * `live`：已经接到实际代码上，打开就能用。
 * `planned`：只有名字和设置项，背后是空的。
 *
 * 缺省按 `planned` 处理。判断标准故意定得严——宁可少报，
 * 也不能让设置页写着「某项生效」而实际什么都没发生。
 */
export type CapabilityStatus = 'live' | 'planned';
export interface CapabilitySpec {
    readonly id: string;
    readonly label: string;
    readonly group: CapabilityGroup;
    readonly defaultState: CapabilityDefault;
    readonly risk: CapabilityRisk;
    /** 省略视为 `planned`。接上调用点后才标 `live`。 */
    readonly status?: CapabilityStatus;
    /** 依赖的能力 id。依赖不生效时，本项也起不来。 */
    readonly dependsOn?: readonly string[];
    /** 给设置页用的一句话说明。 */
    readonly note: string;
}
export declare const CAPABILITY_SPECS: readonly CapabilitySpec[];
export interface CapabilityUserSettings {
    /** 用户主动点开的。 */
    readonly enabled?: readonly string[];
    /** 用户主动关掉的。优先级高于 enabled。 */
    readonly disabled?: readonly string[];
    /** 高风险项的一次性确认登记。 */
    readonly acknowledged?: readonly string[];
}
export type CapabilityBlockReason = 'turned-off' | 'not-acknowledged' | 'dependency-missing' | 'needs-setup';
export interface CapabilityBlock {
    readonly id: string;
    readonly reason: CapabilityBlockReason;
    readonly detail: string;
}
export interface CapabilityResolution {
    /** 实际生效的能力。只可能是 `live` 项。 */
    readonly active: readonly string[];
    /** 注册表里一共多少项。 */
    readonly total: number;
    /** 想开但没开成的，带原因。 */
    readonly blocked: readonly CapabilityBlock[];
    /**
     * 只有名字、背后还没有实现的 id。
     *
     * 单列出来，不混进 `blocked`：用户没做错什么，是这项还没接上。
     * 设置页应当把它们显示成「暂不可用」，而不是让用户去点开。
     */
    readonly unavailable: readonly string[];
    /**
     * 已经接上、但当前没生效的项（默认关着，用户也没点开）。
     *
     * 设置页需要把它们也列出来，否则「写文件」「下载」这类
     * 默认关的能力会从界面上凭空消失。
     */
    readonly available: readonly string[];
    /** 设置里出现、但注册表没有的 id。 */
    readonly unknown: readonly string[];
}
export declare function getCapability(id: string): CapabilitySpec | undefined;
export declare function capabilitiesByGroup(group: CapabilityGroup): readonly CapabilitySpec[];
/** 默认就该生效的能力 id。只算已经接上的，别把空壳算进来。 */
export declare function defaultCapabilities(): readonly string[];
/** 高风险能力 id。设置页需要用它们决定要不要弹确认。 */
export declare function highRiskCapabilities(): readonly string[];
/**
 * 解析最终生效的能力集合。
 *
 * 顺序：基线（默认值）→ 用户点开 → 用户关掉 → 高风险确认 → 依赖检查。
 * 依赖检查放在最后，所以「父项被关掉时子项自动失效」，不需要调用方自己算。
 */
export declare function resolveCapabilities(settings?: CapabilityUserSettings): CapabilityResolution;
/**
 * 同一套规则，换一份清单。
 *
 * 测试用它验证「一项既是 live 又高风险」这类真实注册表里还没出现的组合；
 * 将来插件自带能力包，也从这里进来，不必复制一遍解析逻辑。
 */
export declare function resolveFrom(specs: readonly CapabilitySpec[], settings?: CapabilityUserSettings): CapabilityResolution;
export declare function isCapabilityActive(id: string, resolution: CapabilityResolution): boolean;
/** 压成一句话，给设置页顶部的概览用。 */
export declare function describeResolution(resolution: CapabilityResolution): string;
