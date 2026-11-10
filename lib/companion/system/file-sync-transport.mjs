/**
 * 本机目录传输层：把 SyncEngine 的变更集写成文件，供同目录下的另一个节点读取。
 *
 * 目录约定：<dir>/<node>/<hlc>-<seq>.json
 * 每个节点只写自己的目录，读取时跳过自己的目录，避免自读自合。
 */
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { SyncError } from './sync-engine.mjs'

export const SYNC_PACKET_FORMAT = 'pet-sync-changeset'
export const SYNC_PACKET_VERSION = 1
/** 单个变更集文件上限。正常设置同步只有几百字节。 */
export const SYNC_MAX_PACKET_BYTES = 512 * 1024
/** 一次最多读取的待处理包数量，防止目录被异常堆积撑爆。 */
export const SYNC_MAX_PENDING_PACKETS = 200
const NODE_PATTERN = /^[A-Za-z0-9._-]{1,40}$/

function assertNodeName(node) {
  if (!NODE_PATTERN.test(String(node ?? ''))) {
    throw new SyncError('invalid-node', '同步节点名只允许字母、数字、点、下划线和短横线，长度 1–40')
  }
}

function isSafeFileName(name) {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

function parsePacket(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SyncError('bad-packet', '同步包不是合法 JSON')
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new SyncError('bad-packet', '同步包必须是对象')
  }
  if (parsed.format !== SYNC_PACKET_FORMAT || parsed.version !== SYNC_PACKET_VERSION) {
    throw new SyncError('unsupported-packet', '同步包格式或版本不受支持')
  }
  const changeSet = parsed.changeSet
  if (
    changeSet === null ||
    typeof changeSet !== 'object' ||
    typeof changeSet.node !== 'string' ||
    !Array.isArray(changeSet.records)
  ) {
    throw new SyncError('bad-packet', '同步包缺少变更集')
  }
  return changeSet
}

export function createFileSyncTransport(options = {}) {
  assertNodeName(options.node)
  const dir = String(options.dir ?? '')
  if (dir === '') throw new SyncError('missing-dir', '同步目录不能为空')
  const node = String(options.node)
  const maxPacketBytes = Number.isFinite(options.maxPacketBytes) ? options.maxPacketBytes : SYNC_MAX_PACKET_BYTES
  const maxPending = Number.isFinite(options.maxPending) ? options.maxPending : SYNC_MAX_PENDING_PACKETS

  return {
    dir,
    node,

    /** 原子写入一份变更集，返回文件绝对路径。 */
    async publish(changeSet) {
      if (changeSet?.node !== node) {
        throw new SyncError('node-mismatch', '变更集节点与传输层节点不一致')
      }
      const body = JSON.stringify({
        format: SYNC_PACKET_FORMAT,
        version: SYNC_PACKET_VERSION,
        changeSet
      })
      if (Buffer.byteLength(body, 'utf8') > maxPacketBytes) {
        throw new SyncError('packet-too-large', `同步包超出上限（${maxPacketBytes} 字节）`)
      }

      const ownDir = join(dir, node)
      await mkdir(ownDir, { recursive: true })
      const maxHlc = changeSet.records.reduce(
        (current, record) => (record.hlc > current ? record.hlc : current),
        ''
      )
      const safeHlc = maxHlc.replace(/[^A-Za-z0-9._-]/g, '-')
      const target = join(ownDir, `${safeHlc || 'empty'}-${Date.now()}.json`)
      const temp = `${target}.tmp`
      await writeFile(temp, body, { encoding: 'utf8', mode: 0o600 })
      /* 先写临时文件再改名，避免别的节点读到半个包。 */
      await rename(temp, target)
      return target
    },

    /** 读取其他节点留下的变更集，按文件名（HLC 前缀）排序。 */
    async collect() {
      const packets = []
      const skipped = []

      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (error) {
        if (error?.code === 'ENOENT') return { packets, skipped }
        throw error
      }

      const otherNodes = entries
        .filter((entry) => entry.isDirectory() && entry.name !== node)
        .map((entry) => entry.name)
        .filter((name) => NODE_PATTERN.test(name))
        .sort()

      for (const other of otherNodes) {
        if (packets.length >= maxPending) break
        const nodeDir = join(dir, other)
        const files = (await readdir(nodeDir)).filter(isSafeFileName).sort()

        for (const file of files) {
          if (packets.length >= maxPending) break
          const filePath = join(nodeDir, file)
          try {
            const info = await stat(filePath)
            if (!info.isFile()) {
              skipped.push({ path: filePath, reason: '不是普通文件' })
              continue
            }
            if (info.size > maxPacketBytes) {
              skipped.push({ path: filePath, reason: '超出单包大小上限' })
              continue
            }
            packets.push({ path: filePath, changeSet: parsePacket(await readFile(filePath, 'utf8')) })
          } catch (error) {
            skipped.push({ path: filePath, reason: String(error?.message ?? error) })
          }
        }
      }

      return { packets, skipped }
    },

    /** 合并成功后删除已消费的包。 */
    async ack(paths) {
      const rootPrefix = resolve(dir) + sep
      const ownPrefix = resolve(join(dir, node)) + sep
      for (const filePath of Array.isArray(paths) ? paths : []) {
        const normalized = resolve(String(filePath))
        /* 只删同步根目录下、其它节点写下的包；自己的目录与越界路径都不动。 */
        if (!normalized.startsWith(rootPrefix) || normalized.startsWith(ownPrefix)) continue
        await unlink(normalized).catch(() => undefined)
      }
    }
  }
}
