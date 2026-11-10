import type { Diagnostics, DiagnosticsSection } from './diagnostics.js';
import type { ModuleHost, ModuleRuntime } from '../modules/moduleHost.js';
export declare const MODULES_SECTION = "modules";
/** 服务级状态。核心模块失败后，整个服务停止，模块级状态不足以说明这件事。 */
export interface ModuleServiceSnapshot {
    readonly state: 'running' | 'stopped';
    readonly reason?: {
        readonly moduleId: string;
        readonly code: string;
        readonly message: string;
    };
}
/**
 * 模块生命周期诊断行。
 *
 * 状态直接读 ModuleHost.statuses()，不在别处缓存一份。
 * 两处各存一份状态，迟早会各说各话。
 */
export declare function toModulesSection(statuses: readonly ModuleRuntime[], service?: ModuleServiceSnapshot): Omit<DiagnosticsSection, 'name'>;
/** 把模块状态接进诊断聚合器；每次 collect 都重新读宿主，保证与实际状态同源。 */
export declare function registerModuleDiagnostics(diagnostics: Diagnostics, host: ModuleHost): () => void;
