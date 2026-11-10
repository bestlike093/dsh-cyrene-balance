/** 整帧矩形：B2 阶段角色与画布等大。 */
export function fullFrameRect(size) {
    return { x: 0, y: 0, w: size.w, h: size.h };
}
export function hitTest(point, rect) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
        return false;
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y))
        return false;
    if (!(rect.w > 0) || !(rect.h > 0))
        return false;
    return (point.x >= rect.x &&
        point.x < rect.x + rect.w &&
        point.y >= rect.y &&
        point.y < rect.y + rect.h);
}
/**
 * 坐标缩放：页面坐标 → 画布逻辑坐标。
 *
 * 画布可能被 CSS 拉伸，点击坐标直接跟 profile 比会错位。
 * scale 取 0 或负数时返回 null，由调用方决定降级（不静默当成命中）。
 */
export function toCanvasPoint(point, scale) {
    if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y))
        return null;
    if (!(scale.x > 0) || !(scale.y > 0))
        return null;
    return { x: point.x / scale.x, y: point.y / scale.y };
}
