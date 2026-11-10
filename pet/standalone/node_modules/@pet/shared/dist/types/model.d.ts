/** 渲染适配器支持的媒体类型。新增格式只加适配器，不改上层。 */
export type ModelKind = 'live2d' | 'image' | 'gif' | 'video' | 'sprite';
/** 情绪标签：表情包与情绪引擎共用同一套词表。 */
export type EmotionTag = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'shy' | 'tired' | 'thinking' | 'excited' | 'gentle';
export declare const EMOTION_TAGS: readonly EmotionTag[];
export type ProfileName = 'vertical' | 'horizontal' | 'square' | 'card' | 'custom';
export interface SizeProfile {
    readonly name: ProfileName;
    readonly w: number;
    readonly h: number;
    /** 立绘对齐基准：底边不动向上生长 / 居中 */
    readonly anchor: 'bottom-center' | 'center';
}
/** 标准尺寸预设（CSS 像素，不含 zoomFactor）。 */
export declare const SIZE_PROFILES: Readonly<Record<Exclude<ProfileName, 'custom'>, SizeProfile>>;
export interface LoadContext {
    /** 模型资源所在的绝对路径或 URL，由 AssetManager 给出 */
    readonly source: string;
    readonly profile: SizeProfile;
    /** 像素比，用于高分屏 */
    readonly dpr: number;
    readonly signal?: AbortSignal;
}
/** 所有渲染适配器统一实现这一层，上层只认它。 */
export interface IModel {
    readonly id: string;
    readonly kind: ModelKind;
    /** 当前布局档位；`resize` 会更新它，因此不能是 readonly。 */
    profile: SizeProfile;
    load(ctx: LoadContext): Promise<void>;
    attach(canvas: HTMLCanvasElement): void;
    /**
     * 只更新布局，不重启媒体、不重置播放进度。
     * 宿主在 profile 变更时必须调用；实现方需保证幂等。
     */
    resize(profile: SizeProfile): void;
    setExpression?(tag: EmotionTag): void;
    tick(dt: number): void;
    pause(): void;
    resume(): void;
    dispose(): void;
    /** 供诊断：首帧是否真的画出了东西 */
    isRenderable(): boolean;
}
export interface ModelRecord {
    readonly id: string;
    readonly kind: ModelKind;
    readonly src: string;
    readonly profile: ProfileName;
    readonly hashSha256: string;
    readonly uploadedAt: number;
    readonly emotionTags?: readonly EmotionTag[];
}
/**
 * 等大帧的分格：一张图按 columns × rows 切成格子，行优先编号。
 * 帧尺寸是格子尺寸，不是图的尺寸。
 */
export interface SpriteSheetGrid {
    readonly columns: number;
    readonly rows: number;
    readonly frameWidth: number;
    readonly frameHeight: number;
}
/** 一段连续帧构成的片段；播放只认 startFrame + frameCount 这段窗口。 */
export interface SpriteSheetClip {
    readonly name: string;
    /** 窗口起点，0-based，行优先。 */
    readonly startFrame: number;
    readonly frameCount: number;
    readonly fps: number;
    readonly loop: boolean;
}
/**
 * 已通过校验的帧序列描述。
 *
 * `image` 是相对资源引用，必须过 `validateAssetRef`；
 * 图像本体仍由既有适配器加载，这里只描述「怎么切、怎么排」。
 */
export interface SpriteSheet {
    readonly image: string;
    readonly grid: SpriteSheetGrid;
    readonly clips: readonly SpriteSheetClip[];
}
