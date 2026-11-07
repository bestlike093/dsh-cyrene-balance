import type { SettingsV2 } from '@pet/shared';
export interface WindowBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface WindowOptions {
    readonly width: number;
    readonly height: number;
    readonly x?: number;
    readonly y?: number;
    readonly transparent: boolean;
    readonly frame: boolean;
    readonly alwaysOnTop: boolean;
    readonly resizable: boolean;
    readonly skipTaskbar: boolean;
    readonly hasShadow: boolean;
    readonly webPreferences: {
        readonly preload: string;
        readonly contextIsolation: true;
        readonly nodeIntegration: false;
        readonly sandbox: true;
    };
}
/** 由设置推导 BrowserWindow 配置，保持 core 与 Electron 完全解耦。 */
export declare function createWindowOptions(settings: SettingsV2, preloadPath: string): WindowOptions;
export interface WindowLike {
    setIgnoreMouseEvents(ignore: boolean, options?: {
        forward?: boolean;
    }): void;
    setAlwaysOnTop(flag: boolean): void;
    getBounds(): WindowBounds;
    setBounds(bounds: Partial<WindowBounds>): void;
    loadFile(path: string): Promise<void>;
    show(): void;
    hide(): void;
    isDestroyed(): boolean;
}
export interface WindowControllerOptions {
    readonly initialPosition?: {
        readonly x: number;
        readonly y: number;
    };
    readonly persist?: (bounds: WindowBounds) => Promise<void> | void;
}
/**
 * 窗口控制器：点击穿透、置顶、位置恢复与持久化。
 * 不引用 Electron 类型，真实壳只需实现 WindowLike。
 */
export declare class WindowController {
    private readonly window;
    private readonly persist;
    private readonly initialPosition;
    private clickThrough;
    constructor(window: WindowLike, options?: WindowControllerOptions);
    get isClickThrough(): boolean;
    /** 穿透时保留 mousemove 转发，宠物仍然能感知鼠标靠近。 */
    setClickThrough(enabled: boolean): void;
    toggleClickThrough(): boolean;
    setAlwaysOnTop(flag: boolean): void;
    restorePosition(): void;
    bounds(): WindowBounds;
    savePosition(): Promise<WindowBounds>;
    show(): void;
    hide(): void;
    load(filePath: string): Promise<void>;
}
