/**
 * 路径安全。
 *
 * 桌宠要往用户机器上写东西，最先要挡住的是「写到围栏外面」。
 * 这一层只做判定，不碰文件系统——真正的写入由宿主注入。
 *
 * 对应能力：`io.file.write`、`io.download`。
 */
export class PathRejectedError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.name = 'PathRejectedError';
        this.reason = reason;
    }
}
/** Windows 不允许出现在文件名里的字符，外加路径分隔符。 */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/;
/** Windows 保留设备名，带扩展名也不行。 */
const RESERVED_NAMES = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
];
const MAX_SEGMENT = 200;
/**
 * 把用户给的文件名洗成能落盘的样子。
 *
 * 不抛错，尽量救——用户在聊天里说「存成 报告.pdf」，
 * 不该因为带了个冒号就整件事失败。
 */
export function sanitizeFilename(name, fallback = 'untitled') {
    const trimmed = String(name ?? '').trim();
    if (trimmed.length === 0)
        return fallback;
    let base = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    // 去掉结尾的点和空格：Windows 会静默吃掉，不如自己先处理。
    base = base.replace(/[. ]+$/g, '');
    if (base.length === 0)
        return fallback;
    if (base.length > MAX_SEGMENT) {
        const dot = base.lastIndexOf('.');
        const ext = dot > 0 && base.length - dot <= 12 ? base.slice(dot) : '';
        base = base.slice(0, MAX_SEGMENT - ext.length) + ext;
    }
    const stem = base.split('.')[0]?.toUpperCase() ?? '';
    if (RESERVED_NAMES.includes(stem))
        return `_${base}`;
    return base;
}
/**
 * 校验相对路径，确认它落在 `root` 里面。
 *
 * 拒绝绝对路径、盘符、`..`、以及任何含非法字符的片段。
 * 返回规范化后的相对路径（统一用 `/`）。
 */
export function assertRelativePath(relative, root = '') {
    const raw = String(relative ?? '').trim();
    if (raw.length === 0) {
        throw new PathRejectedError('empty', '路径不能为空');
    }
    const normalizedSlash = raw.replace(/\\/g, '/');
    if (normalizedSlash.startsWith('/') || /^[A-Za-z]:/.test(normalizedSlash) || normalizedSlash.startsWith('//')) {
        throw new PathRejectedError('absolute', `不接受绝对路径：${raw}`);
    }
    const segments = normalizedSlash.split('/');
    const cleaned = [];
    for (const segment of segments) {
        if (segment === '' || segment === '.')
            continue;
        if (segment === '..') {
            throw new PathRejectedError('traversal', `路径不能往上跳：${raw}`);
        }
        if (ILLEGAL.test(segment)) {
            throw new PathRejectedError('reserved-character', `文件名含非法字符：${segment}`);
        }
        if (segment.length > MAX_SEGMENT) {
            throw new PathRejectedError('too-long', `路径片段过长：${segment.slice(0, 20)}…`);
        }
        cleaned.push(segment);
    }
    if (cleaned.length === 0) {
        throw new PathRejectedError('empty', '路径解析后为空');
    }
    // root 为空时不比较，调用方自己保证；给了 root 就做一次前缀复核。
    if (root.length > 0) {
        const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/g, '');
        const joined = `${rootNorm}/${cleaned.join('/')}`;
        if (!joined.startsWith(`${rootNorm}/`)) {
            throw new PathRejectedError('escapes-root', '路径越出了允许的目录');
        }
    }
    return cleaned.join('/');
}
/** 从 URL 或 Content-Disposition 里猜一个能用的文件名。 */
export function filenameFromUrl(url, contentType) {
    let pathname = '';
    try {
        pathname = new URL(url).pathname;
    }
    catch {
        pathname = url;
    }
    const last = pathname.split('/').filter(Boolean).pop() ?? '';
    const decoded = safeDecode(last);
    if (decoded.length > 0 && decoded.includes('.')) {
        return sanitizeFilename(decoded, 'download');
    }
    const ext = extensionFor(contentType);
    const stem = decoded.length > 0 ? decoded : 'download';
    return sanitizeFilename(`${stem}${ext}`, 'download');
}
/** Content-Type 到扩展名。只认常见的几个，猜不到就留空。 */
export function extensionFor(contentType) {
    if (typeof contentType !== 'string')
        return '';
    const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    const table = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'application/pdf': '.pdf',
        'application/zip': '.zip',
        'application/json': '.json',
        'text/plain': '.txt',
        'text/html': '.html',
        'audio/mpeg': '.mp3',
        'video/mp4': '.mp4'
    };
    return table[type] ?? '';
}
function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
