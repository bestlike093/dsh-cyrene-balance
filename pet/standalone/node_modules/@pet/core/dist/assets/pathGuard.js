import { lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { ErrorCode, PetError } from '@pet/shared';
/** 归一 assetsRoot：先 resolve，再去掉尾部隔符，避免拼出 `...//`。 */
export function normalizeRoot(assetsRoot) {
    const resolved = resolve(assetsRoot);
    return resolved.length > 1 && resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved;
}
/**
 * 同族目录绕过检查：`assets-evil` 不是 `assets` 的子路径。
 * 必须比较 `resolved === root || resolved.startsWith(root + sep)`。
 */
export function isInsideRoot(assetsRoot, target) {
    const root = normalizeRoot(assetsRoot);
    const resolved = resolve(target);
    return resolved === root || resolved.startsWith(root + sep);
}
export function assertInsideRoot(assetsRoot, target) {
    const resolved = resolve(target);
    if (!isInsideRoot(assetsRoot, resolved)) {
        throw new PetError(ErrorCode.PATH_TRAVERSAL, '路径越出资源根目录', {
            details: { root: normalizeRoot(assetsRoot), target: resolved }
        });
    }
    return resolved;
}
/** `path.resolve` 只做字符串归一，符号链接要单独用 lstat 复查。 */
export async function assertNotSymlink(path) {
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
            throw new PetError(ErrorCode.PATH_TRAVERSAL, '路径是符号链接', { details: { path } });
        }
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return;
        throw error;
    }
}
/** `.tmp` 下的半写入文件不能被 Scaler 或索引当成正式资源。 */
export function isTempPath(assetsRoot, target) {
    const tmp = resolve(normalizeRoot(assetsRoot), '.tmp');
    const resolved = resolve(target);
    return resolved === tmp || resolved.startsWith(tmp + sep);
}
