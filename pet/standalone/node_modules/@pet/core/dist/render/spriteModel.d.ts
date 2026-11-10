import type { IModel, LoadContext, ModelKind, SizeProfile, SpriteSheet } from '@pet/shared';
import type { ImageLike } from './imageAdapter.js';
export interface SpriteModelOptions {
    readonly sheet: SpriteSheet;
    readonly createImage?: () => ImageLike;
    /** 默认动作名；缺省用 clips 的第一个。 */
    readonly defaultAction?: string;
}
/**
 * 渲染状态（B2-4）。
 *
 * 空白画布不可接受：加载失败必须能被上层读到。
 * `isRenderable() === false` 只说「画不出来」，说不出「该不该提示」；
 * `'failed'` 就是那个可断言的信号。
 */
export type SpriteRenderState = 'idle' | 'loading' | 'ready' | 'failed' | 'disposed';
export declare class SpriteModel implements IModel {
    readonly id: string;
    readonly kind: ModelKind;
    profile: SizeProfile;
    private readonly sheet;
    private readonly clips;
    private readonly defaultAction;
    private readonly createImage;
    private readonly dpr;
    private image;
    private canvas;
    private action;
    private frameIndex;
    private frameElapsed;
    private loaded;
    private loadFailed;
    private paused;
    private disposed;
    constructor(context: {
        readonly id: string;
        readonly profile: SizeProfile;
        readonly dpr?: number;
    }, options: SpriteModelOptions);
    get currentAction(): string;
    /** 当前帧在整张图里的绝对索引，供诊断与命中测试使用。 */
    get currentFrame(): number;
    get isPaused(): boolean;
    /**
     * 渲染状态（B2-4）。
     *
     * `'failed'` 表示加载确实失败过，上层必须显示降级提示，不能留空白。
     * 注意它与 `'loading'` 的区别：两者 `isRenderable()` 都是 false，
     * 只有这里能区分「还在等」和「已经确定看不到」。
     */
    get renderState(): SpriteRenderState;
    load(loadContext: LoadContext): Promise<void>;
    attach(canvas: HTMLCanvasElement): void;
    resize(profile: SizeProfile): void;
    /** 切到指定动作；播完回默认的逻辑只对非循环片段生效。 */
    playAction(name: string): void;
    /** 回到默认动作。 */
    stopAction(): void;
    tick(dt: number): void;
    pause(): void;
    resume(): void;
    dispose(): void;
    isRenderable(): boolean;
    private paint;
}
