/**
 * 帧序列描述解析器（B2-1）。
 *
 * 只做「把外部描述变成可信的 SpriteSheet」这一件事：
 * 纯函数、不做 IO、不碰 DOM。图像本体仍交给既有适配器加载，
 * 这里只回答「怎么切、怎么排」。
 *
 * 资源引用走既有的 `validateAssetRef`，不另开一条校验路径（13.6.5）。
 */
import type { FieldErrorV1, SpriteSheet } from '@pet/shared';
export type SpriteSheetParseResult = {
    readonly ok: true;
    readonly value: SpriteSheet;
} | {
    readonly ok: false;
    readonly errors: readonly FieldErrorV1[];
};
/**
 * 解析外部帧序列描述。
 *
 * 任一字段不合格都会收集进 errors 后整体失败，不做「部分可用」的降级——
 * 静默接受残缺描述会在播放期变成难查的空帧。
 */
export declare function parseSpriteSheet(raw: unknown): SpriteSheetParseResult;
