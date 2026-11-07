/**
 * v2.1 渲染与上传契约（文档第 2 章）。
 * 上层只认 IModel + IScaler；PIXI 只是其中一种实现。
 */
import type { EmotionTag, ModelKind, SizeProfile } from '../types/model.js';
export interface Size {
    readonly w: number;
    readonly h: number;
}
/** 兼容旧命名；结构同 Size。 */
export type NaturalSize = Size;
export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}
export interface FitResult {
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly width: number;
    readonly height: number;
}
export type Align = 'center' | 'bottom';
/** 等比缩放并对齐，任何尺寸都不能拉伸。 */
export interface IScaler {
    /**
     * @param align 默认 `'bottom'`（底边不动、向上生长）。
     * 调用方按 `profile.anchor` 取值时必须走 `alignForProfile()`，不要手写三元。
     */
    fit(source: Size, viewport: Size, align?: Align): FitResult;
    /** card 档强制 zoom=1；其余按传入值缩放，结果取整。 */
    windowSizeFor(profile: SizeProfile, zoom: number): Size;
    /** 扣除底部面板后的内容区；面板高于窗口时高度为 0。 */
    contentRect(window: Size, panelHeight: number): Rect;
    /** 同模型同 profile 同 dpr 必须命中同一缓存键 */
    cacheKey(kind: ModelKind, natural: Size, target: SizeProfile, dpr: number): string;
}
/** `profile.anchor` 到 `fit(align)` 的唯一映射入口。 */
export declare function alignForProfile(profile: SizeProfile): Align;
export type AssetRole = 'model' | 'texture' | 'expression' | 'motion' | 'meta';
export interface UploadedAsset {
    /** 相对模型根目录的路径，禁止 .. 与绝对路径 */
    readonly path: string;
    readonly role: AssetRole;
    readonly bytes: number;
    readonly hashSha256: string;
}
export interface ModelUploadManifest {
    readonly id: string;
    readonly name: string;
    readonly kind: ModelKind;
    /** 入口文件，相对模型根目录 */
    readonly entry: string;
    readonly hashSha256: string;
    /** 表情包必须标注情绪，上传时逐张填 */
    readonly emotionTags: readonly EmotionTag[];
    readonly createdAt: number;
    readonly files: readonly UploadedAsset[];
    /**
     * 预览图地址（pet-media://）。可选：作者没放预览图时为 null，
     * 老数据也可能不带这个字段，读取方必须容忍缺失。
     */
    readonly preview?: string | null;
}
export interface UploadInspection {
    readonly ok: boolean;
    readonly manifest?: ModelUploadManifest;
    readonly errors: readonly string[];
}
export interface IModelUploader {
    /** 只读检查：解压到临时目录、校验 magic、计算哈希，不写入模型库 */
    inspect(zipPath: string): Promise<UploadInspection>;
    /** 通过检查后才写入；写入失败必须回滚临时目录 */
    install(zipPath: string, options?: {
        readonly replace?: boolean;
    }): Promise<ModelUploadManifest>;
}
export interface RenderProfile {
    readonly profile: SizeProfile;
    readonly dpr: number;
    readonly fpsCap: number;
}
/**
 * 按文件名判断媒体类型。入口统一在这里，避免 renderer 与上传流水线各写一套。
 * 未知扩展名返回 null，由调用方明确拒绝。
 */
export declare function mediaKindForName(name: string): ModelKind | null;
