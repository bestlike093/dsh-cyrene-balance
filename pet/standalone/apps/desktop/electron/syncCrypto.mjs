/**
 * 同步包的字段级加密。
 *
 * 同步目录可能是共享盘，写出去的内容会离开本机。仅靠「不同步」不能解决
 * 换机后人格提示全丢的问题，所以给需要跨机保留的敏感字段单独加一层：
 * 用用户在两台机器上分别输入的同步口令派生密钥，同步包里只留密文。
 *
 * 口令不进 settings.json，只存加密仓库；换机后重新输入即可解开旧包。
 * 口令丢了旧包就真的解不开了，这一点由调用方明确告知，不做静默降级。
 */

import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2Async = promisify(pbkdf2)

export const SYNC_SECRET_SERVICE = 'sync'
export const SYNC_SECRET_FIELD = 'passphrase'

const KDF = 'pbkdf2-sha256'
const ITERATIONS = 210_000
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
/** 迭代次数来自信封，设个上限，避免坏包把解密拖成几分钟。 */
const MAX_ITERATIONS = 2_000_000
const CONTEXT_MAX_CHARS = 200
// v2 把信封元信息绑进 AAD；v3 再把字段身份（context）绑进去。
const ENVELOPE_VERSION = 3
const PREVIOUS_ENVELOPE_VERSION = 2
const LEGACY_ENVELOPE_VERSION = 1
const AAD_PREFIX = 'cyrene-sync'

/** 信封形状固定，认出不是自家格式就直接拒绝，避免把别的对象当密文解。 */
export function isEncryptedEnvelope(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value.__encSync === ENVELOPE_VERSION ||
      value.__encSync === PREVIOUS_ENVELOPE_VERSION ||
      value.__encSync === LEGACY_ENVELOPE_VERSION) &&
    typeof value.data === 'string'
  )
}

function envelopeAad(version, kdf, iterations, salt, iv, context) {
  const base = `${AAD_PREFIX}|v${String(version)}|${String(kdf)}|${String(iterations)}|${String(salt)}|${String(iv)}`
  // v2 只绑定元信息；v3 起把字段身份接上，密文被搬到别的字段就解不开。
  return Buffer.from(
    version >= 3 ? `${base}|ctx:${String(context ?? '')}` : base,
    'utf8'
  )
}

/** 字段身份只做短标签，不把路径长度带进 AAD。 */
function normalizeContext(context) {
  if (context === undefined || context === null) return ''
  if (typeof context !== 'string') throw new Error('同步加密上下文必须是字符串')
  const value = context.trim()
  if (value.length > CONTEXT_MAX_CHARS) throw new Error('同步加密上下文过长')
  return value
}

/** salt / iv / tag 必须是最小合法长度，截断或塞错字段都在这里挡住。 */
function decodeFixedBase64(value, bytes, label) {
  const buffer = Buffer.from(value, 'base64')
  if (buffer.length !== bytes) throw new Error(`同步加密信封的 ${label} 长度不合法`)
  if (buffer.toString('base64') !== value) {
    throw new Error(`同步加密信封的 ${label} 不是规范 base64`)
  }
  return buffer
}

async function deriveKey(passphrase, salt, iterations) {
  return await pbkdf2Async(passphrase, salt, iterations, KEY_BYTES, 'sha256')
}

export async function encryptForSync(plain, passphrase, context) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('同步加密只接受非空字符串')
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('同步口令为空，拒绝加密')
  }

  const ctx = normalizeContext(context)
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const saltB64 = salt.toString('base64')
  const ivB64 = iv.toString('base64')
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(envelopeAad(ENVELOPE_VERSION, KDF, ITERATIONS, saltB64, ivB64, ctx))
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])

  return {
    __encSync: ENVELOPE_VERSION,
    kdf: KDF,
    iterations: ITERATIONS,
    salt: saltB64,
    iv: ivB64,
    tag: cipher.getAuthTag().toString('base64'),
    ...(ctx === '' ? {} : { ctx }),
    data: data.toString('base64')
  }
}

export async function decryptFromSync(envelope, passphrase, context) {
  if (!isEncryptedEnvelope(envelope)) throw new Error('不是同步加密信封')
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('同步口令为空，无法解密')
  }
  if (envelope.kdf !== KDF) throw new Error(`不支持的 KDF：${String(envelope.kdf)}`)

  const salt = envelope.salt
  const iv = envelope.iv
  const tag = envelope.tag
  if (typeof salt !== 'string' || typeof iv !== 'string' || typeof tag !== 'string') {
    throw new Error('同步加密信封缺少必要字段')
  }

  const iterations = Number(envelope.iterations)
  if (!Number.isInteger(iterations) || iterations < 100_000) {
    throw new Error('迭代次数过低，拒绝解密')
  }
  if (iterations > MAX_ITERATIONS) throw new Error('迭代次数过高，拒绝解密')

  const version = envelope.__encSync
  // v1 没有 AAD；v2 绑定元信息；v3 再绑定字段身份。
  let effectiveContext = ''
  if (version >= ENVELOPE_VERSION) {
    const declared = normalizeContext(envelope.ctx)
    if (context !== undefined && normalizeContext(context) !== declared) {
      throw new Error('同步加密上下文不匹配')
    }
    effectiveContext = declared
  }

  const saltBytes = decodeFixedBase64(salt, SALT_BYTES, 'salt')
  const ivBytes = decodeFixedBase64(iv, IV_BYTES, 'iv')
  const tagBytes = decodeFixedBase64(tag, TAG_BYTES, 'tag')

  const key = await deriveKey(passphrase, saltBytes, iterations)
  const decipher = createDecipheriv('aes-256-gcm', key, ivBytes)
  if (version >= PREVIOUS_ENVELOPE_VERSION) {
    decipher.setAAD(
      envelopeAad(version, envelope.kdf, iterations, salt, iv, effectiveContext)
    )
  }
  decipher.setAuthTag(tagBytes)

  // GCM 校验失败会在这里抛错：口令错、包被改过、字段被截断，都走同一条路径。
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final()
  ]).toString('utf8')
}
