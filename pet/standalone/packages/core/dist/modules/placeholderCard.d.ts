import type { DisposerRegistry } from '@pet/shared';
import type { PlaceholderHandle, PlaceholderInfo } from './moduleHost.js';
export interface PlaceholderCardOptions {
    readonly document: Document;
    readonly info: PlaceholderInfo;
    /** 传了就把整张卡片的 teardown 一并交给宿主的 disposer。 */
    readonly disposers?: DisposerRegistry;
    readonly onRetry?: () => void;
    readonly onDiagnose?: () => void;
}
export interface PlaceholderCardHandle extends PlaceholderHandle {
    readonly element: HTMLElement;
}
/**
 * 宿主统一渲染的占位卡。
 *
 * 监听器与节点都归这张卡自己管：teardown 先摘监听器再移除节点，
 * 传了 disposers 时由宿主在停止模块时统一释放。
 */
export declare function createPlaceholderCard(options: PlaceholderCardOptions): PlaceholderCardHandle;
