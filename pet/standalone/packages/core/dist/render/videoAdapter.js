import { ErrorCode, PetError } from '@pet/shared';
function defaultCreateVideo() {
    const g = globalThis;
    if (g.document === undefined) {
        throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '当前环境没有 document，无法加载视频');
    }
    return g.document.createElement('video');
}
export class VideoModel {
    id;
    kind = 'video';
    profile;
    source;
    dpr;
    createVideo;
    releaseVideo;
    video = null;
    canvas = null;
    loaded = false;
    paused = false;
    disposed = false;
    /** 尺寸门未开时暂存，等 loadedmetadata 补应用；换源时保留。 */
    pendingProfile = null;
    constructor(context, options = {}) {
        this.id = context.id;
        this.profile = context.profile;
        this.source = context.source;
        this.dpr = context.dpr;
        this.createVideo = options.createVideo ?? defaultCreateVideo;
        this.releaseVideo = options.releaseVideo ?? ((video) => video.remove?.());
    }
    async load(loadContext) {
        if (this.disposed)
            throw new PetError(ErrorCode.MODEL_LOAD_FAILED, '模型已释放');
        // 换源：上一轮的“可渲染”判定立即失效，新源要重新走两道门。
        this.loaded = false;
        const video = this.createVideo();
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        this.video = video;
        await new Promise((resolve, reject) => {
            const cleanup = () => {
                video.onloadedmetadata = null;
                video.onloadeddata = null;
                video.onerror = null;
            };
            // 尺寸门：只要有元数据就能拿到固有宽高，不必等首帧。
            if (video.readyState >= 1 && video.videoWidth > 0)
                this.applyLayout();
            // 首帧门：HAVE_CURRENT_DATA 才算可渲染。
            if (video.readyState >= 2 && video.videoWidth > 0) {
                cleanup();
                resolve();
                return;
            }
            video.onloadedmetadata = () => {
                if (this.disposed)
                    return;
                this.applyLayout();
            };
            video.onloadeddata = () => {
                if (this.disposed)
                    return;
                // 帧已到：补一次布局，确保“元信息先到、帧后到”时不会停在旧尺寸。
                this.applyLayout();
                cleanup();
                resolve();
            };
            video.onerror = (error) => {
                cleanup();
                reject(new PetError(ErrorCode.MODEL_LOAD_FAILED, `视频加载失败：${this.source}`, { cause: error }));
            };
            video.src = loadContext.source;
            video.load();
        });
        if (video.videoWidth <= 0) {
            throw new PetError(ErrorCode.MODEL_NOT_RENDERABLE, `视频没有有效尺寸：${this.source}`);
        }
        this.loaded = true;
        // 后挂载的 canvas 在媒体就绪后才拿到原始宽高，这里补一次布局。
        this.applyLayout();
        try {
            await video.play();
        }
        catch {
            // 自动播放被策略拦截时保留首帧，不算加载失败
        }
    }
    attach(canvas) {
        this.canvas = canvas;
        const g = canvas;
        const parent = g.parentNode;
        if (parent?.insertBefore !== undefined && this.video !== null) {
            try {
                parent.insertBefore(this.video, canvas);
            }
            catch {
                // 测试替身没有真实 DOM，跳过挂载
            }
        }
    }
    /**
     * 只改布局与画布像素尺寸。
     * 不得触碰 `<video>`：不调 load()、不改 src、不暂停/重播，播放进度保持原样。
     *
     * 尺寸门与首帧门分开：
     * - `readyState >= HAVE_METADATA(1)` 就能拿到固有宽高，可立即应用；
     * - `readyState < 1`（换源瞬间 / 启动期）不丢弃，先存 `pendingProfile`，等 loadedmetadata 补。
     */
    resize(profile) {
        if (this.disposed)
            return;
        this.profile = profile;
        if (this.video === null || this.video.readyState < 1 || this.video.videoWidth <= 0) {
            this.pendingProfile = profile;
            return;
        }
        this.applyLayout();
    }
    applyLayout() {
        if (this.disposed)
            return;
        if (this.canvas === null)
            return;
        if (this.video === null)
            return;
        // 尺寸门只到 HAVE_METADATA；首帧门由 isRenderable() 单独看。
        if (this.video.readyState < 1 || this.video.videoWidth <= 0)
            return;
        this.canvas.width = Math.round(this.profile.w * this.dpr);
        this.canvas.height = Math.round(this.profile.h * this.dpr);
        this.pendingProfile = null;
    }
    tick() {
        // 视频由浏览器原生解码，宿主不需要逐帧推进
    }
    pause() {
        this.paused = true;
        this.video?.pause();
    }
    resume() {
        this.paused = false;
        void this.video?.play().catch(() => undefined);
    }
    dispose() {
        const video = this.video;
        if (video !== null) {
            // 赋值式监听用 removeEventListener 清不掉，只能逐项置 null。
            video.onloadedmetadata = null;
            video.onloadeddata = null;
            video.onerror = null;
            video.pause();
            // src = '' 会让浏览器把当前页面 URL 当视频源去请求；
            // 先断开 src 再 load()，才会真正释放解码器与缓冲。
            if (video.removeAttribute !== undefined) {
                video.removeAttribute('src');
            }
            else {
                video.src = '';
            }
            video.load();
        }
        this.video = null;
        this.loaded = false;
        this.pendingProfile = null;
        this.disposed = true;
        // 解码已断开，最后再从文档摘除。
        if (video !== null)
            this.releaseVideo(video);
    }
    isRenderable() {
        if (this.disposed || !this.loaded || this.video === null)
            return false;
        return this.video.readyState >= 2 && this.video.videoWidth > 0;
    }
    get isPaused() {
        return this.paused;
    }
}
export function createVideoAdapter(options = {}) {
    return {
        kind: 'video',
        create: (context) => new VideoModel(context, options)
    };
}
