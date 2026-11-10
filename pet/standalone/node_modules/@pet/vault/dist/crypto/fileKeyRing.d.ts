import type { CryptoSuiteId } from '@pet/shared';
import type { KeyBackend, KeyBackendKind } from './keyBackend.js';
import type { KeyRing, VaultKey } from './keyRing.js';
export type PermissionState = 'ok' | 'too-open' | 'unknown';
export interface FileKeyRingDiagnostic {
    readonly backend: KeyBackendKind;
    readonly secure: boolean;
    readonly permission: PermissionState;
    readonly path: string;
    /** 签名密钥状态：正常加载 / 本次重建 / 运行时不可用。 */
    readonly signerState: 'ok' | 'rebuilt' | 'unavailable';
    /**
     * 密钥环状态：正常加载 / 本次首次生成（新装或文件丢失）/ 损坏隔离后重建。
     * rebuilt 与 quarantined 都意味着旧数据可能已不可读，UI 应提示备份入口。
     */
    readonly keyRingState: 'ok' | 'rebuilt' | 'quarantined';
    /** 本次启动发现密钥文件损坏/解不开时，改名保留的证据路径；绝不自动删除。 */
    readonly recoveredFrom?: string;
}
export interface FileKeyRing extends KeyRing {
    diagnostics(): Promise<FileKeyRingDiagnostic>;
    flush(): Promise<void>;
    /** 导出全部密钥版本，仅供备份流程使用；调用方用完应尽快清零。 */
    exportKeys(): VaultKey[];
}
export interface FileKeyRingOptions {
    readonly path: string;
    readonly backend: KeyBackend;
    readonly suite?: CryptoSuiteId;
}
/**
 * 宽泛主体：任何人、Users、Authenticated Users、Guests。
 *
 * 这些 SID 与系统语言无关。中文 Windows 上 `icacls` 会打印「所有人」
 * 「BUILTIN\Users」，按英文名去匹配会静默漏报，所以只认 SID。
 */
export declare const WIDE_ACL_SIDS: readonly string[];
/** SYSTEM 的 SID。收紧权限时保留它，便于系统备份与杀软读取。 */
export declare const SYSTEM_SID = "S-1-5-18";
/**
 * 根据 ACL 里的 SID 集合判断权限状态。
 *
 * 纯函数，不碰文件系统，便于在非 Windows 环境里验证判定规则。
 */
export declare function evaluateAclSids(entries: readonly string[], currentSid: string | null): PermissionState;
/**
 * Windows 用 ACL（chmod 只改只读位），POSIX 用 0600。
 *
 * Windows 侧授权用 SID 而不是用户名：用户名可能含空格、重名或与
 * 本地化显示名不一致，SID 不会。
 */
export declare function restrictPermissions(filePath: string): Promise<void>;
/**
 * 落盘密钥环：密钥先经 backend 包裹，再写 keys.json。
 * 文件里永远不出现裸 key；权限按平台收紧到仅当前用户。
 */
export declare function createFileKeyRing(options: FileKeyRingOptions): Promise<FileKeyRing>;
