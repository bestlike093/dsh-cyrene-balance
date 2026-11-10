/**
 * dsh-cyrene-pet/memory —— 记忆层 组件行（M2，已从主插件拆出）。
 *
 * 本行只管「记住什么、还能不能想起来」这一条线：
 *   - vault 四层记忆（memoryStore）：仓库生命周期归主行（kernel），
 *     这里经 cyrene/kernel.getMemoryVault() 拿同一实例读写；
 *   - 观察台快照（memory-snapshot.json）：记忆一变就刷新给桌宠进程；
 *   - 会话记忆抽取（ingestSessionMemory）：从最近会话挑值得记住的事；
 *   - 记忆管理 web 端点（/companion/memory*）：与拆分前路径、响应完全一致。
 *
 * 不做的事：不碰主行的 state 文件（记忆开关等状态经 kernel.readState /
 * writeState 走）、不碰其它插件的状态、不注册全局副作用；行内失败只降级
 * 自己（companion 服务缺省时快照 peers 留空）。
 *
 * 拆分蓝图与里程碑见 docs/component-split.md。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createMemoryStore, extractMemoryCandidates, PER_ROUND_LIMIT } from '../companion/index.mjs'

export const name = 'dsh-cyrene-pet/memory'
export const inject = ['webServer', 'systemPrompt', 'cyrene/kernel']

const ROUTE_PREFIX = '/cyrene-pet'
const MAX_BODY_BYTES = 32 * 1024

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`请求体超过 ${limit} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error(`JSON 解析失败：${error?.message ?? String(error)}`))
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  /* DSH 的 cordis 只把 (ctx, config) 传给 apply；注入的服务一律经 ctx.get 取。 */
  const kernel = ctx.get('cyrene/kernel')
  if (kernel === null || kernel === undefined) {
    throw new Error('dsh-cyrene-pet/memory：cyrene/kernel 未提供，本行无法启动')
  }
  const companion = ctx.get('cyrene/companion', { optional: true })

  const log = (message, error) => {
    if (error === undefined) ctx.logger?.warn?.(`${name}: ${message}`)
    else ctx.logger?.warn?.(`${name}: ${message}`, error)
  }

  /* ---------------- vault 四层记忆 ---------------- */

  /* 仓库文件与解锁都归主行（kernel）：这里只借读写适配器，
     调用方看到的是 JSON 文本，密文与解锁全在 kernel 那一侧。 */
  const memoryStore = createMemoryStore({
    readText: async () => {
      const vault = await kernel.getMemoryVault()
      const data = await vault.load()
      return data === null ? null : JSON.stringify(data)
    },
    writeText: async (text) => {
      const vault = await kernel.getMemoryVault()
      await vault.save(JSON.parse(text))
    },
  })

  /* ---------------- 记忆观察台：给桌宠窗口的只读快照 ---------------- */

  /*
   * 桌宠是另一个进程，拿不到这里的加密记忆。
   * 记忆或好感一变，就把「能看的那部分」压成明文快照放回主目录；
   * 桌宠只读这个文件，不碰密钥，也不反向写。
   */
  const MEMORY_SNAPSHOT_DIR = join(homedir(), '.cyrene-pet')
  const MEMORY_SNAPSHOT_PATH = join(MEMORY_SNAPSHOT_DIR, 'memory-snapshot.json')
  let memorySnapshotAt = 0
  let memorySnapshotBusy = false

  async function writeMemorySnapshot(force = false) {
    const at = Date.now()
    if (force !== true && at - memorySnapshotAt < 3000) return
    if (memorySnapshotBusy) return
    memorySnapshotBusy = true
    memorySnapshotAt = at
    const owners = Array.isArray(kernel.readState()?.qq?.ownerOpenIds)
      ? kernel.readState().qq.ownerOpenIds
      : []
    const peers =
      typeof companion?.peerStateList === 'function' ? companion.peerStateList() : []
    let payload
    try {
      const memory = await memoryStore.load()
      const scopes = await memoryStore.listScopes()
      /*
       * 空表要能自己解释自己：仓库是空的、还是解不开，
       * 观察台看到的是两种完全不同的状况，不能都显示成「0 条」。
       */
      payload = {
        ok: true,
        version: 2,
        at,
        source: 'plugin',
        itemCount: Array.isArray(memory?.items) ? memory.items.length : 0,
        vaultError: kernel.memoryVaultError(),
        ownerOpenIds: owners,
        scopes,
        peers,
      }
    } catch (error) {
      payload = {
        ok: false,
        version: 2,
        at,
        source: 'plugin',
        reason: String(error?.message ?? error),
        vaultError: kernel.memoryVaultError(),
        itemCount: 0,
        ownerOpenIds: owners,
        scopes: { owners: [], privates: [], groups: [] },
        peers,
      }
    }
    try {
      await mkdir(MEMORY_SNAPSHOT_DIR, { recursive: true })
      await writeFile(MEMORY_SNAPSHOT_PATH, JSON.stringify(payload, null, 2), 'utf8')
    } catch (error) {
      log(`[memory] 快照写入失败：${String(error?.message ?? error)}`)
    } finally {
      memorySnapshotBusy = false
    }
  }

  /* ---------------- 会话记忆抽取 ---------------- */

  let memoryIngestTotal = -1
  let memoryIngestSession = ''
  let memoryIngestPending = false

  /* 主人记忆按账号分桶；DSH 里没有绑定关系时落在第一位主人名下。 */
  function resolveOwnerScopeId() {
    const owners = Array.isArray(kernel.readState()?.qq?.ownerOpenIds)
      ? kernel.readState().qq.ownerOpenIds
      : []
    return String(owners[0] ?? '').trim() || 'owner-1'
  }

  /*
   * 从最近的用户发言里挑出值得记住的事，落进 vault 记忆。
   * 只认明确的自述、偏好、近期事件和「记住……」，不把代码和闲话塞进去。
   */
  async function ingestActiveSessionMemory(view) {
    const stateNow = kernel.readState()
    if (stateNow.memoryEnabled === false || kernel.axisOn('memory') === false) return
    if (memoryIngestPending || view === null || !Array.isArray(view.messages)) return
    if (view.id === memoryIngestSession && view.total === memoryIngestTotal) return
    memoryIngestPending = true
    try {
      await memoryStore.load()
      const ownerScopeId = resolveOwnerScopeId()
      const existing = new Set(
        memoryStore
          .snapshot()
          .items.filter((item) => item.scope === 'owner' && item.scopeId === ownerScopeId)
          .map((item) => `${item.slot}:${item.text}`),
      )
      const candidates = []
      for (const message of view.messages) {
        if (message?.role !== 'user' || message?.kind !== 'message') continue
        candidates.push(...extractMemoryCandidates(message.text))
      }

      let changed = false
      // 单轮上限与抽取层的口径一致（MEM-006）：值得记的不再被硬压到 4 条。
      for (const item of candidates.slice(0, PER_ROUND_LIMIT)) {
        const key = `${item.slot}:${item.text}`
        if (existing.has(key)) continue
        existing.add(key)
        try {
          /* DSH 这条线上她只是信使：内容作为主人事件记下，不参与人设语境。 */
          await memoryStore.remember({
            ...item,
            source: 'session',
            scope: 'owner',
            scopeId: ownerScopeId,
            channel: 'dsh',
          })
          changed = true
        } catch {
          /* 单条记不进去不挡下一条 */
        }
      }
      memoryIngestSession = view.id
      memoryIngestTotal = view.total
      if (changed) {
        /* 第一次自动写入时留一条可见记录，设置页会提示一次，可手动关掉 */
        if (!(Number(stateNow.memoryFirstWriteAt) > 0)) {
          /* state 归主行：经 kernel.writeState 写回，不直接碰主行的文件。 */
          await kernel.writeState({ ...kernel.readState(), memoryFirstWriteAt: Date.now() })
        }
        notifyChanged()
      }
    } catch {
      /* 会话读得到但记忆写不进去时，下一轮再说 */
    } finally {
      memoryIngestPending = false
    }
  }

  /* 记忆变了就走一次统一收尾：快照刷新 + 广播给主行重挂人格记忆行。 */
  function notifyChanged() {
    void writeMemorySnapshot(false)
    ctx.emit('cyrene/memory-changed', { at: Date.now() })
  }

  /* ---------------- 跨行服务 ---------------- */

  ctx.provide('cyrene/memory', {
    load: () => memoryStore.load(),
    digest: (scope, scopeId) => memoryStore.digest(scope, scopeId),
    remember: (input) => memoryStore.remember(input),
    snapshot: () => memoryStore.snapshot(),
    replace: (input) => memoryStore.replace(input),
    recall: (query, options) => memoryStore.recall(query, options),
    pin: (id, pinned) => memoryStore.pin(id, pinned),
    forget: (id) => memoryStore.forget(id),
    listScopes: () => memoryStore.listScopes(),
    ingestSessionMemory: (view) => ingestActiveSessionMemory(view),
    notifyChanged,
  })

  /* ---------------- 记忆管理 web 端点 ---------------- */

  /*
   * 主行已注册 '/cyrene-pet' 的 prefix 路由，同一 prefix 不能重复注册
   * （webserver 会把重复 route 当配置错误抛掉）。这里按搬过来的每条路径
   * 注册 exact 路由：匹配顺序是 exact 优先于 prefix，所以这些路径会先于
   * 主行 handler 命中，主行那边删掉同名端点后互不重叠。
   */
  const routeHandler = (path, methods) => async (req, res) => {
    try {
      const run = methods[req.method]
      if (typeof run !== 'function') {
        sendJson(res, 404, {
          ok: false,
          error: { code: 'not-found', message: `没有这个路由：${req.method} ${path}` },
        })
        return
      }
      await run(req, res)
    } catch (error) {
      log(`${req.method} ${path} 失败`, error)
      sendJson(res, 400, {
        ok: false,
        error: { code: 'bad-request', message: error?.message ?? String(error) },
      })
    }
  }

  const registerExact = (path, methods) => {
    return ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: `${ROUTE_PREFIX}${path}`, handler: routeHandler(path, methods) }),
      `${name}: ${path} route`,
    )
  }

  registerExact('/companion/memory', {
    GET: async (req, res) => {
      const items = await memoryStore.recall('', { limit: 50 })
      sendJson(res, 200, {
        ok: true,
        items: items.map((item) => ({
          id: item.id,
          slot: item.slot,
          text: item.text,
          pinned: item.pinned,
          mentions: item.mentions,
          lastAt: item.lastAt,
        })),
      })
    },
    POST: async (req, res) => {
      const body = await readJsonBody(req)
      const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 400) : ''
      if (text === '') throw new Error('记忆内容不能为空')
      const slot = ['identity', 'preference', 'event', 'relation'].includes(body?.slot)
        ? body.slot
        : 'event'
      const memory = await memoryStore.remember({ text, slot, source: 'manual' })
      notifyChanged()
      sendJson(res, 200, { ok: true, count: memory.items.length })
    },
  })

  registerExact('/companion/memory/pin', {
    POST: async (req, res) => {
      const body = await readJsonBody(req)
      const id = typeof body?.id === 'string' ? body.id.trim() : ''
      if (id === '') throw new Error('缺少要固定的记忆 id')
      const memory = await memoryStore.pin(id, body?.pinned !== false)
      notifyChanged()
      sendJson(res, 200, { ok: true, count: memory.items.length })
    },
  })

  registerExact('/companion/memory/forget', {
    POST: async (req, res) => {
      const body = await readJsonBody(req)
      const id = typeof body?.id === 'string' ? body.id.trim() : ''
      if (id === '') throw new Error('缺少要忘掉的记忆 id')
      const memory = await memoryStore.forget(id)
      notifyChanged()
      sendJson(res, 200, { ok: true, count: memory.items.length })
    },
  })

  /* 导出明文备份；导入时整份替换，仍走同一套清洗与容量限制 */
  registerExact('/companion/memory/export', {
    GET: async (req, res) => {
      await memoryStore.load()
      sendJson(res, 200, {
        ok: true,
        exportedAt: Date.now(),
        memory: memoryStore.snapshot(),
      })
    },
  })

  registerExact('/companion/memory/import', {
    POST: async (req, res) => {
      const body = await readJsonBody(req, 4 * 1024 * 1024)
      const payload = body?.memory ?? body
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
        throw new Error('备份里没有可用的记忆列表')
      }
      const memory = await memoryStore.replace(payload)
      notifyChanged()
      sendJson(res, 200, { ok: true, count: memory.items.length })
    },
  })
}
