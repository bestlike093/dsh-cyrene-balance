/**
 * 最近改动（settings history）。
 *
 * 设置页「改坏了能退」的后半截：每项右边有 ↺ 恢复默认，这里再留一份
 * 「最近 10 次写入」，能按条回退。整份导出能救大灾难，单条回退救的
 * 是被顺手改坏的那一下，日常更常用。
 *
 * 只记设置总表里登记过的字段（FIELDS），秘密路径一律不记也不回写，
 * 免得把 API Key、同步令牌写进一份明文历史里。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { FIELDS, readPath } from './settings-schema.mjs'

const MAX_ITEMS = 10

/* 这些路径不进历史：写了等于把秘密复制到第二个文件里。 */
const SECRET_PATHS = new Set(['apiKey', 'syncToken', 'qq.appSecret', 'ttsRefAudio'])

function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** 对比前后两份 state，只保留总表登记过的差异。 */
export function diffState(before, after) {
  const changes = []
  for (const field of FIELDS) {
    if (SECRET_PATHS.has(field.key)) continue
    const from = readPath(before, field.key)
    const to = readPath(after, field.key)
    if (same(from, to)) continue
    changes.push({
      path: field.key,
      label: field.label,
      before: from === undefined ? null : from,
      after: to === undefined ? null : to,
    })
  }
  return changes
}

export function createChangeLog({ filePath }) {
  let items = []
  let loaded = false
  let seq = 0
  let chain = Promise.resolve()

  async function load() {
    if (loaded) return
    loaded = true
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'))
      const list = Array.isArray(parsed?.items) ? parsed.items : []
      items = list
        .filter((item) => item !== null && typeof item === 'object' && Array.isArray(item.changes))
        .slice(0, MAX_ITEMS)
    } catch {
      items = []
    }
  }

  function save() {
    const snapshot = `${JSON.stringify({ version: 1, items }, null, 2)}\n`
    chain = chain.then(async () => {
      await mkdir(dirname(filePath), { recursive: true })
      const temp = `${filePath}.tmp`
      await writeFile(temp, snapshot, 'utf8')
      await rename(temp, filePath)
    })
    return chain
  }

  /**
   * 记一条。source 说明是谁改的：settings（网页/桌宠写回）、reset（恢复默认）、
   * undo（回退）。没有差异就不记，避免点一下没变化也占一格。
   */
  async function record(before, after, source) {
    await load()
    const changes = diffState(before, after)
    if (changes.length === 0) return null
    seq += 1
    const item = {
      id: `${Date.now().toString(36)}-${seq.toString(36)}`,
      at: new Date().toISOString(),
      source: String(source ?? 'settings'),
      changes,
    }
    items = [item, ...items].slice(0, MAX_ITEMS)
    await save()
    return item
  }

  /** 读：最新的在前。 */
  async function list() {
    await load()
    return items.slice()
  }

  /**
   * 回退一条：返回要写回的 path/value 列表，真正的合并由调用方做。
   * 找不到返回 null；已经回退过的条目允许再读一次（幂等）。
   */
  async function undo(id) {
    await load()
    const item = items.find((entry) => entry.id === id) ?? null
    if (item === null) return null
    const patch = item.changes
      .filter((change) => !SECRET_PATHS.has(change.path))
      .map((change) => ({ path: change.path, value: change.before }))
    return { item, patch }
  }

  return { load, list, record, undo }
}
