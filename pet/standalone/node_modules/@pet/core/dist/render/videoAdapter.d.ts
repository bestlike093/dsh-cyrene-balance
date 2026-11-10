import type { IModel, LoadContext, ModelKind, SizeProfile } from '@pet/shared';
import type { AdapterContext, ModelAdapter } from './adapterRegistry.js';
export interface VideoLike {
    src: string;
    readyState: number;
    videoWidth: number;
    videoHeight: number;
    muted: boolean;
    loop: boolean;
    playsInline?: boolean;
    onloadedmetadata?: (() => void) | null;
    onloadeddata: (() => void) | null;
    onerror: ((error: unknown) => void) | null;
    play(): Promise<void>;
    pause(): void;
    load(): void;
    /** 真实元素用它断开 src；测试替身可以只支持 src。 */
    removeAttribute?: (name: string) => void;
    /** 元素已挂进文档时用于摘除；测试替身可以没有。 */
    remove?: () => void;
}
export interface VideoAdapterOptions {
    readonly createVideo?: () => VideoLike;
    /** 元素摘除钩子：dispose 时调用，默认 video.remove()。 */
    readonly releaseVideo?: (video: VideoLike) => void;
}
export declare class VideoModel implements IModel {
    readonly id: string;
    readonly kind: ModelKind;
    profile: SizeProfile;
    private readonly source;
    private readonly dpr;
    private readonly createVideo;
    private readonly releaseVideo;
    private video;
    private canvas;
    private loaded;
    private paused;
    private disposed;
    /** 尺寸门未开时暂存，等 loadedmetadata 补应用；换源时保留。 */
    private pendingProfile;
    constructor(context: AdapterContext, options?: VideoAdapterOptions);
    load(loadContext: LoadContext): Promise<void>;
    attach(canvas: HTMLCanvasElement): void;
    /**
     * 只改布局与画布像素尺寸。
     * 不得触碰 `<video>`：不调 load()、不改 src、不暂停/重播，播放进度保持原样。
     *
     * 尺寸门与首帧门分开：
     * - `readyState >= HAVE_METADATA(1)` 就能拿到固有宽高，可立即应用；
     * - `readyState < 1`（换源瞬间 / 启动期）不丢弃，先存 `pendingProfile`，等 loadedmetadata 补。
     */
    resize(profile: SizeProfile): void;
    private applyLayout;
    tick(): void;
    pause(): void;
    resume(): void;
    dispose(): void;
    isRenderable(): boolean;
    get isPaused(): boolean;
}
export declare function createVideoAdapter(options?: VideoAdapterOptions): ModelAdapter;
