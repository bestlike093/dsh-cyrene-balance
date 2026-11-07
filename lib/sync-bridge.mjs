/**
 * 陪伴数据多端同步接线。
 *
 * 只同步 BACKUP_JSON_FILES 里列出的陪伴数据；密钥仓库、记忆密文、模型、
 * 语音缓存、日志都不进来。每条记录以文件 mtime 作为 HLC 的 wall，
 * 合并策略仍走 SyncEngine 的 LWW，冲突原样上报，不静默覆盖。
 *
 * 这个模块不启动服务、不读全局路径；目录、令牌、fetch 都由调用方注入。
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { compareHlc, formatHlc } from './vault/_shared/hlc.js'
import { SyncEngine } from './vault/sync/syncEngine.js'

export const SYNC_FILE_NAMES = Object.freeze([
  'bond.json',
  'opening.json',
  'body.json',
  'thoughts.json',
  'ledger.json',
  'ability.json'
])

const FILE_PREFIX = 'file:'
const DEFAULT_MAX_BYTES = 512 * 1024

function isKnownFile(name) {
  return SYNC_FILE_NAMES.includes(name)
}

function keyOf(name) {
  return `${FILE_PREFIX}${name}`
}

function hashText(text) {
  return createHash('sha256').update(text).digest('hex')
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''))
  const b = Buffer.from(String(right ?? ''))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function normalizeSince(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readText(file, fs, maxBytes) {
  const info = fs.statSync(file)
  if (!info.isFile() || info.size > maxBytes) return null
  return { text: fs.readFileSync(file, 'utf8'), mtimeMs: info.mtimeMs, size: info.size }
}

function writeText(file, text, fs) {
  fs.mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.sync.tmp`
  fs.writeFileSync(temp, text, 'utf8')
  fs.renameSync(temp, file)
}

/**
 * @param {object} options
 * @param {string} options.dir 陪伴数据目录
 * @param {string} options.node 本机节点名
 * @param {object} [options.fs] node:fs 兼容对象
 * @param {object} [options.engine] 可注入 SyncEngine
 * @param {number} [options.maxSkewMs] 文件 mtime 跨机器可能偏差较大，默认放宽
 */
export function createSyncBridge(options = {}) {
  const dir = typeof options.dir === 'string' ? options.dir : ''
  if (dir === '') throw new Error('同步桥需要注入 dir')
  const node = typeof options.node === 'string' && options.node.trim() !== '' ? options.node.trim() : 'local'
  const fs = options.fs ?? { mkdirSync, readFileSync, renameSync, statSync, writeFileSync }
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(1024, options.maxBytes) : DEFAULT_MAX_BYTES
  const engine =
    options.engine ??
    new SyncEngine({
      node,
      maxSkewMs: Number.isFinite(options.maxSkewMs) ? options.maxSkewMs : Number.POSITIVE_INFINITY
    })

  /** 把本地文件吸收进账本；内容没变时保留原 HLC，避免自己把自己刷新成最新。 */
  function absorbLocal() {
    for (const name of SYNC_FILE_NAMES) {
      const file = join(dir, name)
      let current = null
      try {
        current = readText(file, fs, maxBytes)
      } catch {
        continue
      }
      if (current === null) continue
      try {
        JSON.parse(current.text)
      } catch {
        /* 只同步完整 JSON；写了一半的文件不参与，避免把坏文件推到别的端 */
        continue
      }
      const key = keyOf(name)
      const existing = engine.get(key)
      const digest = hashText(current.text)
      if (existing !== undefined && existing.value?.hash === digest) continue
      const hlc = formatHlc({ wall: Math.max(1, Math.trunc(current.mtimeMs)), counter: 0, node })
      if (existing !== undefined && compareHlc(existing.hlc, hlc) > 0) continue
      engine.put(
        key,
        { text: current.text, hash: digest, mtimeMs: Math.trunc(current.mtimeMs), size: current.size },
        hlc
      )
    }
    return engine.snapshot()
  }

  function exportAll() {
    absorbLocal()
    return engine.since(undefined)
  }

  function exportSince(since) {
    absorbLocal()
    return engine.since(normalizeSince(since))
  }

  /**
   * 导入远端变更集。只写远端赢了的记录，本地赢的保持原样；
   * 未知 key 一律忽略，防止远端往目录里塞别的文件。
   */
  function importPayload(remote) {
    absorbLocal()
    const before = new Map(engine.snapshot().map((record) => [record.key, record]))
    const result = engine.merge(remote)
    const applied = []
    const skipped = []
    for (const record of result.records) {
      if (!record.key.startsWith(FILE_PREFIX)) continue
      const name = record.key.slice(FILE_PREFIX.length)
      if (!isKnownFile(name) || typeof record.value?.text !== 'string') {
        skipped.push(record.key)
        continue
      }
      const previous = before.get(record.key)
      const changed = previous === undefined || previous.hlc !== record.hlc || previous.value?.hash !== record.value?.hash
      if (!changed) continue
      writeText(join(dir, name), record.value.text, fs)
      applied.push(name)
    }
    return { applied, skipped, conflicts: result.conflicts, records: result.records }
  }

  return {
    dir,
    node,
    engine,
    absorbLocal,
    exportAll,
    exportSince,
    import: importPayload,
    snapshot: () => engine.snapshot()
  }
}

/**
 * HTTP 端点适配。真正挂到宿主路由时由调用方传入 req 归一化后的参数。
 * token 为空表示端点关闭；令牌比较走常量时间，不在日志里回显。
 */
export function createSyncEndpoint(options = {}) {
  const bridge = options.bridge
  if (bridge === undefined || typeof bridge.exportSince !== 'function') {
    throw new Error('同步端点需要 bridge')
  }
  const token = typeof options.token === 'string' ? options.token : ''
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(1024, options.maxBytes) : DEFAULT_MAX_BYTES

  function authorized(headers = {}) {
    if (token === '') return false
    const raw = headers['x-cyrene-sync-token'] ?? headers['X-Cyrene-Sync-Token']
    return safeEqual(token, raw)
  }

  return async function handle(request = {}) {
    const method = String(request.method ?? 'GET').toUpperCase()
    const url = new URL(String(request.url ?? '/'), 'http://sync.local')
    if (token === '') {
      return { status: 503, value: { ok: false, error: { code: 'sync-disabled' } } }
    }
    if (!authorized(request.headers)) {
      return { status: 401, value: { ok: false, error: { code: 'sync-unauthorized' } } }
    }
    if (method === 'GET' && url.pathname === '/status') {
      bridge.absorbLocal?.()
      return { status: 200, value: { ok: true, node: bridge.node, records: bridge.snapshot().length } }
    }
    if (method === 'GET' && url.pathname === '/pull') {
      return { status: 200, value: { ok: true, value: bridge.exportSince(url.searchParams.get('since')) } }
    }
    if (method === 'POST' && url.pathname === '/push') {
      const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? null)
      if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
        return { status: 413, value: { ok: false, error: { code: 'sync-too-large' } } }
      }
      let payload
      try {
        payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
      } catch {
        return { status: 400, value: { ok: false, error: { code: 'sync-bad-json' } } }
      }
      const remote = payload?.value ?? payload
      try {
        const result = bridge.import(remote)
        return {
          status: 200,
          value: {
            ok: true,
            applied: result.applied,
            skipped: result.skipped,
            conflicts: result.conflicts,
            value: bridge.exportSince(url.searchParams.get('since'))
          }
        }
      } catch (error) {
        return { status: 400, value: { ok: false, error: { code: 'sync-merge-failed', message: String(error?.message ?? error) } } }
      }
    }
    return { status: 404, value: { ok: false, error: { code: 'sync-not-found' } } }
  }
}

/** 拉取 / 推送客户端。fetch 由调用方注入，测试里不碰真实网络。 */
export function createSyncClient(options = {}) {
  const bridge = options.bridge
  if (bridge === undefined || typeof bridge.import !== 'function') throw new Error('同步客户端需要 bridge')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const token = typeof options.token === 'string' ? options.token : ''

  async function request(url, method, body) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境没有 fetch')
    const response = await fetchImpl(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-cyrene-sync-token': token
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const payload = await response.json()
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message ?? `同步请求失败：${response.status}`)
    }
    return payload
  }

  async function pull(baseUrl, since) {
    const url = new URL('/pull', baseUrl)
    if (since !== undefined) url.searchParams.set('since', since)
    const payload = await request(url.toString(), 'GET')
    return bridge.import(payload.value)
  }

  async function push(baseUrl, since) {
    const url = new URL('/push', baseUrl)
    if (since !== undefined) url.searchParams.set('since', since)
    const payload = await request(url.toString(), 'POST', bridge.exportSince(since))
    return bridge.import(payload.value)
  }

  return { pull, push }
}
