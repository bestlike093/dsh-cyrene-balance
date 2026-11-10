/**
 * 发动态。
 *
 * 只做纯文字动态：图文动态要先传图拿到图片地址，那一步在宿主那边。
 * 正文上限按 B 站前端限制定，超过就直接拒，不截断——
 * 截断会让用户以为自己发了完整的一段。
 *
 * 对应能力：`browse.post`。
 */
const API = 'https://api.bilibili.com';
export class PostDraftError extends Error {
    field;
    constructor(field, message) {
        super(`post.${field}：${message}`);
        this.name = 'PostDraftError';
        this.field = field;
    }
}
export const MAX_POST_LENGTH = 233;
export const MAX_POST_IMAGES = 9;
/** 拼一条动态请求。 */
export function buildPostRequest(draft) {
    const content = draft.content.trim();
    if (content.length === 0) {
        throw new PostDraftError('content', '正文不能为空');
    }
    if (content.length > MAX_POST_LENGTH) {
        throw new PostDraftError('content', `最多 ${MAX_POST_LENGTH} 字，当前 ${content.length}`);
    }
    const images = draft.imageUrls ?? [];
    if (images.length > MAX_POST_IMAGES) {
        throw new PostDraftError('imageUrls', `最多 ${MAX_POST_IMAGES} 张图`);
    }
    for (const url of images) {
        if (!/^https?:\/\//i.test(url)) {
            throw new PostDraftError('imageUrls', `图片地址不合法：${url.slice(0, 40)}`);
        }
    }
    return {
        url: `${API}/x/dynamic/feed/create/dyn`,
        method: 'POST',
        form: {
            dyn_req: JSON.stringify({
                attach_req: { img_src: images.length > 0 ? 1 : 0, imgs: images.map((url) => ({ img_src: url })) },
                content: { contents: [{ raw_text: content, type: 1 }] }
            })
        },
        requiresCsrf: true,
        summary: `发动态：${content.slice(0, 20)}${content.length > 20 ? '…' : ''}`
    };
}
/** 判断一条草稿能不能发，给界面用。 */
export function checkDraft(draft) {
    try {
        buildPostRequest(draft);
        return [];
    }
    catch (error) {
        if (error instanceof PostDraftError)
            return [error.message];
        throw error;
    }
}
