/**
 * 本机设置同步：把可跨机器共享的偏好写成同步包，并合并对端留下的变更集。
 *
 * 这里只走文件目录，不连任何远端端点。默认目录是 userData/sync，
 * 可以用 PET_SYNC_DIR 指向一个共享目录，用 PET_SYNC_NODE 区分节点名。
 *
 * 不同步的内容：window（位置尺寸）、profile / renderMode（屏幕相关）、
 * modules（本机能力）、live2dModelId（本地模型）、onboarded（每台机器自己走引导）。
 */

import { createFileSyncTransport, SyncEngine } from '../../../packages/vault/dist/index.js'
import { decryptFromSync, encryptForSync, isEncryptedEnvelope } from './syncCrypto.mjs'

export const SYNCABLE_SETTINGS_KEYS = Object.freeze([
  'nickname',
  'locale',
  'uiMode',
  'bubble',
  'askHandling',
  'askEveryMinutes',
  'poseEverySeconds',
  'soundLevel',
  'companion',
  'showHud',
  'hudDetail',
  'hudAlpha',
  'hudScale',
  'hudFontScale',
  'theme',
  'defaultEmotion'
])

/**
 * 整块 key 仍然要同步，但其中某些子路径必须剔掉。
 *
 * 同步目录可能被 PET_SYNC_DIR 指到共享盘，写出去的东西等于离开本机。
 * 这里列的是「一旦离开本机就会暴露额外信息」的字段，导出和合并两个方向都要过一遍：
 * 只处理导出的话，旧节点留下的历史包仍会把明文带回来。
 *
 * voice 不进同步白名单：refAudioPath / localUrl / cloud.baseUrl 会暴露用户名与内网拓扑，
 * 而这条信息对「换机后偏好一致」几乎没有价值。
 *
 * 被剔掉的字段如果配了同步口令，会改走 ENCRYPTED_SYNC_PATHS 的密文通道。
 */
export const REDACTED_SETTINGS_PATHS = Object.freeze([
  Object.freeze(['companion', 'persona', 'extraPrompt'])
])

const ENCRYPTED_SYNC_PATHS = Object.freeze([Object.freeze(['companion', 'persona', 'extraPrompt'])])

/** 同步包里的密文字段名。前缀双下划线，避免和真实设置项撞名。 */
export const ENCRYPTED_SYNC_FIELD = '__encryptedExtraPrompt'

/** 密文绑定的字段身份；同一口令下把密文搬到别的字段会解不开。 */
const ENCRYPTED_SYNC_CONTEXT = 'companion.persona.extraPrompt'

function cloneForSync(value) {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

function readPath(target, path) {
  let cursor = target
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object' || !(segment in cursor)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

function redactPath(target, path) {
  if (path.length === 0) return
  let cursor = target
  for (let i = 0; i < path.length - 1; i += 1) {
    if (cursor === null || typeof cursor !== 'object' || !(path[i] in cursor)) return
    cursor = cursor[path[i]]
  }
  const last = path[path.length - 1]
  if (cursor !== null && typeof cursor === 'object') delete cursor[last]
}

/** 返回可安全写进同步包的副本；传进来的 settings 对象本身不会被改。 */
export function redactForSync(key, value) {
  const copy = cloneForSync(value)
  if (copy === null || typeof copy !== 'object') return copy
  for (const path of REDACTED_SETTINGS_PATHS) {
    if (path[0] === key) redactPath(copy, path.slice(1))
  }
  return copy
}

/**
 * 导出方向：先按红线剔一遍，再把剔掉的值加密塞回同级的密文字段。
 * 没有口令时只做剔除，行为和之前一致。
 */
async function packageForPublish(key, rawValue, passphrase) {
  const copy = redactForSync(key, rawValue)
  if (!passphrase || copy === null || typeof copy !== 'object') return copy

  for (const path of ENCRYPTED_SYNC_PATHS) {
    if (path[0] !== key) continue
    const plain = readPath(rawValue, path.slice(1))
    if (typeof plain !== 'string' || plain.length === 0) continue
    try {
      copy[ENCRYPTED_SYNC_FIELD] = await encryptForSync(
        plain,
        passphrase,
        ENCRYPTED_SYNC_CONTEXT
      )
    } catch (error) {
      // 加密失败不阻断整包：宁可这次不带，也不退回明文。
      return copy
    }
  }

  return copy
}

/**
 * 合并方向：认密文字段就解开写回原位；没有口令或解不开时保留其余字段，
 * 把原因交给调用方记进 skipped，不静默丢掉整块偏好。
 */
async function resolveIncoming(key, rawValue, passphrase) {
  const copy = cloneForSync(rawValue)
  if (copy === null || typeof copy !== 'object') {
    return { value: redactForSync(key, rawValue) }
  }

  // 旧节点可能留下未脱敏的历史包，先无条件清掉明文残留。
  for (const path of REDACTED_SETTINGS_PATHS) {
    if (path[0] === key) redactPath(copy, path.slice(1))
  }

  const envelope = copy[ENCRYPTED_SYNC_FIELD]
  if (!isEncryptedEnvelope(envelope)) return { value: copy }

  delete copy[ENCRYPTED_SYNC_FIELD]
  if (!passphrase) return { value: copy, note: 'sync-passphrase-missing' }

  try {
    const plain = await decryptFromSync(envelope, passphrase, ENCRYPTED_SYNC_CONTEXT)
    const target = key === 'companion' ? 'companion' : null
    if (target === null) return { value: copy, note: 'sync-encrypted-field-unknown' }
    if (!copy.persona || typeof copy.persona !== 'object') copy.persona = {}
    copy.persona.extraPrompt = plain
    return { value: copy }
  } catch (error) {
    return { value: copy, note: 'sync-decrypt-failed' }
  }
}

export function createSettingsSync(options) {
  const {
    dir,
    node,
    readSettings,
    applySettings,
    getPassphrase = async () => null,
    log = () => {}
  } = options
  const transport = createFileSyncTransport({ dir, node })
  const engine = new SyncEngine({ node })

  async function currentPassphrase() {
    try {
      const value = await getPassphrase()
      return typeof value === 'string' && value.length > 0 ? value : null
    } catch (error) {
      // 口令仓库不可用时不阻塞普通字段同步，但这次按「没有口令」处理。
      return null
    }
  }

  return {
    node,
    dir,

    /** 导出当前可同步偏好。每次都是全量快照，对端按 HLC 合并。 */
    async publish() {
      const settings = readSettings()
      const passphrase = await currentPassphrase()
      const records = []

      for (const key of SYNCABLE_SETTINGS_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(settings, key)) continue
        const value = await packageForPublish(key, settings[key], passphrase)
        records.push(engine.put(key, value))
      }

      const file = await transport.publish({ node, records })
      log('[sync] 已导出', `${records.length} 项`, passphrase ? '含密文' : '无口令', file)
      return { ok: true, file, count: records.length, encrypted: passphrase !== null }
    },

    /** 读取对端变更集，按 HLC 合并后只把最终胜出的值写回设置。 */
    async pull() {
      const { packets, skipped } = await transport.collect()
      const passphrase = await currentPassphrase()
      const patch = {}
      const conflicts = []
      const consumed = []

      for (const packet of packets) {
        try {
          const result = engine.merge(packet.changeSet)
          conflicts.push(...result.conflicts)
          for (const record of packet.changeSet.records) {
            const current = engine.get(record.key)
            if (current === undefined || !SYNCABLE_SETTINGS_KEYS.includes(record.key)) continue
            const resolved = await resolveIncoming(record.key, current.value, passphrase)
            if (resolved.note) skipped.push({ path: packet.path, reason: resolved.note })
            patch[record.key] = resolved.value
          }
          consumed.push(packet.path)
        } catch (error) {
          skipped.push({
            path: packet.path,
            reason: error instanceof Error ? error.message : String(error)
          })
        }
      }

      if (Object.keys(patch).length > 0) {
        await applySettings(patch)
      }
      await transport.ack(consumed)

      const applied = Object.keys(patch).length
      log(
        '[sync] 已合并',
        `applied=${applied}`,
        `conflicts=${conflicts.length}`,
        `skipped=${skipped.length}`,
        passphrase ? '有口令' : '无口令'
      )
      return { ok: true, applied, conflicts, skipped }
    }
  }
}
