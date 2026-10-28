function randomBytes(length) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
}
export function toBase64Url(bytes) {
    let bin = '';
    for (const byte of bytes)
        bin += String.fromCharCode(byte);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/**
 * 进程内临时密钥环：S1 第一刀用，密钥随实例销毁。
 * 落盘密钥后端在 S1 第 6 步接，届时只换这个实现，VaultClient 不动。
 */
export function createEphemeralKeyRing(suite = 'CS1') {
    const keys = new Map();
    let current = { keyId: 1, epoch: 0, key: randomBytes(32) };
    keys.set(current.keyId, current);
    let signerPair = null;
    const ensureSigner = async () => {
        if (signerPair === null) {
            signerPair = (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
                'sign',
                'verify'
            ]));
        }
        return signerPair;
    };
    return {
        suite,
        current: () => current,
        byId: (keyId) => keys.get(keyId),
        signer: ensureSigner,
        async senderPub() {
            const pair = await ensureSigner();
            const raw = await globalThis.crypto.subtle.exportKey('raw', pair.publicKey);
            return toBase64Url(new Uint8Array(raw));
        },
        async rotate() {
            const next = {
                keyId: current.keyId + 1,
                epoch: current.epoch + 1,
                key: randomBytes(32)
            };
            keys.set(next.keyId, next);
            current = next;
        },
        destroy() {
            for (const entry of keys.values())
                entry.key.fill(0);
            keys.clear();
        }
    };
}
//# sourceMappingURL=keyRing.js.map