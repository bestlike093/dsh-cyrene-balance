export interface WorkArea {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface Bounds extends WorkArea {
}
export declare const DOCK_MARGIN = 24;
export declare function clampBoundsToWorkArea(bounds: Bounds, area: WorkArea): Bounds;
export declare function dockBoundsToBottomRight(size: {
    width: number;
    height: number;
}, area: WorkArea, margin?: number): Bounds;
