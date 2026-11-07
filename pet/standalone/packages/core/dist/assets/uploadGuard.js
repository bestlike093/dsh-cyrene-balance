import { ErrorCode, PetError } from '@pet/shared';
import { detectMime } from './assetManager.js';
const MB = 1024 * 1024;
/** 6.1 的扩展名白名单与单文件上限。 */
export const UPLOAD_RULES = {
    '.png': { declaredMimes: ['image/png'], magicMimes: ['image/png'], maxBytes: 20 * MB, kind: 'image' },
    '.jpg': { declaredMimes: ['image/jpeg'], magicMimes: ['image/jpeg'], maxBytes: 20 * MB, kind: 'image' },
    '.jpeg': { declaredMimes: ['image/jpeg'], magicMimes: ['image/jpeg'], maxBytes: 20 * MB, kind: 'image' },
    '.webp': { declaredMimes: ['image/webp'], magicMimes: ['image/webp'], maxBytes: 20 * MB, kind: 'image' },
    '.gif': { declaredMimes: ['image/gif'], magicMimes: ['image/gif'], maxBytes: 20 * MB, kind: 'gif' },
    '.mp4': { declaredMimes: ['video/mp4'], magicMimes: ['video/mp4'], maxBytes: 100 * MB, kind: 'video' },
    '.webm': { declaredMimes: ['video/webm'], magicMimes: ['video/webm'], maxBytes: 100 * MB, kind: 'video' },
    '.zip': {
        declaredMimes: ['application/zip', 'application/x-zip-compressed'],
        magicMimes: ['application/zip'],
        maxBytes: 200 * MB,
        kind: 'live2d'
    },
    '.json': { declaredMimes: ['application/json'], magicMimes: ['application/json'], maxBytes: 20 * MB, kind: 'json' },
    '.moc': { declaredMimes: ['application/octet-stream'], magicMimes: [], maxBytes: 200 * MB, kind: 'live2d' },
    '.moc3': {
        declaredMimes: ['application/octet-stream'],
        magicMimes: ['application/octet-stream'],
        maxBytes: 200 * MB,
        kind: 'live2d'
    }
};
export function extensionOf(fileName) {
    const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
    const name = fileName.slice(slash + 1);
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}
/**
 * MIME + 扩展名双校验，再用魔数复核。
 *
 * 顺序固定：扩展名 → 大小 → 声明 MIME → 魔数。
 * 声明 MIME 为空时只靠扩展名与魔数，避免浏览器对 `.moc` 等格式返回空串时误伤。
 */
export function inspectUpload(probe) {
    const extension = extensionOf(probe.fileName);
    const rule = UPLOAD_RULES[extension];
    if (rule === undefined) {
        throw new PetError(ErrorCode.MIME_MISMATCH, `不支持的扩展名：${extension || '(无)'}`, {
            details: { extension }
        });
    }
    if (probe.size <= 0) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, '文件内容为空', {
            details: { fileName: probe.fileName }
        });
    }
    if (probe.size > rule.maxBytes) {
        throw new PetError(ErrorCode.QUOTA_EXCEEDED, '文件超过该类型的上限', {
            details: { size: probe.size, maxBytes: rule.maxBytes, extension }
        });
    }
    if (probe.declaredMime !== '' && !rule.declaredMimes.includes(probe.declaredMime)) {
        throw new PetError(ErrorCode.MIME_MISMATCH, '声明类型与扩展名不一致', {
            details: { extension, declaredMime: probe.declaredMime, allowed: rule.declaredMimes }
        });
    }
    if (rule.magicMimes.length > 0) {
        const actualMime = detectMime(probe.head);
        if (actualMime === null || !rule.magicMimes.includes(actualMime)) {
            throw new PetError(ErrorCode.ASSET_INVALID_MAGIC, '文件头与扩展名不符', {
                details: { extension, actualMime, expected: rule.magicMimes }
            });
        }
        return { extension: extension, mime: actualMime, kind: rule.kind, size: probe.size };
    }
    return {
        extension: extension,
        mime: rule.declaredMimes[0] ?? 'application/octet-stream',
        kind: rule.kind,
        size: probe.size
    };
}
