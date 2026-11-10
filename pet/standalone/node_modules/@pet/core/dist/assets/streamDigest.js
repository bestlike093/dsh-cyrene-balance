import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { ErrorCode, PetError } from '@pet/shared';
/**
 * 一次 open 完成「读头部 + 流式 SHA-256」。
 *
 * 循环里读到超限立刻停，错误详情带上实际读取量，方便断言拦截发生在中途。
 * digest() 只在正常读完后调用；任何异常路径都不会产生摘要。
 */
export async function digestFile(path, options) {
    const headBytes = options.headBytes ?? 512;
    const chunkSize = options.chunkSize ?? 64 * 1024;
    const handle = await open(path, 'r');
    const hash = createHash('sha256');
    const head = new Uint8Array(headBytes);
    let headFilled = 0;
    let readBytes = 0;
    try {
        const stream = handle.createReadStream({ autoClose: false });
        for await (const chunk of stream) {
            readBytes += chunk.length;
            if (readBytes > options.maxBytes) {
                stream.destroy();
                throw new PetError(ErrorCode.QUOTA_EXCEEDED, '文件超过该类型的上限', {
                    details: { path, readBytes, maxBytes: options.maxBytes }
                });
            }
            if (headFilled < headBytes) {
                const take = Math.min(chunk.length, headBytes - headFilled);
                head.set(chunk.subarray(0, take), headFilled);
                headFilled += take;
            }
            hash.update(chunk);
        }
    }
    finally {
        await handle.close();
    }
    return {
        sha256: hash.digest('hex'),
        head: headFilled === headBytes ? head : head.slice(0, headFilled),
        size: readBytes
    };
}
