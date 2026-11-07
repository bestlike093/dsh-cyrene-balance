import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOST_CAPABILITIES, HostProbeError } from '@pet/shared';
import { resolveAvailableFromCatalog } from './capabilityEvidence.js';
import { readApiCatalogKeys } from './asarApiCatalog.js';
/**
 * 2026-10-27 本机实测版本：注册表
 * `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` 的 DisplayName
 * 为「DeepSeek Harness 0.2.1-rc.3」。
 *
 * 该常量只是「本机已验证过的最小基线」，真实版本以 detect() 读到的文件为准。
 */
export const VERIFIED_DSH_VERSION = '0.2.1-rc.3';
function resolveInstallDir(options) {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const explicit = env['DSH_HOME'];
    if (explicit !== undefined && explicit.length > 0)
        return explicit;
    if (platform === 'win32') {
        const localAppData = env['LOCALAPPDATA'];
        if (localAppData === undefined || localAppData.length === 0)
            return undefined;
        return join(localAppData, 'Programs', 'DeepSeek Harness');
    }
    if (platform === 'darwin') {
        return '/Applications/DeepSeek Harness.app/Contents/Resources';
    }
    return '/opt/deepseek-harness';
}
const defaultReadTextFile = (path) => readFile(path, 'utf8');
/**
 * 本机宿主适配器：从 dsh 安装目录读取版本与能力声明。
 *
 * 铁律 3：探测失败必须抛 `HostProbeError`。
 * `available: []` 只表示「宿主在线，但没有声明任何能力」，与失败严格区分。
 */
export class LocalHostAdapter {
    options;
    readTextFile;
    detectedVersion = VERIFIED_DSH_VERSION;
    constructor(options = {}) {
        this.options = options;
        this.readTextFile = options.readTextFile ?? defaultReadTextFile;
    }
    /** 最近一次探测到的版本；detect() 之前返回本机已验证基线。 */
    get version() {
        return this.detectedVersion;
    }
    async detect() {
        const installDir = this.options.installDir ?? resolveInstallDir(this.options);
        if (installDir === undefined) {
            throw new HostProbeError('HOST_NOT_FOUND', '未能定位 DeepSeek Harness 安装目录');
        }
        const version = await this.readVersion(installDir);
        const available = await this.readCapabilities(installDir);
        this.detectedVersion = version;
        return { version, available };
    }
    async readVersion(installDir) {
        const candidates = [join(installDir, 'resources', 'version'), join(installDir, 'version')];
        for (const candidate of candidates) {
            try {
                const raw = await this.readTextFile(candidate);
                const version = raw.trim();
                if (version.length > 0)
                    return version;
            }
            catch {
                // 记录在最后一个失败的候选上，统一抛 VERSION_UNREADABLE
            }
        }
        throw new HostProbeError('VERSION_UNREADABLE', `安装目录存在但读不到版本号：${installDir}`);
    }
    async readCapabilities(installDir) {
        const declared = await this.readDeclaration(installDir);
        if (declared !== undefined)
            return declared;
        // 声明文件缺失时，用安装包内的 api-catalog 实据。
        // 声明回答「可以声明什么」，catalog 回答「宿主真有哪些服务」。
        const probeCatalog = this.options.readApiCatalogKeys ?? readApiCatalogKeys;
        const keys = await probeCatalog(installDir);
        if (keys === undefined)
            return [];
        return resolveAvailableFromCatalog(keys);
    }
    /** 读取声明文件；文件不存在返回 `undefined`，格式错误仍抛 `DECLARATION_INVALID`。 */
    async readDeclaration(installDir) {
        const path = join(installDir, 'resources', 'host-capabilities.json');
        let raw;
        try {
            raw = await this.readTextFile(path);
        }
        catch {
            return undefined;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (error) {
            throw new HostProbeError('DECLARATION_INVALID', `能力声明不是合法 JSON：${path}`, {
                cause: error
            });
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new HostProbeError('DECLARATION_INVALID', `能力声明形状错误：${path}`);
        }
        const declared = parsed['available'];
        if (!Array.isArray(declared)) {
            throw new HostProbeError('DECLARATION_INVALID', `能力声明缺少 available 数组：${path}`);
        }
        return HOST_CAPABILITIES.filter((capability) => declared.includes(capability));
    }
}
