import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { decryptFromSync, encryptForSync, isEncryptedEnvelope } from '../syncCrypto.mjs'

const PASSPHRASE = 'correct horse battery staple'
const PLAIN = '人格提示：她记得你怕黑，也记得你答应过要早点睡。'
const CONTEXT = 'companion.persona.extraPrompt'

/** 手动造一个 v1 旧信封：没有 AAD，用于确认升级后旧包仍能打开。 */
function legacyEnvelope(plain, passphrase) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = pbkdf2Sync(passphrase, salt, 210_000, 32, 'sha256')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return {
    __encSync: 1,
    kdf: 'pbkdf2-sha256',
    iterations: 210_000,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

/** 手动造一个 v2 旧信封：AAD 只绑定元信息，没有字段身份。 */
function previousEnvelope(plain, passphrase) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const saltB64 = salt.toString('base64')
  const ivB64 = iv.toString('base64')
  const key = pbkdf2Sync(passphrase, salt, 210_000, 32, 'sha256')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(
    Buffer.from(
      `cyrene-sync|v2|pbkdf2-sha256|210000|${saltB64}|${ivB64}`,
      'utf8'
    )
  )
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return {
    __encSync: 2,
    kdf: 'pbkdf2-sha256',
    iterations: 210_000,
    salt: saltB64,
    iv: ivB64,
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

describe('syncCrypto', () => {
  it('v3 信封可以往返，并把字段身份写进信封', async () => {
    const envelope = await encryptForSync(PLAIN, PASSPHRASE, CONTEXT)
    expect(envelope.__encSync).toBe(3)
    expect(envelope.ctx).toBe(CONTEXT)
    expect(await decryptFromSync(envelope, PASSPHRASE, CONTEXT)).toBe(PLAIN)
  })

  it('不带字段身份时也能往返', async () => {
    const envelope = await encryptForSync(PLAIN, PASSPHRASE)
    expect(envelope.__encSync).toBe(3)
    expect('ctx' in envelope).toBe(false)
    expect(await decryptFromSync(envelope, PASSPHRASE)).toBe(PLAIN)
  })

  it('仍能打开 v2 旧信封', async () => {
    const envelope = previousEnvelope(PLAIN, PASSPHRASE)
    expect(isEncryptedEnvelope(envelope)).toBe(true)
    expect(await decryptFromSync(envelope, PASSPHRASE, CONTEXT)).toBe(PLAIN)
  })

  it('仍能打开 v1 旧信封', async () => {
    const envelope = legacyEnvelope(PLAIN, PASSPHRASE)
    expect(isEncryptedEnvelope(envelope)).toBe(true)
    expect(await decryptFromSync(envelope, PASSPHRASE)).toBe(PLAIN)
  })

  it('同一口令下把密文挪到别的字段会失败', async () => {
    const envelope = await encryptForSync(PLAIN, PASSPHRASE, CONTEXT)
    await expect(
      decryptFromSync(envelope, PASSPHRASE, 'sync.profile.bio')
    ).rejects.toThrow('同步加密上下文不匹配')
  })

  it('把 v3 降级改标成 v1 会校验失败', async () => {
    const envelope = await encryptForSync(PLAIN, PASSPHRASE, CONTEXT)
    const downgraded = { ...envelope, __encSync: 1 }
    await expect(decryptFromSync(downgraded, PASSPHRASE)).rejects.toThrow()
  })

  it('篡改 v3 的密文会校验失败', async () => {
    const envelope = await encryptForSync(PLAIN, PASSPHRASE, CONTEXT)
    const data = Buffer.from(envelope.data, 'base64')
    data[0] ^= 0xff
    await expect(
      decryptFromSync({ ...envelope, data: data.toString('base64') }, PASSPHRASE, CONTEXT)
    ).rejects.toThrow()
  })

  it('口令不对时打开 v3 会失败', async () => {
    const envelope = await encryptForSync(PLAIN, PASSPHRASE, CONTEXT)
    await expect(decryptFromSync(envelope, '另一个口令', CONTEXT)).rejects.toThrow()
  })

  it('salt / iv / tag 长度不对时直接拒绝', async () => {
    const envelope = await encryptForSync(PLAIN, PASSPHRASE, CONTEXT)
    await expect(
      decryptFromSync(
        { ...envelope, salt: Buffer.alloc(8).toString('base64') },
        PASSPHRASE,
        CONTEXT
      )
    ).rejects.toThrow('salt 长度不合法')
    await expect(
      decryptFromSync(
        { ...envelope, iv: Buffer.alloc(8).toString('base64') },
        PASSPHRASE,
        CONTEXT
      )
    ).rejects.toThrow('iv 长度不合法')
    await expect(
      decryptFromSync(
        { ...envelope, tag: Buffer.alloc(8).toString('base64') },
        PASSPHRASE,
        CONTEXT
      )
    ).rejects.toThrow('tag 长度不合法')
  })

  it('缺字段的信封直接拒绝，不把 undefined 当密文', async () => {
    const envelope = await encryptForSync(PLAIN, PASSPHRASE)
    await expect(
      decryptFromSync({ ...envelope, salt: undefined }, PASSPHRASE)
    ).rejects.toThrow('同步加密信封缺少必要字段')
  })
})
