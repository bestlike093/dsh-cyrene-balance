/**
 * 往围栏内写文件。
 *
 * 三件事必须做到：
 *
 * 1. 路径先过 `assertRelativePath`，写到围栏外面直接拒绝
 * 2. 大小先看，超限不写，别等写了一半才发现
 * 3. 原子落盘：先写临时文件再改名，中途失败不留半截文件
 *
 * 文件系统由宿主注入，core 不 import `node:fs`。
 * 对应能力：`io.file.write`、`io.download`。
 */
import { PathRejectedError, assertRelativePath } from './pathSafety.js';
export class FileTooLargeError extends Error {
    bytes;
    limit;
    constructor(bytes, limit) {
        super(`文件太大：${bytes} 字节，上限 ${limit}`);
        this.name = 'FileTooLargeError';
        this.bytes = bytes;
        this.limit = limit;
    }
}
export class FileExistsError extends Error {
    path;
    constructor(path) {
        super(`目标已存在：${path}`);
        this.name = 'FileExistsError';
        this.path = path;
    }
}
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
/**
 * 把数据写进 `root` 围栏内。
 *
 * 返回围栏内相对路径，不返回绝对路径——绝对路径里带用户名，
 * 容易在日志或界面里漏出去。
 */
export async function writeFenced(port, root, relativePath, data, options = {}) {
    const safe = assertRelativePath(relativePath, root);
    const limit = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (data.byteLength > limit) {
        throw new FileTooLargeError(data.byteLength, limit);
    }
    const mode = options.onExists ?? 'error';
    let target = safe;
    let renamed = false;
    if (mode !== 'overwrite' && port.exists !== undefined) {
        const existsOnDisk = port.exists.bind(port);
        const exists = await existsOnDisk(join(root, safe));
        if (exists) {
            if (mode === 'error')
                throw new FileExistsError(safe);
            target = await nextAvailable(safe, options.renameSuffix ?? defaultSuffix, (candidate) => existsOnDisk(join(root, candidate)));
            renamed = true;
        }
    }
    const absolute = join(root, target);
    const temp = `${absolute}.tmp-${Date.now().toString(36)}`;
    await port.write(temp, data);
    if (port.move !== undefined) {
        await port.move(temp, absolute);
    }
    else {
        if (port.remove !== undefined)
            await port.remove(absolute).catch(() => undefined);
        await port.write(absolute, data);
        if (port.remove !== undefined)
            await port.remove(temp).catch(() => undefined);
    }
    return { relativePath: target, bytes: data.byteLength, renamed };
}
/** 把相对路径拼到根上，统一用 `/`；不处理盘符，那是调用方的事。 */
export function join(root, relative) {
    const base = root.replace(/\\/g, '/').replace(/\/+$/g, '');
    return `${base}/${relative}`;
}
function defaultSuffix(index) {
    return `-${index}`;
}
/**
 * 依次试 `name-1.ext`、`name-2.ext`，最多试 999 次。
 *
 * 试不出来就抛错，不返回一个可能覆盖别人的名字。
 */
async function nextAvailable(relative, suffix, exists) {
    const dot = relative.lastIndexOf('/');
    const dir = dot >= 0 ? relative.slice(0, dot + 1) : '';
    const name = dot >= 0 ? relative.slice(dot + 1) : relative;
    const extDot = name.lastIndexOf('.');
    const stem = extDot > 0 ? name.slice(0, extDot) : name;
    const ext = extDot > 0 ? name.slice(extDot) : '';
    for (let i = 1; i <= 999; i += 1) {
        const candidate = `${dir}${stem}${suffix(i)}${ext}`;
        if (!(await exists(candidate)))
            return candidate;
    }
    throw new PathRejectedError('too-long', '找不到可用的文件名');
}
