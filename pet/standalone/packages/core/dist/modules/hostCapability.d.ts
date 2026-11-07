import type { HostCapability, HostCapabilitySnapshot, ModuleMeta } from '@pet/shared';
/**
 * 宿主能力快照已上移到 `@pet/shared` 的 contracts/host.ts，
 * 供 shared 侧 `IHostAdapter` 与 core 共用；此处 re-export 保持既有导入路径可用。
 */
export type { HostCapabilitySnapshot };
export type DegradeMode = 'placeholder' | 'silent' | 'readonly' | 'fixed';
export interface DegradeRule {
    readonly mode: DegradeMode;
    readonly message: string;
}
/**
 * 降级矩阵：每项能力的缺失行为在这里写死，模块不得自行决定。
 * `placeholder` 会在宿主根节点留可见占位，其余模式静默处理。
 */
export declare const CAPABILITY_DEGRADE: Readonly<Record<HostCapability, DegradeRule>>;
export interface CompatibilityResult {
    readonly ok: boolean;
    readonly missing: readonly HostCapability[];
    /** 该宿主形态下不适用的能力。与 `missing` 分开，不触发降级占位。 */
    readonly notApplicable: readonly HostCapability[];
    readonly reason?: 'capability' | 'version' | 'not-applicable';
    readonly message?: string;
    /**
     * 整模块的降级模式。多项缺失时取最严重的一项：
     * `placeholder` > `readonly` > `fixed` > `silent`。
     * 仅 `reason === 'capability'` 时有值。
     */
    readonly degradeMode?: DegradeMode;
}
/** 语义化比较：a < b 返回负数。只比较三段数字，预发布标签忽略。 */
export declare function compareSemver(a: string, b: string): number;
/**
 * 判定模块能否在宿主上完整运行。
 *
 * 三态分流，顺序不可颠倒：
 * 1. 真缺失 → `capability`，调用方转成降级占位；
 * 2. 形态不适用 → `not-applicable`，模块静默不启，不算失败；
 * 3. 版本过低 → `version`。
 */
export declare function evaluateModuleHost(meta: ModuleMeta, host: HostCapabilitySnapshot): CompatibilityResult;
/** 诊断面板用：把缺失能力展开成可读行，顺序固定，便于快照比对。 */
export declare function describeDegradation(missing: readonly HostCapability[]): readonly string[];
export type HostCapabilitySource = 'detected' | 'declared' | 'fallback';
export interface HostCapabilityResolution {
    readonly snapshot: HostCapabilitySnapshot;
    /** detected=自动探测；declared=能力声明文件；fallback=全部降级。 */
    readonly source: HostCapabilitySource;
}
/**
 * 解析能力声明文件（JSON 对象）。未知能力键直接忽略，便于旧宿主读新声明。
 * 非法输入返回 undefined，不抛错。
 */
export declare function parseHostCapabilityDeclaration(raw: unknown): HostCapabilitySnapshot | undefined;
export interface ResolveHostCapabilitiesOptions {
    /** 自动探测；拿不到时会回落到声明文件。 */
    readonly detect?: () => HostCapabilitySnapshot | Promise<HostCapabilitySnapshot>;
    /** 能力声明文件内容（已解析的 JSON 对象）。 */
    readonly declaration?: unknown;
}
/**
 * 宿主能力的三级解析：自动探测 → 声明文件 → 全部降级。
 * 探测抛错或返回空都视为「拿不到」，不阻塞 S3 开工。
 */
export declare function resolveHostCapabilities(options?: ResolveHostCapabilitiesOptions): Promise<HostCapabilityResolution>;
