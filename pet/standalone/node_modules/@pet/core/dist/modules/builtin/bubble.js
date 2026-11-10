import { ErrorCode, PetError } from '@pet/shared';
/** 气泡模块：只做渲染，不读写磁盘、不联网。 */
export const bubbleModule = {
    meta: {
        id: 'builtin.bubble',
        name: '气泡',
        version: '1.0.0',
        permissions: ['ui.render'],
        // 必要模块：关掉她就不能再说话，所以关闭时必须先警告后果
        tier: 'essential'
    },
    async bootstrap(ctx) {
        const sandbox = ctx;
        const render = sandbox.api.ui?.render;
        if (render === undefined) {
            throw new PetError(ErrorCode.PERMISSION_DENIED, '气泡模块缺少 ui.render');
        }
        render('<div class="pet-bubble" role="status" aria-live="polite"></div>');
    },
    async teardown() {
        // 气泡是纯 DOM，挂载点由宿主统一回收
    }
};
