/**
 * 发动态。
 *
 * 只做纯文字动态：图文动态要先传图拿到图片地址，那一步在宿主那边。
 * 正文上限按 B 站前端限制定，超过就直接拒，不截断——
 * 截断会让用户以为自己发了完整的一段。
 *
 * 对应能力：`browse.post`。
 */
export interface PostDraft {
    readonly content: string;
    /** 已经上传好的图片地址，最多 9 张。 */
    readonly imageUrls?: readonly string[];
}
export interface PostRequest {
    readonly url: string;
    readonly method: 'POST';
    readonly form: Readonly<Record<string, string>>;
    readonly requiresCsrf: boolean;
    readonly summary: string;
}
export declare class PostDraftError extends Error {
    readonly field: string;
    constructor(field: string, message: string);
}
export declare const MAX_POST_LENGTH = 233;
export declare const MAX_POST_IMAGES = 9;
/** 拼一条动态请求。 */
export declare function buildPostRequest(draft: PostDraft): PostRequest;
/** 判断一条草稿能不能发，给界面用。 */
export declare function checkDraft(draft: PostDraft): readonly string[];
