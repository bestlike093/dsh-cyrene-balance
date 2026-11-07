import { DshBridge } from '@pet/core';
export function createHostAdapter(version, wiring = {}) {
    return {
        version,
        ...(wiring.ask === undefined ? {} : { ask: wiring.ask }),
        ...(wiring.approve === undefined ? {} : { approve: wiring.approve }),
        ...(wiring.reportTask === undefined ? {} : { reportTask: wiring.reportTask })
    };
}
/**
 * 把宿主接线交给 core 的能力探测。
 * 缺失的能力不会在启动时报错，而是在第一次调用时统一降级为 NOT_SUPPORTED。
 */
export function createDesktopBridge(version, wiring = {}, snapshot) {
    return DshBridge.connect(createHostAdapter(version, wiring), snapshot);
}
