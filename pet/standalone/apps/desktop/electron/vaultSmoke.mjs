import { app, safeStorage } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  AesGcmProvider,
  MemoryVaultStorage,
  VaultClient,
  createAuditLog,
  createVault
} from '../../../packages/vault/dist/index.js'

const execFileAsync = promisify(execFile)

async function readAcl(filePath) {
  if (process.platform !== 'win32') {
    const info = await fs.stat(filePath)
    return { mode: (info.mode & 0o777).toString(8) }
  }
  try {
    const { stdout } = await execFileAsync('icacls', [filePath])
    const raw = stdout.trim()
    return {
      raw,
      noInheritedWideAccess: !/(everyone|builtin\\users|\*s-1-1-0)/i.test(raw)
    }
  } catch (error) {
    return { error: String(error) }
  }
}

/**
 * 主进程最小冒烟：只在 app.whenReady() 之后调用。
 * 不做 UI、托盘、设置页、模块注册。
 */
export async function runVaultSmoke() {
  const phase = process.env.PET_VAULT_SMOKE_PHASE ?? 'write'
  const root = path.join(app.getPath('userData'), 'storages', 'vault')
  const keyFilePath = path.join(root, 'keys.json')
  const stateFilePath = path.join(root, 'state.json')
  const auditPath = path.join(root, 'audit.log')
  const sealedPath = path.join(root, 'smoke-sealed.json')

  await fs.mkdir(root, { recursive: true })

  const audit = await createAuditLog(auditPath)
  const assembly = await createVault({
    keyFilePath,
    stateFilePath,
    audit,
    appVersion: app.getVersion(),
    safeStorage
  })
  const vault = new VaultClient(
    new MemoryVaultStorage(),
    new AesGcmProvider(),
    assembly.ring,
    audit
  )

  const diagnostic = await assembly.diagnose()
  const keysStat = await fs.stat(keyFilePath)
  const acl = await readAcl(keyFilePath)

  let result
  if (phase === 'write') {
    const sealed = await vault.seal(new TextEncoder().encode('vault-smoke-write'), {
      kind: 'envelope'
    })
    await fs.writeFile(sealedPath, JSON.stringify(sealed), 'utf8')
    const opened = new TextDecoder().decode(await vault.open(sealed))
    result = { phase, opened, ...payload(diagnostic, keyFilePath, keysStat, acl) }
  } else {
    const sealed = JSON.parse(await fs.readFile(sealedPath, 'utf8'))
    const opened = new TextDecoder().decode(await vault.open(sealed, { allowLegacyEpoch: true }))
    result = { phase, opened, ...payload(diagnostic, keyFilePath, keysStat, acl) }
  }

  console.log('[vault-smoke] RESULT ' + JSON.stringify(result))
  return result
}

function payload(diagnostic, keyFilePath, keysStat, acl) {
  return {
    backend: diagnostic.backend,
    secure: diagnostic.secure,
    permission: diagnostic.permission,
    severity: diagnostic.severity,
    keyFilePath,
    keyFileSize: keysStat.size,
    acl,
    userData: app.getPath('userData'),
    electron: process.versions.electron
  }
}
