import type { HostCapabilitySnapshot, IHostAdapter } from '@pet/shared';
/**
 * 2026-10-27 本机实测版本：注册表
 * `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` 的 DisplayName
 * 为「DeepSeek Harness 0.2.1-rc.3」。
 *
 * 该常量只是「本机已验证过的最小基线」，真实版本以 detect() 读到的文件为准。
 */
export declare const VERIFIED_DSH_VERSION = "0.2.1-rc.3";
export type ReadTextFile = (path: string) => Promise<string>;
export interface LocalHostAdapterOptions {
    /** 覆盖安装目录；不传时按平台默认路径推断。 */
    readonly installDir?: string;
    /** 测试注入用；默认走 node:fs/promises。 */
    readonly readTextFile?: ReadTextFile;
    /**
     * 测试注入用：读取安装包里的 api-catalog key。
     * 默认解析 `resources/app.asar`；返回 `undefined` 表示拿不到实据。
     */
    readonly readApiCatalogKeys?: (installDir: string) => Promise<readonly string[] | undefined>;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly platform?: NodeJS.Platform;
}
/**
 * 本机宿主适配器：从 dsh 安装目录读取版本与能力声明。
 *
 * 铁律 3：探测失败必须抛 `HostProbeError`。
 * `available: []` 只表示「宿主在线，但没有声明任何能力」，与失败严格区分。
 */
export declare class LocalHostAdapter implements IHostAdapter {
    private readonly options;
    private readonly readTextFile;
    private detectedVersion;
    constructor(options?: LocalHostAdapterOptions);
    /** 最近一次探测到的版本；detect() 之前返回本机已验证基线。 */
    get version(): string;
    detect(): Promise<HostCapabilitySnapshot>;
    private readVersion;
    private readCapabilities;
    /** 读取声明文件；文件不存在返回 `undefined`，格式错误仍抛 `DECLARATION_INVALID`。 */
    private readDeclaration;
}
