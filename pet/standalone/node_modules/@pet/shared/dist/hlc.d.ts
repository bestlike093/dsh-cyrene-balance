/**
 * Hybrid Logical Clock。
 * 定长字符串可直接按字典序排序，不依赖 Date.now() 数字入参。
 */
export interface HlcStamp {
    readonly wall: number;
    readonly counter: number;
    readonly node: string;
}
export declare function formatHlc(stamp: HlcStamp): string;
export declare function parseHlc(value: string): HlcStamp;
/** 比较两个 HLC 字符串：<0 表示 a 更早，>0 表示 a 更晚。 */
export declare function compareHlc(a: string, b: string): number;
export declare class HybridClock {
    private wall;
    private counter;
    private readonly node;
    constructor(node?: string);
    /** 产生一个本地事件时间戳。 */
    now(): string;
    /** 收到远端时间戳后推进本地时钟，保证因果不倒退。 */
    receive(remote: string): string;
}
