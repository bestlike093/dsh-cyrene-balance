/**
 * 【保留 · 前期不实现 · 依赖 E4/E8】
 *
 * Live2D 在 2D 首发阶段只保留端口，不启用渲染路径（裁定见 13.27）。
 * 已写好的实现不删；E4（真机加载）/ E8 到位前，本文件的所有结论
 * 都基于模拟纹理，真实模型加载从未发生。
 *
 * ⛔ 不得因为「跑不通」删除 —— 它测的正是将来要启用的路径。
 */
import { ErrorCode, PetError } from '@pet/shared';
/** 由桌面壳按本地插件目录覆盖，避免把绝对路径写死在 core 里。 */
export const DEFAULT_LIVE2D_SCRIPTS = {
    pixi: 'vendor/pixi.min.js',
    live2d: 'vendor/pixi-live2d-display.min.js',
    core: 'vendor/live2dcubismcore.min.js'
};
const injected = new Set();
function documentOrThrow() {
    const g = globalThis;
    if (g.document === undefined) {
        throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '当前环境没有 document，无法注入 Live2D 脚本');
    }
    return g.document;
}
async function injectScript(src) {
    if (injected.has(src))
        return;
    const doc = documentOrThrow();
    const script = doc.createElement('script');
    script.src = src;
    script.async = true;
    await new Promise((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new PetError(ErrorCode.MODEL_LOAD_FAILED, `脚本加载失败：${src}`));
        doc.head.appendChild(script);
    }).catch((error) => {
        // 失败的标签留在 head 里，重试会一次次累积；失败即摘除。
        script.remove();
        throw error;
    });
    injected.add(src);
}
/** 顺序很重要：Cubism Core → PIXI → pixi-live2d-display。 */
export async function ensureLive2DScripts(scripts = DEFAULT_LIVE2D_SCRIPTS) {
    await injectScript(scripts.core);
    await injectScript(scripts.pixi);
    await injectScript(scripts.live2d);
}
function defaultLoader(scripts) {
    return {
        async load(source) {
            await ensureLive2DScripts(scripts);
            const g = globalThis;
            const factory = g.PIXI?.live2d?.Live2DModel;
            if (factory === undefined) {
                throw new PetError(ErrorCode.MODEL_LOAD_FAILED, 'PIXI.live2d 未就绪');
            }
            const model = await factory.from(source);
            return {
                tick: (dt) => model.update(dt * 1000),
                // 纹理是 Live2D 内存占用的主体，必须带着子节点与纹理一起销毁。
                destroy: () => model.destroy({ children: true, texture: true, baseTexture: true }),
                setExpression: (tag) => {
                    void model.expression?.(tag);
                },
                ...(model.canvas === undefined
                    ? {}
                    : {
                        attachTo: (canvas) => {
                            const parent = canvas.parentNode;
                            if (parent === null)
                                return;
                            parent.insertBefore(model.canvas, canvas);
                        }
                    })
            };
        }
    };
}
/**
 * Live2D 模型：加载失败时按配置降级到 fallback（通常是静态立绘）。
 * 降级后所有渲染调用都转发给 fallback，上层无需感知。
 */
export class Live2DModel {
    id;
    kind = 'live2d';
    profile;
    context;
    loader;
    fallback;
    loaded = null;
    delegate = null;
    canvas = null;
    paused = false;
    disposed = false;
    constructor(context, options = {}) {
        this.context = context;
        this.id = context.id;
        this.profile = context.profile;
        this.loader = options.loader ?? defaultLoader(options.scripts ?? DEFAULT_LIVE2D_SCRIPTS);
        this.fallback = options.fallback;
    }
    async load(loadContext) {
        if (this.disposed)
            throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '模型已释放');
        try {
            const loaded = await this.loader.load(loadContext.source);
            // 加载期间可能已被 dispose：释放结果，不回填、不挂载。
            if (this.disposed) {
                loaded.destroy();
                return;
            }
            this.loaded = loaded;
            if (this.canvas !== null)
                loaded.attachTo?.(this.canvas);
        }
        catch (error) {
            if (this.disposed)
                return;
            if (this.fallback === undefined) {
                throw new PetError(ErrorCode.MODEL_LOAD_FAILED, `Live2D 加载失败：${this.context.source}`, {
                    cause: error
                });
            }
            const delegate = this.fallback.create(this.context);
            await delegate.load(loadContext);
            if (this.disposed) {
                delegate.dispose();
                return;
            }
            this.delegate = delegate;
            if (this.canvas !== null)
                delegate.attach(this.canvas);
        }
    }
    attach(canvas) {
        this.canvas = canvas;
        this.delegate?.attach(canvas);
        this.loaded?.attachTo?.(canvas);
    }
    /**
     * 只更新布局档位；走降级分支时把 resize 转给 fallback，播放状态不受影响。
     */
    resize(profile) {
        if (this.disposed)
            return;
        this.profile = profile;
        this.delegate?.resize(profile);
    }
    setExpression(tag) {
        this.delegate?.setExpression?.(tag);
        this.loaded?.setExpression?.(tag);
    }
    tick(dt) {
        if (this.paused || this.disposed)
            return;
        if (this.delegate !== null) {
            this.delegate.tick(dt);
            return;
        }
        this.loaded?.tick(dt);
    }
    pause() {
        this.paused = true;
        this.delegate?.pause();
    }
    resume() {
        this.paused = false;
        this.delegate?.resume();
    }
    dispose() {
        this.delegate?.dispose();
        this.delegate = null;
        this.loaded?.destroy();
        this.loaded = null;
        this.canvas = null;
        this.disposed = true;
    }
    isRenderable() {
        if (this.disposed)
            return false;
        if (this.delegate !== null)
            return this.delegate.isRenderable();
        return this.loaded !== null;
    }
    /** 诊断用：当前是否走了降级分支。 */
    get usingFallback() {
        return this.delegate !== null;
    }
}
export function createLive2DAdapter(options = {}) {
    return {
        kind: 'live2d',
        create: (context) => new Live2DModel(context, options)
    };
}
