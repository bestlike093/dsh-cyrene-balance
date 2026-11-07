/**
 * IScaler 的纯函数实现。不触碰渲染、不依赖 DOM，单测可直接跑。
 *
 * 约定：
 * - 等比缩放，只取单轴比例，任何输入都不拉伸；
 * - 默认不放大（`allowUpscale: false`），保持原始像素避免模糊；需要放大时显式开启；
 * - 所有像素结果取整（`Math.round`），避免不同 adapter 各取各的整导致 1px 偏差；
 * - 源或视口尺寸无效（0 / 负数 / NaN / Infinity）返回全零，不抛错 ——
 *   video 未拿到 metadata 时 `videoWidth` 就是 0，这是正常时序；
 * - `align` 默认 `'bottom'`；按 profile 调用时必须走 `alignForProfile()`。
 */
import { alignForProfile } from '@pet/shared';
import type { IScaler } from '@pet/shared';
export interface ScalerOptions {
    /** 源尺寸小于视口时是否允许放大；默认 false。 */
    readonly allowUpscale?: boolean;
}
export declare function createScaler(options?: ScalerOptions): IScaler;
export { alignForProfile };
