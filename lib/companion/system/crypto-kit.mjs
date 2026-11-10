/**
 * 加密原语工具箱：三处加密实现收敛到同一套底层原语。
 *
 * 三个消费方各自保留信封格式与校验口径，这里只提供不会变的字节级原语：
 *   - syncCrypto（同步包字段级加密，node:crypto 流式）
 *   - backup-vault（整库备份信封，WebCrypto 异步）
 *   - sealed-store（陪伴数据密封层，node:crypto 流式，同步读写）
 *
 * 全部函数都是纯字节操作，不碰文件、不碰 Electron、不带业务语义。
 * 任何一处的输出格式与密文字节都不能因为改引这里而发生变化。
 */

import { webcrypto as nodeWebcrypto } from 'node:crypto'
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  pbkdf2,
  randomBytes,
} from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2Async = promisify(pbkdf2)

/** 浏览器环境用 globalThis.crypto，Node 环境退回 node:crypto 的 webcrypto。 */
export function cryptoApi() {
  return globalThis.crypto?.subtle ? globalThis.crypto : nodeWebcrypto
}

/** 安全随机字节（同步，node:crypto）。 */
export function randomBytesSync(length) {
  return randomBytes(length)
}

export function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

export function fromBase64(text) {
  return Buffer.from(text, 'base64')
}

/** 按期望长度做规范 base64 校验；不合法返回 null，报错文案留给调用方。 */
export function canonicalBase64Bytes(value, expectedBytes) {
  if (typeof value !== 'string') return null
  const buffer = Buffer.from(value, 'base64')
  if (buffer.length !== expectedBytes) return null
  if (buffer.toString('base64') !== value) return null
  return buffer
}

export function utf8Encode(text) {
  return Buffer.from(String(text), 'utf8')
}

export function utf8Decode(bytes) {
  return Buffer.from(bytes).toString('utf8')
}

/** PBKDF2-SHA256 派生原始密钥字节（默认 32 字节，对应 AES-256）。 */
export async function derivePbkdf2(passphrase, salt, iterations, keyBytes = 32) {
  return await pbkdf2Async(passphrase, salt, iterations, keyBytes, 'sha256')
}

/**
 * WebCrypto 版口令派生：PBKDF2-SHA256 → AES-256-GCM 密钥对象。
 * backup-vault 的旧包必须继续用这条路径，换实现会解不开已有信封。
 */
export async function deriveAesGcmKeyWeb(passphrase, salt, iterations) {
  const api = cryptoApi()
  const material = await api.subtle.importKey(
    'raw',
    utf8Encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return api.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * HMAC-SHA256 子密钥：sealed-store 每个文件一把子密钥。
 * keyMaterial 传字符串时按 UTF-8 字节当 HMAC 密钥，与旧实现一致。
 */
export function hmacSubKey(keyMaterial, label) {
  return createHmac('sha256', keyMaterial).update(label).digest()
}

/**
 * AES-256-GCM 流式加密（node:crypto，同步）。
 * 返回 { data, tag }；AAD 传 Buffer，没有就传空。
 */
export function sealGcmSync(key, iv, plaintext, aad = Buffer.alloc(0)) {
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  if (aad.length > 0) cipher.setAAD(aad)
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { data, tag: cipher.getAuthTag() }
}

/** AES-256-GCM 流式解密（node:crypto，同步）。校验失败直接抛错。 */
export function openGcmSync(key, iv, data, tag, aad = Buffer.alloc(0)) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  if (aad.length > 0) decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

/** AES-256-GCM 异步加密（WebCrypto，backup-vault 用）。 */
export async function sealGcmWeb(key, iv, plaintext, aad = null) {
  const api = cryptoApi()
  return new Uint8Array(
    await api.subtle.encrypt({ name: 'AES-GCM', iv, ...(aad ? { additionalData: aad } : {}) }, key, plaintext),
  )
}

/** AES-256-GCM 异步解密（WebCrypto）。校验失败抛错，由调用方转成用户可读提示。 */
export async function openGcmWeb(key, iv, payload, aad = null) {
  const api = cryptoApi()
  return new Uint8Array(
    await api.subtle.decrypt({ name: 'AES-GCM', iv, ...(aad ? { additionalData: aad } : {}) }, key, payload),
  )
}
