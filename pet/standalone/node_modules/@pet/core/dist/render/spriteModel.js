/**
 * 帧序列模型（B2-2）。
 *
 * 只做「一个当前动作 + 播完回默认」这一层，不建状态机、不建转换表。
 * 时间推进统一走 `tick(dt)`，dt 单位是秒 —— 与 RendererHost 的口径一致。
 *
 * 绘制按 `startFrame + frameIndex` 算行列，行优先。
 */
import { ErrorCode, PetError } from '@pet/shared';
function defaultCreateImage() {
    const g = globalThis;
    if (g.document === undefined) {
        throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '当前环境没有 document，无法加载位图');
    }
    return g.document.createElement('img');
}
export class SpriteModel {
    id;
    kind = 'sprite';
    profile;
    sheet;
    clips;
    defaultAction;
    createImage;
    dpr;
    image = null;
    canvas = null;
    action;
    frameIndex = 0;
    frameElapsed = 0;
    loaded = false;
    loadFailed = false;
    paused = false;
    disposed = false;
    constructor(context, options) {
        this.id = context.id;
        this.profile = context.profile;
        this.dpr = context.dpr ?? 1;
        this.sheet = options.sheet;
        this.createImage = options.createImage ?? defaultCreateImage;
        const map = new Map();
        for (const clip of options.sheet.clips)
            map.set(clip.name, clip);
        this.clips = map;
        const first = options.sheet.clips[0];
        if (first === undefined) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '帧序列没有任何片段，无法播放');
        }
        this.defaultAction = options.defaultAction ?? first.name;
        this.action = map.get(this.defaultAction) ?? first;
    }
    get currentAction() {
        return this.action.name;
    }
    /** 当前帧在整张图里的绝对索引，供诊断与命中测试使用。 */
    get currentFrame() {
        return this.action.startFrame + this.frameIndex;
    }
    get isPaused() {
        return this.paused;
    }
    /**
     * 渲染状态（B2-4）。
     *
     * `'failed'` 表示加载确实失败过，上层必须显示降级提示，不能留空白。
     * 注意它与 `'loading'` 的区别：两者 `isRenderable()` 都是 false，
     * 只有这里能区分「还在等」和「已经确定看不到」。
     */
    get renderState() {
        if (this.disposed)
            return 'disposed';
        if (this.loadFailed)
            return 'failed';
        if (this.loaded)
            return this.isRenderable() ? 'ready' : 'failed';
        return this.image === null ? 'idle' : 'loading';
    }
    async load(loadContext) {
        if (this.disposed)
            throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '模型已释放');
        this.loadFailed = false;
        const image = this.createImage();
        image.crossOrigin = 'anonymous';
        this.image = image;
        await new Promise((resolve, reject) => {
            const cleanup = () => {
                image.onload = null;
                image.onerror = null;
            };
            if (image.complete && image.naturalWidth > 0) {
                cleanup();
                resolve();
                return;
            }
            image.onload = () => {
                cleanup();
                resolve();
            };
            image.onerror = (error) => {
                cleanup();
                this.loadFailed = true;
                reject(new PetError(ErrorCode.MODEL_LOAD_FAILED, `帧序列底图加载失败：${this.sheet.image}`, { cause: error }));
            };
            image.src = loadContext.source;
        });
        if (this.disposed) {
            this.image = null;
            return;
        }
        if (image.naturalWidth <= 0) {
            this.loadFailed = true;
            throw new PetError(ErrorCode.MODEL_NOT_RENDERABLE, `帧序列底图没有有效尺寸：${this.sheet.image}`);
        }
        this.loaded = true;
        if (this.canvas !== null)
            this.paint();
    }
    attach(canvas) {
        this.canvas = canvas;
        canvas.width = Math.round(this.profile.w * this.dpr);
        canvas.height = Math.round(this.profile.h * this.dpr);
        this.paint();
    }
    resize(profile) {
        if (this.disposed)
            return;
        this.profile = profile;
        if (this.canvas === null)
            return;
        this.canvas.width = Math.round(profile.w * this.dpr);
        this.canvas.height = Math.round(profile.h * this.dpr);
        this.paint();
    }
    /** 切到指定动作；播完回默认的逻辑只对非循环片段生效。 */
    playAction(name) {
        if (this.disposed)
            throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '模型已释放');
        const clip = this.clips.get(name);
        if (clip === undefined) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, `没有这个动作：${name}`, {
                details: { available: [...this.clips.keys()] }
            });
        }
        this.action = clip;
        this.frameIndex = 0;
        this.frameElapsed = 0;
        this.paint();
    }
    /** 回到默认动作。 */
    stopAction() {
        this.playAction(this.defaultAction);
    }
    tick(dt) {
        if (this.disposed || !this.loaded || this.paused)
            return;
        if (!(dt > 0))
            return;
        const frameDuration = 1 / this.action.fps;
        this.frameElapsed += dt;
        // while 而非 if：一帧 dt 里可能跨过多帧，低帧率设备上必须追上。
        while (this.frameElapsed >= frameDuration) {
            this.frameElapsed -= frameDuration;
            this.frameIndex += 1;
            if (this.frameIndex >= this.action.frameCount) {
                if (this.action.loop) {
                    this.frameIndex = 0;
                }
                else {
                    // 非循环动作播到最后一帧：停在末帧，然后回默认。
                    this.frameIndex = this.action.frameCount - 1;
                    this.playAction(this.defaultAction);
                    break;
                }
            }
        }
        this.paint();
    }
    pause() {
        this.paused = true;
    }
    resume() {
        this.paused = false;
    }
    dispose() {
        this.image = null;
        this.canvas = null;
        this.loaded = false;
        this.disposed = true;
    }
    isRenderable() {
        return !this.disposed && this.loaded && (this.image?.naturalWidth ?? 0) > 0;
    }
    paint() {
        if (this.image === null || this.canvas === null || !this.loaded)
            return;
        const ctx = this.canvas.getContext('2d');
        if (ctx === null)
            return;
        const absolute = this.action.startFrame + this.frameIndex;
        const { columns, rows, frameWidth, frameHeight } = this.sheet.grid;
        if (absolute < 0 || absolute >= columns * rows)
            return;
        const col = absolute % columns;
        const row = Math.floor(absolute / columns);
        try {
            // 画布比例由窗口尺寸决定，和素材帧比例通常不一致。
            // 直接拉满会把立绘压扁，这里按短边等比缩放并居中，多出来的方向留透明。
            const scale = Math.min(this.canvas.width / frameWidth, this.canvas.height / frameHeight);
            const targetWidth = frameWidth * scale;
            const targetHeight = frameHeight * scale;
            const offsetX = (this.canvas.width - targetWidth) / 2;
            const offsetY = (this.canvas.height - targetHeight) / 2;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.drawImage(this.image, col * frameWidth, row * frameHeight, frameWidth, frameHeight, offsetX, offsetY, targetWidth, targetHeight);
        }
        catch {
            // 测试替身没有真实 2D 上下文时跳过绘制，不影响 renderable 判定
        }
    }
}
