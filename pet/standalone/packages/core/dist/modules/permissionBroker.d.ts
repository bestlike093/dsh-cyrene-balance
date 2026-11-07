import type { Permission } from '@pet/shared';
export interface PermissionAuditEntry {
    readonly permission: Permission;
    readonly action: 'grant' | 'revoke' | 'deny';
    readonly at: number;
}
/**
 * 运行时权限执行器。
 * 类型白名单只负责编译期，这里负责运行期：没有授予过的权限，调用即失败。
 */
export declare class PermissionBroker {
    private readonly granted;
    private readonly history;
    private readonly now;
    constructor(initial?: readonly Permission[], now?: () => number);
    has(permission: Permission): boolean;
    hasAll(permissions: readonly Permission[]): boolean;
    /** 未授权直接抛 PERMISSION_DENIED；details 里带权限名，便于诊断面板定位。 */
    assert(permission: Permission): void;
    /** 记录一次被拒绝的权限访问；运行期与启动期共用同一条审计口径。 */
    recordDenied(permission: Permission): void;
    assertAll(permissions: readonly Permission[]): void;
    grant(permissions: readonly Permission[]): void;
    revoke(permissions: readonly Permission[]): void;
    /** 覆盖式设置：与当前集合求差，逐项记录审计。 */
    replace(permissions: readonly Permission[]): void;
    snapshot(): readonly Permission[];
    audit(): readonly PermissionAuditEntry[];
}
