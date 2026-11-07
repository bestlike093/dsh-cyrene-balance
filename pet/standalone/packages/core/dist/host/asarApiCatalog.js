import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
/**
 * dsh 安装包里 api-catalog 的固定位置。
 *
 * asar 目录树里的路径不带前导斜杠；带斜杠是给人读诊断信息用的。
 */
export const API_CATALOG_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js';
/**
 * 从 asar 里取出 api-catalog 的文本。
 *
 * 任何一步失败都返回 `undefined`，由调用方决定「宿主在线但无法确认能力」
 * 还是上抛 `HostProbeError`。这里不抛，是因为「安装包里没有这个文件」
 * 在不同 dsh 版本上是正常现象，不该让整个探测失败。
 */
export async function readApiCatalogText(installDir, readBinaryFile = readFile) {
    const asarPath = join(installDir, 'resources', 'app.asar');
    let buffer;
    try {
        buffer = await readBinaryFile(asarPath);
    }
    catch {
        return undefined;
    }
    const entry = locateEntry(buffer);
    if (entry === undefined)
        return undefined;
    return buffer.subarray(entry.offset, entry.offset + entry.size).toString('utf8');
}
/** 解析 asar 头，定位目标文件的字节区间。 */
export function locateEntry(buffer, entryPath = API_CATALOG_ENTRY) {
    if (buffer.length < 16)
        return undefined;
    const headerSize = buffer.readUInt32LE(12);
    const dataStart = 16 + headerSize;
    if (headerSize === 0 || dataStart > buffer.length)
        return undefined;
    let tree;
    try {
        // 真实 asar 的 header 可能按 4 字节对齐补 NUL，JSON.parse 不吃尾部 NUL。
        const raw = buffer
            .subarray(16, dataStart)
            .toString('utf8')
            .replace(/\u0000+$/, '');
        tree = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    let node = tree;
    for (const part of entryPath.split('/')) {
        node = node?.files?.[part];
        if (node === undefined)
            return undefined;
    }
    if (node.unpacked === true)
        return undefined;
    const offset = Number(node.offset);
    const size = Number(node.size);
    if (!Number.isFinite(offset) || !Number.isFinite(size))
        return undefined;
    return { offset: dataStart + offset, size };
}
/**
 * 从 api-catalog 源码里抽出 `SERVICE_API` 的 key。
 *
 * 只扫 `export const SERVICE_API = [` 到下一个 `];` 之间，
 * 避免误抓事件表或参数名里的同名片段。
 */
export function extractServiceApiKeys(text) {
    const start = text.indexOf('export const SERVICE_API = [');
    if (start === -1)
        return [];
    const end = text.indexOf('\n];', start);
    const block = end === -1 ? text.slice(start) : text.slice(start, end);
    return [...block.matchAll(/^ {8}key: '([^']+)',$/gm)].map((match) => match[1]);
}
/** 读安装包里的 api-catalog key；拿不到时返回 `undefined`。 */
export async function readApiCatalogKeys(installDir, readBinaryFile = readFile) {
    const text = await readApiCatalogText(installDir, readBinaryFile);
    if (text === undefined)
        return undefined;
    const keys = extractServiceApiKeys(text);
    return keys.length === 0 ? undefined : keys;
}
