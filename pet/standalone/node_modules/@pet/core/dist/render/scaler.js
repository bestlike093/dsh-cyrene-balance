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
const ZERO_FIT = { scale: 0, offsetX: 0, offsetY: 0, width: 0, height: 0 };
function isPositiveFinite(value) {
    return Number.isFinite(value) && value > 0;
}
export function createScaler(options = {}) {
    const allowUpscale = options.allowUpscale ?? false;
    return {
        fit(source, viewport, align = 'bottom') {
            if (!isPositiveFinite(source.w) ||
                !isPositiveFinite(source.h) ||
                !isPositiveFinite(viewport.w) ||
                !isPositiveFinite(viewport.h)) {
                return ZERO_FIT;
            }
            const rawScale = Math.min(viewport.w / source.w, viewport.h / source.h);
            const scale = allowUpscale ? rawScale : Math.min(rawScale, 1);
            const width = Math.round(source.w * scale);
            const height = Math.round(source.h * scale);
            const offsetX = Math.round((viewport.w - width) / 2);
            const offsetY = align === 'bottom' ? Math.round(viewport.h - height) : Math.round((viewport.h - height) / 2);
            return { scale, offsetX, offsetY, width, height };
        },
        windowSizeFor(profile, zoom) {
            // card 是固定小卡，zoom 不参与，兼容红线 3。
            const effectiveZoom = profile.name === 'card' ? 1 : isPositiveFinite(zoom) ? zoom : 1;
            return {
                w: Math.round(profile.w * effectiveZoom),
                h: Math.round(profile.h * effectiveZoom)
            };
        },
        contentRect(window, panelHeight) {
            if (!isPositiveFinite(window.w) || !isPositiveFinite(window.h)) {
                return { x: 0, y: 0, w: 0, h: 0 };
            }
            const reserved = Number.isFinite(panelHeight) && panelHeight > 0 ? panelHeight : 0;
            return {
                x: 0,
                y: 0,
                w: Math.round(window.w),
                h: Math.max(0, Math.round(window.h - reserved))
            };
        },
        cacheKey(kind, natural, target, dpr) {
            return `${kind}|${natural.w}x${natural.h}|${target.name}|${target.w}x${target.h}|${target.anchor}|dpr=${dpr}`;
        }
    };
}
export { alignForProfile };
