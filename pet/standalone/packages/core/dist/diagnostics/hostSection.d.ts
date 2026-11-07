import type { Diagnostics, DiagnosticsSection } from './diagnostics.js';
import type { HostCapabilityResolution } from '../modules/hostCapability.js';
export declare const HOST_SECTION = "host";
export declare const HOST_SECTION_LABEL = "\u5BBF\u4E3B\u80FD\u529B";
/**
 * 能力来源必须在诊断里写明。
 * 声明值只是占位，不能让「自动探测不可用」看起来像正常状态。
 */
export declare function toHostSection(resolution: HostCapabilityResolution): Omit<DiagnosticsSection, 'name'>;
/** 注册到诊断聚合器；传 getter 可在真机探测结果更新后重新取值。 */
export declare function registerHostDiagnostics(diagnostics: Diagnostics, resolution: HostCapabilityResolution | (() => HostCapabilityResolution)): () => void;
