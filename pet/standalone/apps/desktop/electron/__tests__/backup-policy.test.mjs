import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const rendererDir = fileURLToPath(new URL('../renderer/', import.meta.url))

async function loadPolicy() {
  const source = await fs.readFile(`${rendererDir}backup-policy.js`, 'utf8')
  const sandbox = {}
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  return sandbox.BackupPolicy
}

const readRenderer = (name) => fs.readFile(`${rendererDir}${name}`, 'utf8')

describe('备份口令策略', () => {
  it('长度判定与提示都取自同一处常量', async () => {
    const policy = await loadPolicy()

    expect(policy.isPassphraseLongEnough('1'.repeat(policy.PASSPHRASE_MIN_LENGTH - 1))).toBe(false)
    expect(policy.isPassphraseLongEnough('1'.repeat(policy.PASSPHRASE_MIN_LENGTH))).toBe(true)
    expect(policy.passphraseTooShortMessage()).toContain(String(policy.PASSPHRASE_MIN_LENGTH))
    expect(policy.passphraseAdvice('1'.repeat(policy.PASSPHRASE_MIN_LENGTH))).not.toBe('')
    expect(policy.passphraseAdvice('1'.repeat(policy.PASSPHRASE_ADVICE_LENGTH))).toBe('')
  })

  it('设置页与首次启动页都引用策略，不再各写阈值', async () => {
    const sources = await Promise.all([
      readRenderer('settings.js'),
      readRenderer('onboarding.js')
    ])

    for (const source of sources) {
      expect(source).toContain('BackupPolicy')
      expect(source).not.toContain('password.length < 8')
      expect(source).not.toContain('口令至少 8 位')
      expect(source).toContain('.minLength = BackupPolicy.PASSPHRASE_MIN_LENGTH')
    }
  })

  it('设置页的静态 minlength 与策略一致', async () => {
    const policy = await loadPolicy()
    const html = await readRenderer('settings.html')
    expect(html).toContain(`minlength="${policy.PASSPHRASE_MIN_LENGTH}"`)
  })
})
