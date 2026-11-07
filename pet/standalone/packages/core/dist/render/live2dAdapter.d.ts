import type { EmotionTag, IModel, LoadContext, ModelKind, SizeProfile } from '@pet/shared';
import type { AdapterContext, ModelAdapter } from './adapterRegistry.js';
export interface Live2DScripts {
    readonly pixi: string;
    readonly live2d: string;
    readonly core: string;
}
/** 由桌面壳按本地插件目录覆盖，避免把绝对路径写死在 core 里。 */
export declare const DEFAULT_LIVE2D_SCRIPTS: Live2DScripts;
export interface LoadedLive2D {
    tick(dt: number): void;
    destroy(): void;
    setExpression?(tag: EmotionTag): void;
    attachTo?(canvas: HTMLCanvasElement): void;
}
export interface Live2DLoader {
    load(source: string): Promise<LoadedLive2D>;
}
export interface Live2DAdapterOptions {
    readonly loader?: Live2DLoader;
    /** 模型加载失败时降级用的适配器，例如静态立绘 */
    readonly fallback?: ModelAdapter;
    readonly scripts?: Live2DScripts;
}
/** 顺序很重要：Cubism Core → PIXI → pixi-live2d-display。 */
export declare function ensureLive2DScripts(scripts?: Live2DScripts): Promise<void>;
/**
 * Live2D 模型：加载失败时按配置降级到 fallback（通常是静态立绘）。
 * 降级后所有渲染调用都转发给 fallback，上层无需感知。
 */
export declare class Live2DModel implements IModel {
    readonly id: string;
    readonly kind: ModelKind;
    profile: SizeProfile;
    private readonly context;
    private readonly loader;
    private readonly fallback;
    private loaded;
    private delegate;
    private canvas;
    private paused;
    private disposed;
    constructor(context: AdapterContext, options?: Live2DAdapterOptions);
    load(loadContext: LoadContext): Promise<void>;
    attach(canvas: HTMLCanvasElement): void;
    /**
     * 只更新布局档位；走降级分支时把 resize 转给 fallback，播放状态不受影响。
     */
    resize(profile: SizeProfile): void;
    setExpression(tag: EmotionTag): void;
    tick(dt: number): void;
    pause(): void;
    resume(): void;
    dispose(): void;
    isRenderable(): boolean;
    /** 诊断用：当前是否走了降级分支。 */
    get usingFallback(): boolean;
}
export declare function createLive2DAdapter(options?: Live2DAdapterOptions): ModelAdapter;
