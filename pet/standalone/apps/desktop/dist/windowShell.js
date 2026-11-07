import { SIZE_PROFILES } from '@pet/shared';
/** 由设置推导 BrowserWindow 配置，保持 core 与 Electron 完全解耦。 */
export function createWindowOptions(settings, preloadPath) {
    const profile = settings.profile === 'custom' ? SIZE_PROFILES.vertical : SIZE_PROFILES[settings.profile];
    const scale = settings.window.scale;
    const width = Math.round(profile.w * scale);
    const height = Math.round(profile.h * scale);
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
