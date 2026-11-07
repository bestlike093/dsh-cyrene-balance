import { ErrorCode, PetError } from '@pet/shared';
const FALLBACK_VERSION = '0.0.0-unknown';
/**
 * 能力判定以宿主真实声明为准。
 *
 * 传了 `HostCapabilitySnapshot` 就完全按 `available` 判定；
 * 没传时只能按宿主对象上的实际方法探测，`settings` / `tray` / `window`
 * 在 `HostAdapter` 契约里没有对应方法，一律 fail-closed，不再硬编码 true。
 */
function detect(host, snapshot) {
    const version = snapshot?.version ?? host?.version ?? FALLBACK_VERSION;
    if (host === undefined) {
        return {
            version,
            ask: false,
            approval: false,
            taskProgress: false,
            settings: false,
            tray: false,
            window: false
        };
    }
    const declared = snapshot === undefined ? undefined : new Set(snapshot.available);
    const supports = (cap, fallback) => declared === undefined ? fallback : declared.has(cap);
    const extended = host;
    return {
        version,
        ask: supports('ask', typeof host.ask === 'function') && typeof host.ask === 'function',
        approval: supports('approval', typeof host.approve === 'function') && typeof host.approve === 'function',
        taskProgress: supports('taskProgress', typeof host.reportTask === 'function') &&
            typeof host.reportTask === 'function',
        settings: supports('settings', typeof extended.openSettings === 'function'),
        tray: supports('tray', typeof extended.showTray === 'function'),
        window: supports('window', typeof extended.getWindow === 'function')
    };
}
/**
 * 全项目唯一允许接触宿主的入口。
 * 宿主缺失时统一降级为 NOT_SUPPORTED，而不是抛底层错误让调用方崩掉。
 */
export class DshBridge {
    host;
    caps;
    constructor(host, snapshot) {
        this.host = host;
        this.caps = detect(host, snapshot);
    }
    static connect(host, snapshot) {
        return new DshBridge(host, snapshot);
    }
    capabilities() {
        return this.caps;
    }
    isAvailable(cap) {
        return this.caps[cap];
    }
    async ask(request) {
        if (this.host?.ask === undefined) {
            throw new PetError(ErrorCode.NOT_SUPPORTED, '宿主未提供提问接管');
        }
        return this.host.ask(request);
    }
    async approve(request) {
        if (this.host?.approve === undefined) {
            throw new PetError(ErrorCode.NOT_SUPPORTED, '宿主未提供审批接管');
        }
        return this.host.approve(request);
    }
    reportTask(progress) {
        this.host?.reportTask?.(progress);
    }
    /** 诊断面板用：把能力快照压成一行，方便贴日志。 */
    describe() {
        const c = this.caps;
        const flags = [
            c.ask ? 'ask' : '',
            c.approval ? 'approval' : '',
            c.taskProgress ? 'taskProgress' : '',
            c.settings ? 'settings' : '',
            c.tray ? 'tray' : '',
            c.window ? 'window' : ''
        ].filter(Boolean);
        return `dsh ${c.version} [${flags.join(',') || 'none'}]`;
    }
}
