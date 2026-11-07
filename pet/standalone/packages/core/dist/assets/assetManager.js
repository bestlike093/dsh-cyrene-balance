import { ErrorCode, PetError } from '@pet/shared';
import { assertInsideRoot, normalizeRoot } from './pathGuard.js';
export const DEFAULT_ASSET_EXTENSIONS = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.json': 'application/json',
    '.moc3': 'application/octet-stream'
};
export const DEFAULT_ASSET_POLICY = {
    maxBytes: 64 * 1024 * 1024,
    extensions: DEFAULT_ASSET_EXTENSIONS
};
const MIME_TO_KIND = {
    'image/png': 'image',
    'image/jpeg': 'image',
    'image/webp': 'image',
    'image/gif': 'gif',
    'video/mp4': 'video',
    'application/json': 'json',
    'application/octet-stream': 'live2d'
};
function ascii(bytes, start, length) {
    let out = '';
    for (let i = start; i < start + length; i++) {
        const byte = bytes[i];
        if (byte === undefined)
            return '';
        out += String.fromCharCode(byte);
    }
    return out;
}
function startsWith(bytes, prefix) {
    if (bytes.length < prefix.length)
        return false;
    for (let i = 0; i < prefix.length; i++) {
        if (bytes[i] !== prefix[i])
            return false;
    }
    return true;
}
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const WEBM_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];
/** 按魔数判真实类型。返回 null 表示不认识，调用方必须拒绝。 */
export function detectMime(bytes) {
    if (bytes.length === 0)
        return null;
    if (startsWith(bytes, PNG_SIGNATURE))
        return 'image/png';
    if (startsWith(bytes, JPEG_SIGNATURE))
        return 'image/jpeg';
    const head6 = ascii(bytes, 0, 6);
    if (head6 === 'GIF87a' || head6 === 'GIF89a')
        return 'image/gif';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP')
        return 'image/webp';
    if (ascii(bytes, 4, 4) === 'ftyp')
        return 'video/mp4';
    if (startsWith(bytes, ZIP_SIGNATURE))
        return 'application/zip';
    if (startsWith(bytes, WEBM_SIGNATURE))
        return 'video/webm';
    if (ascii(bytes, 0, 4) === 'MOC3')
        return 'application/octet-stream';
    // JSON：跳过 BOM 与空白后必须直接进入对象或数组，避免把任意文本当配置。
    let index = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    while (index < bytes.length) {
        const byte = bytes[index];
        if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)
            break;
        index += 1;
    }
    const first = bytes[index];
    if (first === 0x7b || first === 0x5b)
        return 'application/json';
    return null;
}
function extensionOf(relPath) {
    const slash = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'));
    const name = relPath.slice(slash + 1);
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}
/**
 * 资产边界检查器。
 * 只做「路径是否在根内 + 扩展名/魔数/大小是否合法」，不做网络与 DOM 访问。
 */
export class AssetManager {
    root;
    policy;
    constructor(root, policy = {}) {
        this.root = normalizeRoot(root);
        this.policy = {
            maxBytes: policy.maxBytes ?? DEFAULT_ASSET_POLICY.maxBytes,
            extensions: policy.extensions ?? DEFAULT_ASSET_POLICY.extensions
        };
    }
    /** 规范化相对路径；任何越出根目录的写法都直接拒绝。 */
    resolve(relPath) {
        if (typeof relPath !== 'string' || relPath.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '资产路径为空');
        }
        if (relPath.includes('\0')) {
            throw new PetError(ErrorCode.PATH_TRAVERSAL, '资产路径包含空字节');
        }
        const unified = relPath.replace(/\\/g, '/');
        if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified)) {
            throw new PetError(ErrorCode.PATH_TRAVERSAL, '资产路径必须是相对路径');
        }
        const segments = [];
        for (const segment of unified.split('/')) {
            if (segment === '' || segment === '.')
                continue;
            if (segment === '..') {
                if (segments.length === 0) {
                    throw new PetError(ErrorCode.PATH_TRAVERSAL, '资产路径越出根目录');
                }
                segments.pop();
                continue;
            }
            segments.push(segment);
        }
        if (segments.length === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '资产路径没有指向文件');
        }
        return assertInsideRoot(this.root, `${this.root}/${segments.join('/')}`);
    }
    /** 校验字节内容。顺序：扩展名 → 大小 → 魔数，保证错误码稳定可判等。 */
    verify(relPath, bytes) {
        const absolutePath = this.resolve(relPath);
        const extension = extensionOf(relPath);
        const expectedMime = this.policy.extensions[extension];
        if (expectedMime === undefined) {
            throw new PetError(ErrorCode.MIME_MISMATCH, `不支持的扩展名：${extension || '(无)'}`);
        }
        if (bytes.byteLength === 0) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '资产内容为空');
        }
        if (bytes.byteLength > this.policy.maxBytes) {
            throw new PetError(ErrorCode.QUOTA_EXCEEDED, '资产超过大小上限', {
                details: { size: bytes.byteLength, maxBytes: this.policy.maxBytes }
            });
        }
        const actualMime = detectMime(bytes);
        if (actualMime === null || actualMime !== expectedMime) {
            throw new PetError(ErrorCode.ASSET_INVALID_MAGIC, '文件内容与扩展名不匹配', {
                details: { extension, expectedMime, actualMime }
            });
        }
        const kind = MIME_TO_KIND[actualMime];
        if (kind === undefined) {
            throw new PetError(ErrorCode.MODEL_NOT_RENDERABLE, `无法映射资产类型：${actualMime}`);
        }
        return {
            relPath,
            absolutePath,
            mime: actualMime,
            kind,
            size: bytes.byteLength
        };
    }
}
