import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHmac, pbkdf2 } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createBackupBundle,
  decryptBackup,
  encryptBackup,
  inspectBackup,
} from '../lib/companion/system/backup-vault.mjs'
import {
  decryptFromSync,
  encryptForSync,
  isEncryptedEnvelope,
} from '../lib/companion/system/syncCrypto.mjs'
import {
  createSealedStore,
  isSealed,
  sealText,
  unsealText,
} from '../lib/companion/state/sealed-store.mjs'

const pbkdf2Async = promisify(pbkdf2)

/* ---------- sealed-store：密封信封形状与子密钥 ---------- */

test('sealed-store：密封信封字段形状，回读一致', () => {
  const raw = sealText('bond.json', '{"a":1}', 'test-password')
  const envelope = JSON.parse(raw)
  assert.equal(envelope.format, 'cyrene-sealed-v1')
  assert.equal(envelope.name, 'bond.json')
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12)
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16)
  assert.equal(Buffer.from(envelope.data, 'base64').toString('utf8').length > 0, true)
  assert.equal(isSealed(raw), true)
  assert.equal(unsealText('bond.json', raw, 'test-password'), '{"a":1}')
})

test('sealed-store：子密钥是 HMAC-SHA256(password, sealed:name)，标准实现能解开', () => {
  const raw = sealText('bond.json', 'hello', 'pw-1')
  const envelope = JSON.parse(raw)
  const key = createHmac('sha256', 'pw-1').update('sealed:bond.json').digest()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from('cyrene-companion:bond.json', 'utf8'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
  assert.equal(plain.toString('utf8'), 'hello')
})

test('sealed-store：改名或换口令都解不开', () => {
  const raw = sealText('bond.json', 'hello', 'pw-1')
  assert.throws(() => unsealText('other.json', raw, 'pw-1'), /名字对不上/)
  assert.throws(() => unsealText('bond.json', raw, 'wrong-pw'))
})

test('sealed-store：明文自动迁移成密文，回读校验', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealed-test-'))
  try {
    writeFileSync(join(dir, 'body.json'), '{"plain":true}', 'utf8')
    const store = createSealedStore({ dir, password: 'test-pass' })
    const value = store.readJson('body.json')
    assert.deepEqual(value, { plain: true })
    const onDisk = JSON.parse(readFileSync(join(dir, 'body.json'), 'utf8'))
    assert.equal(onDisk.format, 'cyrene-sealed-v1')
    assert.equal(store.readJson('body.json').plain, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------- syncCrypto：信封版本协商 v1/v2/v3 ---------- */

function aadOf(version, kdf, iterations, salt, iv, ctx) {
  const base = `cyrene-sync|v${version}|${kdf}|${iterations}|${salt}|${iv}`
  return Buffer.from(version >= 3 ? `${base}|ctx:${ctx ?? ''}` : base, 'utf8')
}

async function makeLegacyEnvelope(version, context) {
  const salt = Buffer.alloc(16, 7)
  const iv = Buffer.alloc(12, 3)
  const iterations = 100_000
  const key = await pbkdf2Async('pass-123', salt, iterations, 32, 'sha256')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  if (version >= 2) {
    cipher.setAAD(aadOf(version, 'pbkdf2-sha256', iterations, salt.toString('base64'), iv.toString('base64'), context))
  }
  const data = Buffer.concat([cipher.update('旧包内容', 'utf8'), cipher.final()])
  return {
    __encSync: version,
    kdf: 'pbkdf2-sha256',
    iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ...(version >= 3 ? { ctx: context } : {}),
    data: data.toString('base64'),
  }
}

test('syncCrypto：新信封形状完整，回读一致', async () => {
  const envelope = await encryptForSync('秘密字段', 'pass-123', 'persona.prompt')
  assert.equal(envelope.__encSync, 3)
  assert.equal(Buffer.from(envelope.salt, 'base64').length, 16)
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12)
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16)
  assert.equal(envelope.ctx, 'persona.prompt')
  assert.equal(await decryptFromSync(envelope, 'pass-123', 'persona.prompt'), '秘密字段')
})

test('syncCrypto：v1（无 AAD）、v2（元信息 AAD）、v3（带 ctx）都能解开', async () => {
  const v1 = await makeLegacyEnvelope(1)
  assert.equal(await decryptFromSync(v1, 'pass-123'), '旧包内容')

  const v2 = await makeLegacyEnvelope(2)
  assert.equal(await decryptFromSync(v2, 'pass-123'), '旧包内容')

  const v3 = await makeLegacyEnvelope(3, 'persona.prompt')
  assert.equal(await decryptFromSync(v3, 'pass-123', 'persona.prompt'), '旧包内容')
  // ctx 对不上要拒绝
  await assert.rejects(decryptFromSync(v3, 'pass-123', '别的字段'), /上下文不匹配/)
})

test('syncCrypto：口令错、包被改、迭代次数越界都拒绝', async () => {
  const envelope = await encryptForSync('秘密字段', 'pass-123', 'x')
  await assert.rejects(decryptFromSync(envelope, 'wrong-pass', 'x'))
  const tampered = { ...envelope, data: Buffer.from(envelope.data, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b)).toString('base64') }
  await assert.rejects(decryptFromSync(tampered, 'pass-123', 'x'))
  const lowIter = { ...envelope, iterations: 1000 }
  await assert.rejects(decryptFromSync(lowIter, 'pass-123', 'x'), /迭代次数过低/)
  assert.equal(isEncryptedEnvelope(envelope), true)
  assert.equal(isEncryptedEnvelope({}), false)
})

/* ---------- backup-vault：WebCrypto 信封与标准实现互通 ---------- */

test('backup-vault：加密信封可用标准 node 实现解开（跨实现互通）', async () => {
  const bundle = createBackupBundle({ memory: { a: 1 } }, { now: () => 1000 })
  const envelope = await encryptBackup(bundle, 'backup-pass')
  assert.equal(envelope.format, 'cyrene-pet-backup-envelope')
  assert.equal(envelope.version, 1)
  assert.equal(envelope.cipher, 'AES-256-GCM')
  assert.equal(envelope.kdf.name, 'PBKDF2')

  const key = await pbkdf2Async('backup-pass', Buffer.from(envelope.kdf.salt, 'base64'), envelope.kdf.iterations, 32, 'sha256')
  // WebCrypto 的 encrypt 把 16 字节 tag 拼在密文末尾，拆开再交给标准实现
  const payload = Buffer.from(envelope.payload, 'base64')
  const tag = payload.subarray(payload.length - 16)
  const data = payload.subarray(0, payload.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(tag)
  const opened = Buffer.concat([decipher.update(data), decipher.final()])
  assert.equal(JSON.parse(opened.toString('utf8')).format, 'cyrene-pet-backup')
})

test('backup-vault：回读一致、口令错提示明确、形状检查', async () => {
  const bundle = createBackupBundle({ memory: { a: 1 } }, { now: () => 1000 })
  const envelope = await encryptBackup(bundle, 'backup-pass')
  const back = await decryptBackup(envelope, 'backup-pass')
  assert.deepEqual(back.data, { memory: { a: 1 } })

  await assert.rejects(decryptBackup(envelope, 'wrong-pass'), /口令不对/)

  const info = inspectBackup(JSON.stringify(envelope))
  assert.equal(info.kind, 'encrypted')
  assert.equal(inspectBackup(JSON.stringify(bundle)).kind, 'plain')
  assert.equal(inspectBackup('垃圾').kind, 'unknown')
})
