import { ALL_PERMISSIONS, ErrorCode, PetError } from '@pet/shared';
const ALLOWED = new Set(ALL_PERMISSIONS);
function assertKnown(permissions) {
    for (const permission of permissions) {
        if (!ALLOWED.has(permission)) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, `未知权限：${permission}`);
        }
    }
}
/**
 * 运行时权限执行器。
 * 类型白名单只负责编译期，这里负责运行期：没有授予过的权限，调用即失败。
 */
export class PermissionBroker {
    granted = new Set();
    history = [];
    now;
    constructor(initial = [], now = Date.now) {
        assertKnown(initial);
        for (const permission of initial)
            this.granted.add(permission);
        this.now = now;
    }
    has(permission) {
        return this.granted.has(permission);
    }
    hasAll(permissions) {
        return permissions.every((permission) => this.granted.has(permission));
    }
    /** 未授权直接抛 PERMISSION_DENIED；details 里带权限名，便于诊断面板定位。 */
    assert(permission) {
        if (!this.granted.has(permission)) {
            this.recordDenied(permission);
            throw new PetError(ErrorCode.PERMISSION_DENIED, `未授予权限：${permission}`, {
                details: { permission }
            });
        }
    }
    /** 记录一次被拒绝的权限访问；运行期与启动期共用同一条审计口径。 */
    recordDenied(permission) {
        this.history.push({ permission, action: 'deny', at: this.now() });
    }
    assertAll(permissions) {
        for (const permission of permissions)
            this.assert(permission);
    }
    grant(permissions) {
        assertKnown(permissions);
        for (const permission of permissions) {
            if (this.granted.has(permission))
                continue;
            this.granted.add(permission);
            this.history.push({ permission, action: 'grant', at: this.now() });
        }
    }
    revoke(permissions) {
        assertKnown(permissions);
        for (const permission of permissions) {
            if (!this.granted.delete(permission))
                continue;
            this.history.push({ permission, action: 'revoke', at: this.now() });
        }
    }
    /** 覆盖式设置：与当前集合求差，逐项记录审计。 */
    replace(permissions) {
        assertKnown(permissions);
        const next = new Set(permissions);
        const toRevoke = [...this.granted].filter((permission) => !next.has(permission));
        const toGrant = [...next].filter((permission) => !this.granted.has(permission));
        this.revoke(toRevoke);
        this.grant(toGrant);
    }
    snapshot() {
        return [...this.granted];
    }
    audit() {
        return [...this.history];
    }
}
