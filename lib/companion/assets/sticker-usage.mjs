/**
 * 表情使用账本：记下每张图被发过几次，用来让「随手挑一张」不总挑到同一个。
 *
 * 设计约束：
 *   - 只存 id / 次数 / 最后使用时间，不存图片本身；
 *   - 文件路径、时钟、随机数都能注入，测试不碰真实磁盘；
 *   - 坏文件当成空账本，删掉重来也不会拖垮聊天。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_ENTRIES = 500
/** 这段时间里发过的图，权重降低，避免连着两张一样。 */
const COLD_WINDOW_MS = 10 * 60_000

export function createStickerUsage(options = {}) {
  const filePath = typeof options.filePath === 'string' ? options.filePath : ''
  const fsImpl = options.fsImpl ?? fs
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const random = typeof options.random === 'function' ? options.random : Math.random
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : DEFAULT_MAX_ENTRIES

  let items = Object.create(null)
  let loaded = false
  let loading = null
  let writing = null

  function prune() {
    const ids = Object.keys(items)
    if (ids.length <= maxEntries) return
    /* 次数最少、最久没用的先丢，常发的留着。 */
    ids
      .sort((a, b) => (items[a].count ?? 0) - (items[b].count ?? 0) || (items[a].at ?? 0) - (items[b].at ?? 0))
      .slice(0, ids.length - maxEntries)
      .forEach((id) => {
        delete items[id]
      })
  }

  async function save() {
    if (filePath === '') return
    const payload = JSON.stringify({ version: 1, items }, null, 2)
    if (writing !== null) await writing.catch(() => {})
    writing = (async () => {
      try {
        const temp = `${filePath}.tmp`
        /* 宿主第一次启动时数据目录可能还没建，自己补一下。 */
        if (typeof fsImpl.mkdir === 'function') await fsImpl.mkdir(path.dirname(filePath), { recursive: true })
        await fsImpl.writeFile(temp, payload, 'utf8')
        await fsImpl.rename(temp, filePath)
      } catch {
        /* 记账失败不影响发图 */
      }
    })()
    await writing
  }

  async function load() {
    if (loaded) return
    if (loading !== null) return loading
    loaded = true
    if (filePath === '') return
    loading = (async () => {
      try {
        const raw = await fsImpl.readFile(filePath, 'utf8')
        const parsed = JSON.parse(raw)
        const source = parsed?.items
        const disk = Object.create(null)
        if (source !== null && typeof source === 'object') {
          for (const [id, value] of Object.entries(source)) {
            if (typeof value?.count !== 'number' || typeof value?.at !== 'number') continue
            disk[id] = { count: value.count, at: value.at }
          }
        }
        /* 读到之前已经记下的（这轮刚发过的）优先，别被磁盘旧账盖掉。 */
        items = { ...disk, ...items }
        prune()
      } catch {
        /* 坏文件当成空账本 */
      }
    })()
    return loading
  }

  /** 发出去以后记一笔；内存立即生效，落盘异步。 */
  function record(id) {
    const key = String(id ?? '').trim()
    if (key === '') return
    const previous = items[key] ?? { count: 0, at: 0 }
    items[key] = { count: previous.count + 1, at: now() }
    prune()
    void save()
  }

  /** 加权随机：发得少的优先，刚发过的降权。 */
  function pick(list) {
    const candidates = Array.isArray(list) ? list.filter((item) => item !== null && typeof item?.id === 'string') : []
    if (candidates.length === 0) return null
    const t = now()
    const weights = candidates.map((item) => {
      const entry = items[item.id]
      const count = entry?.count ?? 0
      const lastAt = entry?.at ?? 0
      const fresh = lastAt > 0 && t - lastAt < COLD_WINDOW_MS ? 0.2 : 1
      return fresh / (1 + count)
    })
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    if (!(total > 0)) return candidates[Math.floor(random() * candidates.length)]
    let point = random() * total
    for (let index = 0; index < candidates.length; index += 1) {
      point -= weights[index]
      if (point <= 0) return candidates[index]
    }
    return candidates[candidates.length - 1]
  }

  function stats() {
    return Object.entries(items)
      .map(([id, entry]) => ({ id, count: entry.count, at: entry.at }))
      .sort((a, b) => b.count - a.count || a.at - b.at)
  }

  return { load, record, pick, stats }
}
