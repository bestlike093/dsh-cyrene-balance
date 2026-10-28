/**
 * v2.1 密码与跨端契约（文档第 8–10 章、附录 A.9/A.10）。
 * 只定义结构，不实现算法；实现分别落在 packages/vault 与后续 interop 模块。
 */
export const SUITES = {
    CS1: {
        id: 'CS1',
        kem: 'X25519',
        aead: 'AES-256-GCM',
        mac: 'HMAC-SHA256',
        kdf: 'HKDF-SHA256',
        sign: 'Ed25519',
        hash: 'SHA-256'
    },
    CS2: {
        id: 'CS2',
        kem: 'X25519',
        aead: 'XChaCha20-Poly1305',
        mac: 'BLAKE3-keyed',
        kdf: 'HKDF-SHA256',
        sign: 'Ed25519',
        hash: 'BLAKE3'
    },
    CS3: {
        id: 'CS3',
        kem: 'MLKEM768-X25519',
        aead: 'AES-256-GCM',
        mac: 'HMAC-SHA256',
        kdf: 'HKDF-SHA256',
        sign: 'Ed25519',
        hash: 'SHA-256'
    }
};
/** 协商优先级：高在前。无交集时必须报错，禁止降级明文。 */
export const CRYPTO_SUITE_ORDER = ['CS3', 'CS2', 'CS1'];
export const CONSISTENCY_LEVELS = ['consistent', 'converging', 'divergent'];
/**
 * 能力协商：取交集里优先级最高者；无交集返回 null，由调用方报错。
 * 放在契约层，避免两端各写一套顺序。
 */
export function negotiateSuite(local, remote) {
    for (const suite of CRYPTO_SUITE_ORDER) {
        if (local.includes(suite) && remote.includes(suite))
            return suite;
    }
    return null;
}
//# sourceMappingURL=crypto.js.map