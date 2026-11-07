import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
/** 临时目录固定在 assetsRoot 之内，保证 move 不跨分区、路径检查也覆盖它。 */
export const TMP_DIR_NAME = '.tmp';
/** 启动清理的默认阈值：24 小时。 */
export const DEFAULT_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SAFE_EXTENSION = /^\.[a-z0-9]{1,8}$/;
export function tmpRoot(assetsRoot) {
    const root = resolve(assetsRoot);
    const dir = resolve(root, TMP_DIR_NAME);
    // resolve 之后仍要确认没有越出根目录；这里防的是调用方传入奇怪路径。
    if (dir !== root && !dir.startsWith(root + sep)) {
        throw new Error(`临时目录越出 assetsRoot：${dir}`);
    }
    return dir;
}
/** 扩展名只允许白名单形态，其余一律丢弃；文件名本身永远不参与路径构造。 */
function safeExtension(extension) {
    return SAFE_EXTENSION.test(extension) ? extension : '';
}
/**
 * 在 `<assetsRoot>/.tmp/` 下创建一个随机命名的临时文件。
 *
 * 文件名用 randomUUID，不沿用原始文件名——原文件名可能带 `../` 或平台保留字。
 * dispose 幂等，删除失败也不抛（force: true）。
 */
export async function createTempWorkspace(assetsRoot, extension = '') {
    const dir = tmpRoot(assetsRoot);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${randomUUID()}${safeExtension(extension)}`);
    return {
        dir,
        path,
        dispose: async () => {
            await rm(path, { force: true });
        }
    };
}
/**
 * 启动时扫一次 `.tmp/`，清掉超龄残留。
 * 只处理 `.tmp` 下的直接条目，不递归到外部路径。
 */
export async function sweepStaleTmp(assetsRoot, options = {}) {
    const dir = tmpRoot(assetsRoot);
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_TMP_MAX_AGE_MS;
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const removed = [];
    for (const entry of entries) {
        const path = join(dir, entry.name);
        const info = await stat(path);
        if (now - info.mtimeMs > maxAgeMs) {
            try {
                await rm(path, { recursive: true, force: true });
                removed.push(entry.name);
            }
            catch {
                // 文件仍被句柄占用（Windows 上是 EBUSY/EPERM）：留给下一轮，不阻塞启动。
            }
        }
    }
    return removed;
}
