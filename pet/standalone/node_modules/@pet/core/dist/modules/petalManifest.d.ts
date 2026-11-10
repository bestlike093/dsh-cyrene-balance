import { PetError } from '@pet/shared';
import type { Permission } from '@pet/shared';
export interface PetalManifest {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    /** 相对模块根目录的入口文件，只允许 .js / .mjs */
    readonly entry: string;
    readonly permissions: readonly Permission[];
    readonly minHostVersion?: string;
}
export type ManifestResult = {
    readonly ok: true;
    readonly manifest: PetalManifest;
} | {
    readonly ok: false;
    readonly error: PetError;
};
/**
 * 清单校验：身份、版本、入口路径、权限白名单四项全过才算合法。
 * 未知字段忽略，便于旧版宿主读取新版清单。
 */
export declare function parsePetalManifest(raw: unknown): ManifestResult;
