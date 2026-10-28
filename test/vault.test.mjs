/*
 * 插件项目的 vault 自测。
 *
 * 只依赖 node 原生模块，不需要 npm install。
 *   node test/vault.test.mjs
 *
 * 最后一条会尝试解开本机正在用的 ~/.dsh/storages/cyrene-pet/secret.vault.json。
 * 文件不存在时自动跳过；解开后只报 key 长度，不打印内容。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const VAULT_INDEX = new URL('../lib/vault/index.js', import.meta.url)
const RENDER_CONTRACT = new URL('../lib/vault/_shared/contracts/render.js', import.meta.url)

const mod = await import(VAULT_INDEX.href)
const {
  VaultStore,
  MemoryVaultStorage,
  VaultLlmSecretStore,
  LLM_API_KEY_FIELD,
  migrateLegacyLlmKey,
  scrubLegacyLlmKey,
} = mod

const { mediaKindForName, alignForProfile } = await import(RENDER_CONTRACT.href)

const results = []
async function test(name, fn) {
  try {
    const outcome = await fn()
    if (outcome && outcome.skip === true) {
      results.push({ name, ok: true, skipped: true })
      console.log('SKIP  ' + name + (outcome.reason ? '  ->  ' + outcome.reason : ''))
      return
    }
    results.push({ name, ok: true })
    console.log('PASS  ' + name)
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message ?? error) })
    console.log('FAIL  ' + name + '  ->  ' + String(error?.message ?? error))
  }
}

function fakeAudit() {
  const events = []
  const audit = {
    append: async (event, details) => {
      events.push({ event, details })
      return {}
    },
    verify: async () => undefined,
    entries: async () => [],
  }
  return { audit, events }
}

async function makeStore(audit, iterations = 1000) {
  const storage = new MemoryVaultStorage()
  const vault = new VaultStore(storage, { iterations })
  await vault.unlock('test-password')
  return { storage, vault, store: new VaultLlmSecretStore(vault, audit) }
}

console.log('=== dsh-cyrene-pet vault 测试 ===')
console.log('node: ' + process.version)
console.log('')

await test('写入后可取回', async () => {
  const { store } = await makeStore()
  await store.setApiKey('sk-test-123')
  assert.equal(await store.getApiKey(), 'sk-test-123')
})

await test('密文文件不含明文（原始串与 base64 解码后都查）', async () => {
  const { storage, store } = await makeStore()
  const secret = 'sk-test-123'
  await store.setApiKey(secret)

  const raw = storage.raw()
  assert.equal(raw.includes(secret), false)

  const strings = []
  const collect = (value) => {
    if (typeof value === 'string') strings.push(value)
    else if (value !== null && typeof value === 'object') {
      for (const inner of Object.values(value)) collect(inner)
    }
  }
  collect(JSON.parse(raw))

  for (const text of strings) {
    const decoded = Buffer.from(text, 'base64').toString('utf8')
    assert.equal(decoded.includes(secret), false)
  }
})

await test('空 key 明确抛错且不写入', async () => {
  const { store } = await makeStore()
  await assert.rejects(() => store.setApiKey('   '))
  assert.equal(await store.getApiKey(), null)
})

await test('clearApiKey 后返回 null 并写审计', async () => {
  const { audit, events } = fakeAudit()
  const { store } = await makeStore(audit)
  await store.setApiKey('sk-test-123')
  await store.clearApiKey()
  assert.equal(await store.getApiKey(), null)
  assert.equal(events.some((e) => e.event === 'llm_key_cleared'), true)
})

await test('旧明文迁入 Vault 并返回待擦除字段', async () => {
  const { store } = await makeStore()
  const result = await migrateLegacyLlmKey({ [LLM_API_KEY_FIELD]: 'sk-legacy-456' }, store)
  assert.equal(result.migrated, true)
  assert.equal(result.scrubbedField, LLM_API_KEY_FIELD)
  assert.equal(await store.getApiKey(), 'sk-legacy-456')
})

await test('迁移审计不含明文', async () => {
  const { audit, events } = fakeAudit()
  const { store } = await makeStore(audit)
  await migrateLegacyLlmKey({ [LLM_API_KEY_FIELD]: 'sk-legacy-456' }, store, audit)
  const text = JSON.stringify(events)
  assert.equal(text.includes('llm_key_migrated'), true)
  assert.equal(text.includes('sk-legacy-456'), false)
})

await test('scrubLegacyLlmKey 只删 key 字段', async () => {
  const legacy = { [LLM_API_KEY_FIELD]: 'sk-legacy-456', nickname: '柒柒' }
  const scrubbed = scrubLegacyLlmKey(legacy)
  assert.equal(LLM_API_KEY_FIELD in scrubbed, false)
  assert.equal(scrubbed.nickname, '柒柒')
})

await test('没有旧明文时不迁移', async () => {
  const { store } = await makeStore()
  const result = await migrateLegacyLlmKey({ nickname: '柒柒' }, store)
  assert.equal(result.migrated, false)
  assert.equal(result.scrubbedField, null)
})

await test('错误口令解不开', async () => {
  const storage = new MemoryVaultStorage()
  const vault = new VaultStore(storage, { iterations: 1000 })
  await vault.unlock('right-password')
  await new VaultLlmSecretStore(vault).setApiKey('sk-abc-123')

  const wrong = new VaultStore(storage, { iterations: 1000 })
  await assert.rejects(() => wrong.unlock('wrong-password'))
})

await test('篡改密文被识别', async () => {
  const { storage, store } = await makeStore()
  await store.setApiKey('sk-abc-123')

  const raw = JSON.parse(storage.raw())
  const bytes = Buffer.from(raw.ciphertext, 'base64')
  bytes[0] = bytes[0] ^ 0xff
  raw.ciphertext = bytes.toString('base64')
  storage.tamper(JSON.stringify(raw))

  await assert.rejects(() => store.getApiKey())
})

await test('mediaKindForName 五种类型判定', async () => {
  assert.equal(mediaKindForName('a.png'), 'image')
  assert.equal(mediaKindForName('a.gif'), 'gif')
  assert.equal(mediaKindForName('a.mp4'), 'video')
  assert.equal(mediaKindForName('Cyrene.model3.json'), 'live2d')
  assert.equal(mediaKindForName('a.sprite.json'), 'sprite')
  assert.equal(mediaKindForName('a.exe'), null)
})

await test('alignForProfile 映射', async () => {
  assert.equal(alignForProfile({ anchor: 'bottom-center' }), 'bottom')
  assert.equal(alignForProfile({ anchor: 'center' }), 'center')
})

await test('本机 vault 文件可用本机口令解锁（没有就跳过）', async () => {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const vaultPath = join(home, 'storages', 'cyrene-pet', 'secret.vault.json')

  let text
  try {
    text = await readFile(vaultPath, 'utf8')
  } catch {
    return { skip: true, reason: '本机没有 vault 文件：' + vaultPath }
  }

  let guid = ''
  try {
    guid = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8' },
    ).match(/MachineGuid\s+REG_SZ\s+(\S+)/)[1]
  } catch {
    guid = ''
  }
  const user = process.env.USERNAME ?? process.env.USER ?? ''
  const password = createHash('sha256')
    .update(`${guid}|${user}|cyrene-pet-vault-v1`)
    .digest('hex')

  const storage = {
    async read() {
      return text
    },
    async write() {},
    async writeAtomic() {},
  }
  const vault = new VaultStore(storage)
  await vault.unlock(password)
  const data = await vault.load()
  const key = data?.[LLM_API_KEY_FIELD]
  assert.equal(typeof key, 'string')
  assert.equal(key.length > 0, true)
  console.log('      (解锁成功，key 长度 ' + key.length + '，未输出内容)')
})

const skippedCount = results.filter((r) => r.skipped).length
const passed = results.filter((r) => r.ok && !r.skipped).length
const failed = results.filter((r) => !r.ok)
console.log('')
console.log(`结果: ${passed} 通过 / ${failed.length} 失败 / ${skippedCount} 跳过（共 ${results.length} 项）`)
if (failed.length > 0) {
  console.log('失败项:')
  for (const f of failed) console.log('  - ' + f.name + ': ' + f.error)
  process.exitCode = 1
}

void HERE
