import type { IModel, LoadContext, ModelKind, SizeProfile } from '@pet/shared';
import type { AdapterContext, ModelAdapter } from './adapterRegistry.js';
/** 只依赖渲染所需的最小图像能力，便于在测试里替换。 */
export interface ImageLike {
    src: string;
    complete: boolean;
    naturalWidth: number;
    naturalHeight: number;
    onload: (() => void) | null;
    onerror: ((error: unknown) => void) | null;
    crossOrigin?: string | null;
}
export interface ImageAdapterOptions {
    readonly createImage?: () => ImageLike;
    readonly kind?: ModelKind;
}
export declare class ImageModel implements IModel {
    readonly id: string;
    readonly kind: ModelKind;
    profile: SizeProfile;
    private readonly source;
    private readonly dpr;
    private readonly createImage;
    private image;
    private canvas;
    private loaded;
    private paused;
    private disposed;
    private elapsed;
    constructor(context: AdapterContext, options?: ImageAdapterOptions);
    load(loadContext: LoadContext): Promise<void>;
    attach(canvas: HTMLCanvasElement): void;
    /**
     * 只改布局与画布像素尺寸，不重新加载图片；GIF 的原生动画进度因此不会重置。
     */
    resize(profile: SizeProfile): void;
    private paint;
    tick(dt: number): void;
    get elapsedSeconds(): number;
    pause(): void;
    resume(): void;
    dispose(): void;
    isRenderable(): boolean;
}
export declare function createImageAdapter(options?: ImageAdapterOptions): ModelAdapter;
