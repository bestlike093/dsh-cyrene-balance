/**
 * 矩形命中判定（B2-3）。
 *
 * 只回答一个问题：点击点是否落在角色矩形内。
 * 不做 alpha 采样，不做多边形，不做逐帧差异 —— 矩形覆盖整帧，
 * **透明区域也会命中**。这条限制必须写进包 2 的「已知问题」，
 * 否则内测者会反馈「点空白处也有反应」，而我们以为命中了。
 *
 * 坐标口径：画布逻辑像素，原点左上，边界左闭右开。
 * 与 Canvas 绘制口径一致，相邻矩形不会重复命中同一条边。
 */
export interface HitRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}
export interface HitPoint {
    readonly x: number;
    readonly y: number;
}
/** 整帧矩形：B2 阶段角色与画布等大。 */
export declare function fullFrameRect(size: {
    readonly w: number;
    readonly h: number;
}): HitRect;
export declare function hitTest(point: HitPoint, rect: HitRect): boolean;
/**
 * 坐标缩放：页面坐标 → 画布逻辑坐标。
 *
 * 画布可能被 CSS 拉伸，点击坐标直接跟 profile 比会错位。
 * scale 取 0 或负数时返回 null，由调用方决定降级（不静默当成命中）。
 */
export declare function toCanvasPoint(point: HitPoint, scale: {
    readonly x: number;
    readonly y: number;
}): HitPoint | null;
