import { ErrorCode, PetError } from '@pet/shared';
function defaultCreateImage() {
    const g = globalThis;
    if (g.document === undefined) {
        throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '当前环境没有 document，无法加载位图');
    }
    return g.document.createElement('img');
}
export class ImageModel {
    id;
    kind;
    profile;
    source;
    dpr;
    createImage;
    image = null;
    canvas = null;
    loaded = false;
    paused = false;
    disposed = false;
    elapsed = 0;
    constructor(context, options = {}) {
        this.id = context.id;
        this.kind = options.kind ?? 'image';
        this.profile = context.profile;
        this.source = context.source;
        this.dpr = context.dpr;
        this.createImage = options.createImage ?? defaultCreateImage;
    }
    async load(loadContext) {
        if (this.disposed)
            throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '模型已释放');
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
                reject(new PetError(ErrorCode.MODEL_LOAD_FAILED, `图片加载失败：${this.source}`, { cause: error }));
            };
            image.src = loadContext.source;
        }).catch((error) => {
            this.loaded = false;
            throw error;
        });
        // 交给事件之前可能已被 dispose：丢弃结果，不回填、不绘制。
        if (this.disposed) {
            this.image = null;
            return;
        }
        if (image.naturalWidth <= 0) {
            throw new PetError(ErrorCode.MODEL_NOT_RENDERABLE, `图片没有有效尺寸：${this.source}`);
        }
        this.loaded = true;
        if (this.canvas !== null)
            this.paint();
    }
    attach(canvas) {
        this.canvas = canvas;
        this.paint();
    }
    /**
     * 只改布局与画布像素尺寸，不重新加载图片；GIF 的原生动画进度因此不会重置。
     */
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
    paint() {
        if (this.image === null || this.canvas === null || !this.loaded)
            return;
        const { naturalWidth, naturalHeight } = this.image;
        if (naturalWidth <= 0 || naturalHeight <= 0)
            return;
        try {
            const ctx = this.canvas.getContext('2d');
            if (ctx === null)
                return;
            const w = this.canvas.width;
            const h = this.canvas.height;
            // contain：按原图比例等比缩放并居中，多余方向留透明，不拉满画布。
            const scale = Math.min(w / naturalWidth, h / naturalHeight);
            const drawWidth = naturalWidth * scale;
            const drawHeight = naturalHeight * scale;
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(this.image, (w - drawWidth) / 2, (h - drawHeight) / 2, drawWidth, drawHeight);
        }
        catch {
            // 没有 2D 上下文的环境（测试替身）跳过绘制，不影响 renderable 判定
        }
    }
    tick(dt) {
        if (!this.paused && !this.disposed)
            this.elapsed += dt;
    }
    get elapsedSeconds() {
        return this.elapsed;
    }
    pause() {
        this.paused = true;
    }
    resume() {
        this.paused = false;
    }
    dispose() {
        if (this.image !== null) {
            this.image.onload = null;
            this.image.onerror = null;
        }
        this.image = null;
        this.canvas = null;
        this.loaded = false;
        this.disposed = true;
    }
    isRenderable() {
        return !this.disposed && this.loaded && (this.image?.naturalWidth ?? 0) > 0;
    }
}
export function createImageAdapter(options = {}) {
    return {
        kind: options.kind ?? 'image',
        create: (context) => new ImageModel(context, options)
    };
}
