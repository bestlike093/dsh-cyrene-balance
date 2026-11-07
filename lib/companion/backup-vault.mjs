/**
 * 整库备份的封装与校验。
 *
 * 这一层只处理「备份长什么样」：
 *   - 明文备份是一份可读 JSON，方便用户自己检查与迁移；
 *   - 加密备份用用户自定口令派生密钥，换机器也能恢复；
 *   - 恢复前统一做格式与版本校验，坏文件不往下传。
 *
 * 不读写文件、不碰 Electron，随机源和时钟都由调用方注入。
 */

import { webcrypto as nodeWebcrypto } from 'node:crypto'

export const BACKUP_FORMAT = 'cyrene-pet-backup'
export const ENVELOPE_FORMAT = 'cyrene-pet-backup-envelope'
export const BACKUP_VERSION = 1
export const MIN_PASSPHRASE_LENGTH = 8
export const DEFAULT_KDF_ITERATIONS = 210_000

const cryptoApi = globalThis.crypto?.subtle ? globalThis.crypto : nodeWebcrypto
const KDF_HASH = 'SHA-256'
const CIPHER_NAME = 'AES-256-GCM'
const SALT_BYTES = 16
const IV_BYTES = 12

function fail(message) {
  throw new Error(message)
}

function encoder() {
  return new TextEncoder()
}

function decoder() {
  return new TextDecoder()
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(text) {
  if (typeof text !== 'string' || text.trim() === '') fail('备份缺少必要的加密字段')
  return new Uint8Array(Buffer.from(text, 'base64'))
}

function randomBytes(length) {
  const source = cryptoApi
  if (!source || typeof source.getRandomValues !== 'function') {
    fail('当前运行环境没有安全随机源，无法生成备份口令盐')
  }
  const bytes = new Uint8Array(length)
  source.getRandomValues(bytes)
  return bytes
}

function stableStringify(value) {
  return JSON.stringify(value)
}

function assertBundleShape(bundle) {
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) {
    fail('备份内容不是可识别的对象')
  }
  if (bundle.format !== BACKUP_FORMAT) fail('这不是昔涟的整库备份')
  const version = Number(bundle.version)
  if (!Number.isFinite(version) || version < 1) fail('备份版本不可识别')
  if (version > BACKUP_VERSION) fail(`备份版本 ${version} 比当前版本新，请先更新昔涟`)
  if (bundle.data === null || typeof bundle.data !== 'object' || Array.isArray(bundle.data)) {
    fail('备份里没有可用的整库数据')
  }
  return bundle
}

/** 组装一份明文备份。调用方负责把已经清洗过的数据放进来。 */
export function createBackupBundle(data, { now = Date.now, app = null } = {}) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    fail('整库数据不是可识别的对象')
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now(),
    app: app !== null && typeof app === 'object' ? { ...app } : null,
    data: { ...data },
  }
}

/** 原样返回一份明文备份，只做格式校验，方便直接下载。 */
export function createPlainBackup(bundle) {
  return JSON.parse(stableStringify(assertBundleShape(bundle)))
}

/** 解析明文备份；也接受旧版只含 memory 的单文件备份。 */
export function parsePlainBackup(raw) {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      fail('备份不是合法 JSON')
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('备份内容不是可识别的对象')
  }
  if (parsed.format === BACKUP_FORMAT) return assertBundleShape(parsed)
  if (parsed.memory !== undefined || Array.isArray(parsed.items)) {
    return createBackupBundle({ memory: parsed.memory ?? parsed })
  }
  fail('这是旧版或无法识别的备份')
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await cryptoApi.subtle.importKey(
    'raw',
    encoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: KDF_HASH,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.trim().length < MIN_PASSPHRASE_LENGTH) {
    fail(`备份口令至少需要 ${MIN_PASSPHRASE_LENGTH} 个字符`)
  }
}

/**
 * 用用户口令加密整库备份。
 * 返回一个自描述的 JSON 信封，口令和密钥都不会写进结果。
 */
export async function encryptBackup(bundle, passphrase, { iterations = DEFAULT_KDF_ITERATIONS } = {}) {
  assertPassphrase(passphrase)
  const source = assertBundleShape(bundle)
  if (!cryptoApi?.subtle) fail('当前运行环境不支持加密备份')

  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(passphrase, salt, iterations)
  const plaintext = encoder().encode(stableStringify(source))
  const sealed = new Uint8Array(
    await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  )

  return {
    format: ENVELOPE_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: source.exportedAt,
    cipher: CIPHER_NAME,
    kdf: {
      name: 'PBKDF2',
      hash: KDF_HASH,
      iterations,
      salt: toBase64(salt),
    },
    iv: toBase64(iv),
    payload: toBase64(sealed),
  }
}

/** 解开加密信封并校验内部备份结构。口令错误会得到明确提示。 */
export async function decryptBackup(envelope, passphrase) {
  assertPassphrase(passphrase)
  const source = typeof envelope === 'string' ? JSON.parse(envelope) : envelope
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    fail('加密备份不是可识别的对象')
  }
  if (source.format !== ENVELOPE_FORMAT) fail('这不是昔涟的加密备份')
  if (Number(source.version) > BACKUP_VERSION) fail('加密备份版本比当前版本新，请先更新昔涟')
  if (source.cipher !== CIPHER_NAME) fail('备份使用了当前版本不支持的加密方式')
  if (source.kdf?.name !== 'PBKDF2' || source.kdf?.hash !== KDF_HASH) {
    fail('备份使用了当前版本不支持的口令派生方式')
  }
  const iterations = Number(source.kdf?.iterations)
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 2_000_000) {
    fail('备份的口令派生参数不在安全范围内')
  }
  if (!cryptoApi?.subtle) fail('当前运行环境不支持加密备份')

  const salt = fromBase64(source.kdf.salt)
  const iv = fromBase64(source.iv)
  const payload = fromBase64(source.payload)
  const key = await deriveKey(passphrase, salt, iterations)

  let opened
  try {
    opened = await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload)
  } catch {
    fail('备份口令不对，或文件已经损坏')
  }

  let parsed
  try {
    parsed = JSON.parse(decoder().decode(opened))
  } catch {
    fail('备份解开后不是合法 JSON')
  }
  return assertBundleShape(parsed)
}

/** 判断一份文件是明文备份还是加密信封，给设置页提示用。 */
export function inspectBackup(raw) {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { kind: 'unknown', reason: '不是合法 JSON' }
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'unknown', reason: '不是可识别的对象' }
  }
  if (parsed.format === ENVELOPE_FORMAT) {
    return {
      kind: 'encrypted',
      version: Number(parsed.version) || 0,
      exportedAt: Number(parsed.exportedAt) || 0,
    }
  }
  if (parsed.format === BACKUP_FORMAT) {
    return {
      kind: 'plain',
      version: Number(parsed.version) || 0,
      exportedAt: Number(parsed.exportedAt) || 0,
    }
  }
  return { kind: 'unknown', reason: '不认识的备份格式' }
}
