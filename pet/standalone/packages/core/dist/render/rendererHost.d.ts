import type { IModel, SizeProfile } from '@pet/shared';
export interface RenderEnvironment {
    readonly requestFrame: (callback: (time: number) => void) => number;
    readonly cancelFrame: (handle: number) => void;
    readonly now: () => number;
}
/** 浏览器优先 requestAnimationFrame，Node/测试环境退化为 16ms 定时器。 */
export declare function createRenderEnvironment(): RenderEnvironment;
export interface RendererHostOptions {
    readonly environment?: RenderEnvironment;
    /** 单帧最大步长（秒），防止后台切回时一次性补太多帧 */
    readonly maxDelta?: number;
}
/** 只取事件订阅能力，避免把 DOM 类型带进纯逻辑层。 */
export interface EventSourceLike {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}
export interface DocumentSourceLike extends EventSourceLike {
    readonly hidden: boolean;
}
/**
 * 渲染宿主：只负责节奏与生命周期，不认识具体模型格式。
 * 适配器负责画，宿主负责何时画、何时停。
 */
export declare class RendererHost {
    private readonly environment;
    private readonly maxDelta;
    private model;
    private handle;
    private lastTime;
    private frames;
    private running;
    constructor(options?: RendererHostOptions);
    get isRunning(): boolean;
    get frameCount(): number;
    get attached(): IModel | null;
    attach(model: IModel): void;
    detach(): IModel | null;
    /**
     * 广播布局变更给当前模型。
     * 只转发 resize，不暂停、不重启播放，由适配器自行处理进度保持。
     */
    resize(profile: SizeProfile): void;
    start(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    /**
     * 接真实页面事件：失焦 / 页面隐藏 ⇒ 暂停；回来 ⇒ 续播。
     *
     * 只暴露 `pause()` 而不订阅事件的实现，在内测里会表现为「窗口切走了还在跑」，
     * 被当成性能问题报回来。返回解绑函数，交给持有方在销毁时调用。
     */
    bindLifecycle(windowSource: EventSourceLike, documentSource: DocumentSourceLike): () => void;
    /** 释放：先停帧，再断开模型。事件解绑由 bindLifecycle 的返回值负责。 */
    dispose(): void;
    private schedule;
    private cancelScheduled;
    private tick;
    /** 测试用：让宿主手动推进一帧，不依赖真实定时器。 */
    step(deltaSeconds: number): void;
}
