import { mountDiagnosticsPanel } from './panelDom.js';
import { createPanelController } from './panelState.js';
/**
 * 诊断面板装配（17.2.18）。
 *
 * 顺序是硬约束：
 * 1. 建容器、挂 pending —— 必须早于 startAll，否则失败模块的占位卡无处可挂；
 * 2. startAll —— 此时 failed 集合与占位集合才可能相等；
 * 3. refresh —— 诊断结果带的是启动完成后的模块状态。
 *
 * 面板本身是最小可渲染单元：不依赖模块、不等待主题注入完成。
 */
export async function bootDiagnosticsPanel(options) {
    const mount = mountDiagnosticsPanel(options.container, {
        ...(options.onRetry === undefined ? {} : { onRetry: options.onRetry }),
        ...(options.onCopy === undefined ? {} : { onCopy: options.onCopy })
    });
    // 立即挂 pending，不等任何异步结果。
    mount.update({ kind: 'pending' });
    const statuses = await options.host.startAll();
    const controller = createPanelController({
        load: options.load,
        render: (status) => mount.update(status)
    });
    await controller.refresh();
    return { mount, controller, statuses };
}
