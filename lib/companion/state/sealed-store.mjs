/**
 * 陪伴数据的密封层：好感、开口账本、身体、念头、亲密这些文件不该躺着明文。
 *
 * 口令和 API Key 仓库同源，由本机 MachineGuid + 当前用户名派生：
 * 配置文件被拷走、被同步、被上传时是解不开的；同一台机器同一个用户仍然能读。
 * 这一点不糊弄人，README 里也照实写。
 *
 * 读写都是同步的：companion-runtime 在模块初始化时就要读到 bond，
 * 不能为了一个异步解锁把整条启动链挂住。口令派生只做一次，之后走缓存。
 *
 * 旧明文迁移的顺序是「先备份、再写密文、回读校验、最后改名覆盖」。
 * 校验不通过就保留原文件继续用明文，备份 `.plain.bak` 不自动删除。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { hmacSubKey, openGcmSync, randomBytesSync, sealGcmSync, utf8Encode } from '../system/crypto-kit.mjs'

export const SEALED_FORMAT = 'cyrene-sealed-v1'

const PASSWORD_LABEL = 'cyrene-companion-state-v1'
const AAD_PREFIX = 'cyrene-companion'

let cachedPassword = null

function readMachineGuid() {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { windowsHide: true, timeout: 4000, encoding: 'utf8' }
    )
    const line = String(out)
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.startsWith('MachineGuid'))
    return line?.split(/\s+/).pop() ?? ''
  } catch {
    /* 拿不到 MachineGuid 时降级成只用用户名，宁可弱一点也不能让启动卡死 */
    return ''
  }
}

/** 本机口令。进程内只派生一次。 */
export function machinePassword() {
  if (cachedPassword !== null) return cachedPassword
  const user = process.env.USERNAME ?? process.env.USER ?? ''
  const guid = readMachineGuid()
  cachedPassword = createHash('sha256').update(`${guid}|${user}|${PASSWORD_LABEL}`).digest('hex')
  return cachedPassword
}

function keyFor(name, password) {
  /* 每个文件一把子密钥：换名、换文件都对不上，降低被整体搬运的价值 */
  return hmacSubKey(password, `sealed:${name}`)
}

function aadFor(name) {
  return Buffer.from(`${AAD_PREFIX}:${name}`, 'utf8')
}

/** 明文 → 自描述信封。name 参与口令派生和 AAD，文件被改名就解不开。 */
export function sealText(name, text, password = machinePassword()) {
  const iv = randomBytesSync(12)
  const { data, tag } = sealGcmSync(keyFor(name, password), iv, utf8Encode(text), aadFor(name))
  return `${JSON.stringify({
    format: SEALED_FORMAT,
    name,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  }, null, 2)}\n`
}

/** 信封 → 明文。格式不对、名字不对、口令不对都会抛错。 */
export function unsealText(name, raw, password = machinePassword()) {
  const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (envelope === null || typeof envelope !== 'object' || envelope.format !== SEALED_FORMAT) {
    throw new Error('不是密封数据')
  }
  if (typeof envelope.name === 'string' && envelope.name !== name) {
    throw new Error(`密封数据的名字对不上：${envelope.name} ≠ ${name}`)
  }
  const data = openGcmSync(
    keyFor(name, password),
    Buffer.from(envelope.iv, 'base64'),
    Buffer.from(envelope.data, 'base64'),
    Buffer.from(envelope.tag, 'base64'),
    aadFor(name)
  )
  return data.toString('utf8')
}

/** 只判断形状，不解密。备份、同步、观察台用它决定走哪条路。 */
export function isSealed(raw) {
  if (typeof raw !== 'string') return false
  try {
    return JSON.parse(raw)?.format === SEALED_FORMAT
  } catch {
    return false
  }
}

/**
 * 目录级的密封仓库。文件名当身份，路径只在内部拼接。
 *
 * @param {object} options
 * @param {string} options.dir 数据目录
 * @param {(message: string, error?: unknown) => void} [options.log]
 * @param {string} [options.password] 一般不用传，测试时才注入
 */
export function createSealedStore({ dir, log = () => {}, password = null } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new Error('sealed-store 需要注入 dir')
  const pass = password ?? machinePassword()
  const migrating = new Set()

  function fileOf(name) {
    return join(dir, name)
  }

  function readText(name, fallback = null) {
    const file = fileOf(name)
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return fallback
    }
    if (isSealed(raw)) {
      try {
        return unsealText(name, raw, pass)
      } catch (error) {
        log(`${name} 解密失败，本次按空数据继续`, error)
        return fallback
      }
    }
    /* 旧明文：先迁移，再把内容交出去。迁移失败不影响这一次读取。 */
    migrate(name, raw)
    return raw
  }

  function migrate(name, text) {
    if (migrating.has(name)) return
    migrating.add(name)
    const file = fileOf(name)
    const backup = `${file}.plain.bak`
    try {
      if (!existsSync(backup)) copyFileSync(file, backup)
      const sealed = sealText(name, text, pass)
      const temp = `${file}.sealed.tmp`
      writeFileSync(temp, sealed, 'utf8')
      const check = unsealText(name, readFileSync(temp, 'utf8'), pass)
      if (check !== text) throw new Error('回读校验和原内容不一致')
      renameSync(temp, file)
      log(`${name} 已转为密文，原文明文留在 ${backup}`)
    } catch (error) {
      log(`${name} 迁移失败，继续用明文`, error)
    } finally {
      migrating.delete(name)
    }
  }

  function writeText(name, text) {
    const file = fileOf(name)
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, sealText(name, text, pass), 'utf8')
    renameSync(temp, file)
  }

  function readJson(name, normalize, fallback) {
    const text = readText(name)
    if (text === null) return fallback
    try {
      const parsed = JSON.parse(text)
      return typeof normalize === 'function' ? normalize(parsed) : parsed
    } catch (error) {
      log(`${name} 内容读不出来，按默认值继续`, error)
      return fallback
    }
  }

  function writeJson(name, value) {
    writeText(name, `${JSON.stringify(value, null, 2)}\n`)
    return value
  }

  return {
    dir,
    readText,
    writeText,
    readJson,
    writeJson,
    /** 把外部拿到的明文原样落成密文，用于备份恢复与多端同步 */
    writePlain(name, text) {
      writeText(name, text)
    },
  }
}
