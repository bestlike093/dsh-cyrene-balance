import { SIZE_PROFILES } from '@pet/shared';
/**
 * 立绘头顶上方留给气泡 / 提问卡的高度。
 *
 * 窗口高度只按 profile.h × scale 算的话，立绘头顶离窗口上沿只剩几十像素
 * （vertical + scale 0.6 时约 47px），带选项按钮的提问卡放不下，
 * 会被窗口上沿裁成半张，看上去就像「卡片没了」。
 *
 * 这里把窗口整体加高一段。渲染层用 #headroom 占位段（styles.css，no-drag）把这段挡在
 * flex 布局之外，#stage-area 的 flex:1 吃不到它，所以立绘的大小和位置都不变，
 * 只是头顶上方多出一块专门给气泡用的区域。
 *
 * 数值必须和 styles.css 里 --bubble-headroom-reserve 的默认值保持一致。
 *
 * 注意：本文件是编译产物（apps/desktop 下没有 src，无法重新构建），
 * 改动请直接改这里，不要指望 tsc 覆盖。
 */
export const BUBBLE_HEADROOM_RESERVE = 240;
/** 由设置推导 BrowserWindow 配置，保持 core 与 Electron 完全解耦。 */
export function createWindowOptions(settings, preloadPath) {
    const profile = settings.profile === 'custom' ? SIZE_PROFILES.vertical : SIZE_PROFILES[settings.profile];
    const scale = settings.window.scale;
    const width = Math.round(profile.w * scale);
    /* 加高的部分只影响高度，不碰 x/y：位置恢复走 state.json 的 x/y，
       宽高始终由这里现算（main.mjs createWindow），所以不会写回持久化语义，
       重启也不会逐次累加。窗口超出工作区时由 clampBoundsToWorkArea 夹回。 */
    const height = Math.round(profile.h * scale) + BUBBLE_HEADROOM_RESERVE;
    return {
        width,
        height,
        ...(settings.window.x === undefined ? {} : { x: settings.window.x }),
        ...(settings.window.y === undefined ? {} : { y: settings.window.y }),
        transparent: true,
        frame: false,
        alwaysOnTop: settings.window.alwaysOnTop,
        // 固定窗口：尺寸只由设置里的缩放倍数决定，不提供拖边框缩放。
        resizable: false,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    };
}
/**
 * 窗口控制器：点击穿透、置顶、位置恢复与持久化。
 * 不引用 Electron 类型，真实壳只需实现 WindowLike。
 */
export class WindowController {
    window;
    persist;
    initialPosition;
    clickThrough = false;
    constructor(window, options = {}) {
        this.window = window;
        this.persist = options.persist;
        this.initialPosition = options.initialPosition;
    }
    get isClickThrough() {
        return this.clickThrough;
    }
    /** 穿透时保留 mousemove 转发，宠物仍然能感知鼠标靠近。 */
    setClickThrough(enabled) {
        this.clickThrough = enabled;
        this.window.setIgnoreMouseEvents(enabled, { forward: true });
    }
    toggleClickThrough() {
        this.setClickThrough(!this.clickThrough);
        return this.clickThrough;
    }
    setAlwaysOnTop(flag) {
        this.window.setAlwaysOnTop(flag);
    }
    restorePosition() {
        if (this.initialPosition === undefined)
            return;
        this.window.setBounds({ x: this.initialPosition.x, y: this.initialPosition.y });
    }
    bounds() {
        return this.window.getBounds();
    }
    async savePosition() {
        const bounds = this.window.getBounds();
        if (this.persist !== undefined)
            await this.persist(bounds);
        return bounds;
    }
    show() {
        if (!this.window.isDestroyed())
            this.window.show();
    }
    hide() {
        if (!this.window.isDestroyed())
            this.window.hide();
    }
    async load(filePath) {
        await this.window.loadFile(filePath);
    }
}
