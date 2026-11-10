import type { DisposerRegistry } from '@pet/shared';
/** 逆序释放：后注册的先拆，符合资源依赖方向。单个释放失败不阻断其余清理。 */
export declare function createDisposerRegistry(): DisposerRegistry;
