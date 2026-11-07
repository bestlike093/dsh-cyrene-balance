import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SYNCABLE_SETTINGS_KEYS, createSettingsSync } from '../sync.mjs'

const dirs = []

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-settings-sync-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function node(dir, id, initial, passphrase = null) {
  let settings = { ...initial }
  const sync = createSettingsSync({
    dir,
    node: id,
    readSettings: () => settings,
    getPassphrase: async () => passphrase,
    applySettings: (patch) => {
      settings = { ...settings, ...patch }
    }
  })
  return { sync, get: () => settings }
}

async function readOnlyPacket(dir, id) {
  const files = await readdir(join(dir, id))
  expect(files).toHaveLength(1)
  return JSON.parse(await readFile(join(dir, id, files[0]), 'utf8'))
}

function recordValue(packet, key) {
  return packet.changeSet.records.find((record) => record.key === key)?.value
}

const baseSettings = {
  nickname: '小鹿',
  locale: 'zh-CN',
  theme: { preset: 'pink' },
  voice: { enabled: true },
  window: { scale: 0.7 },
  live2dModelId: 'local-model'
}

const PROMPT = '这是本机额外人格提示，不该以明文离开本机'
const PASSPHRASE = 'cyrene-sync-passphrase'

const withCompanion = {
  ...baseSettings,
  companion: { persona: { extraPrompt: PROMPT, tone: 'gentle' }, name: 'Cyrene' }
}

describe('设置同步（本机目录）', () => {
  it('A 导出后 B 合并，只写回可同步的键', async () => {
    const dir = await tempDir()
    const a = node(dir, 'A', baseSettings)
    const b = node(dir, 'B', { nickname: '', locale: 'en-US', window: { scale: 1 } })

    const published = await a.sync.publish()
    expect(published.ok).toBe(true)

    const pulled = await b.sync.pull()
    expect(pulled.ok).toBe(true)
    expect(b.get().nickname).toBe('小鹿')
    expect(b.get().locale).toBe('zh-CN')
    expect(b.get().theme).toEqual({ preset: 'pink' })
    // 机器相关的字段不会被对端覆盖。
    expect(b.get().window).toEqual({ scale: 1 })
  })

  it('两端都改同一键时后写者胜，冲突被记录', async () => {
    const dir = await tempDir()
    const a = node(dir, 'A', { ...baseSettings, nickname: '甲' })
    const b = node(dir, 'B', { ...baseSettings, nickname: '乙' })

    await a.sync.publish()
    await b.sync.pull()
    expect(b.get().nickname).toBe('甲')

    // B 合并后改写，HLC 一定更新。
    b.get().nickname = '乙'
    await b.sync.publish()
    const pulled = await a.sync.pull()

    expect(a.get().nickname).toBe('乙')
    expect(pulled.conflicts.some((item) => item.key === 'nickname' && item.winner === 'remote')).toBe(
      true
    )
  })

  it('同步包里不含机器相关设置', async () => {
    const dir = await tempDir()
    const a = node(dir, 'A', baseSettings)
    await a.sync.publish()

    const packet = await readOnlyPacket(dir, 'A')
    const keys = packet.changeSet.records.map((record) => record.key)

    expect(keys).toContain('nickname')
    expect(keys).not.toContain('window')
    expect(keys).not.toContain('live2dModelId')
    for (const key of keys) {
      expect(SYNCABLE_SETTINGS_KEYS).toContain(key)
    }
  })

  it('没有待处理包时 pull 是空操作', async () => {
    const dir = await tempDir()
    const a = node(dir, 'A', baseSettings)
    const pulled = await a.sync.pull()
    expect(pulled.applied).toBe(0)
    expect(pulled.conflicts).toEqual([])
    expect(pulled.skipped).toEqual([])
  })
})

describe('同步加密（口令）', () => {
  it('有口令时敏感字段只以密文出现，对端同口令能解回', async () => {
    const dir = await tempDir()
    const a = node(dir, 'A', withCompanion, PASSPHRASE)
    const published = await a.sync.publish()
    expect(published.encrypted).toBe(true)

    const packet = await readOnlyPacket(dir, 'A')
    // 整包里不能出现明文，也不能出现未加密的 extraPrompt 字段。
    expect(JSON.stringify(packet)).not.toContain(PROMPT)
    const companion = recordValue(packet, 'companion')
    expect(companion.persona.extraPrompt).toBeUndefined()
    // v3 起信封绑定字段身份，旧 v1/v2 包仍可解，但新写出的都是 v3。
    expect(companion.__encryptedExtraPrompt.__encSync).toBe(3)
    expect(companion.__encryptedExtraPrompt.ctx).toBe('companion.persona.extraPrompt')
    // 同块的非敏感字段照常同步。
    expect(companion.name).toBe('Cyrene')

    const b = node(dir, 'B', { companion: { persona: {} } }, PASSPHRASE)
    const pulled = await b.sync.pull()
    expect(pulled.skipped).toEqual([])
    expect(b.get().companion.persona.extraPrompt).toBe(PROMPT)
  })

  it('没有口令时不带密文字段，明文也不进包', async () => {
    const dir = await tempDir()
    const a = node(dir, 'A', withCompanion)
    const published = await a.sync.publish()
    expect(published.encrypted).toBe(false)

    const packet = await readOnlyPacket(dir, 'A')
    expect(JSON.stringify(packet)).not.toContain(PROMPT)
    const companion = recordValue(packet, 'companion')
    expect(companion.__encryptedExtraPrompt).toBeUndefined()
    expect(companion.persona.extraPrompt).toBeUndefined()
  })

  it('对端口令错误时解不开，记为 sync-decrypt-failed 且不写入明文', async () => {
    const dir = await tempDir()
    const a = node(dir, 'A', withCompanion, PASSPHRASE)
    await a.sync.publish()

    const c = node(dir, 'C', { companion: { persona: {} } }, 'wrong-passphrase')
    const pulled = await c.sync.pull()

    expect(pulled.skipped.some((item) => item.reason === 'sync-decrypt-failed')).toBe(true)
    expect(c.get().companion.persona.extraPrompt).toBeUndefined()
  })

  it('对端没有口令时跳过密文字段，其余偏好仍然合并', async () => {
    const dir = await tempDir()
    const a = node(dir, 'A', withCompanion, PASSPHRASE)
    await a.sync.publish()

    const d = node(dir, 'D', { nickname: '', companion: { persona: {} } })
    const pulled = await d.sync.pull()

    expect(pulled.skipped.some((item) => item.reason === 'sync-passphrase-missing')).toBe(true)
    expect(d.get().companion.persona.extraPrompt).toBeUndefined()
    expect(d.get().companion.name).toBe('Cyrene')
    expect(d.get().nickname).toBe('小鹿')
  })
})
