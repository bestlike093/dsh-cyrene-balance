/**
 * 记忆存储：把聊过的内容加密落盘，再按需装配成提示词片段。
 *
 * 设计上的几条底线：
 * - 只用注入的 seal / open，不自己实现加密；封不上就不写盘，绝不退回明文
 * - 写入走临时文件 + rename，断电不会留下半截密文
 * - 文件损坏时改名留证据，再从空记忆开始，不静默覆盖
 * - 落盘防抖，连续对话不会每句都写一次磁盘
 */

import { rankMemories } from './memory-search.mjs'
import { classifyMemory } from './social.mjs'

const DEFAULT_MAX_ITEMS = 500
const SAVE_DEBOUNCE_MS = 500
const MAX_TEXT_CHARS = 2_000
/** v1 没有 scope；v2 起带 scope；v3 起带 layer / cold / supersedes；v4 起带 recallCount / archived；v5 起带 pinned。 */
const SCHEMA_VERSION = 5
/** 四层：原文、片段、事实、经验。旧记录一律回落 raw。 */
const LAYERS = new Set(['raw', 'episode', 'fact', 'lesson'])
/** 只影响检索排序的半衰期；fact / lesson 是长期层，不随时间衰减。 */
const LAYER_HALF_LIFE_DAYS = { raw: 30, episode: 30, fact: Infinity, lesson: Infinity }
/** 多久没被碰过（写入或检索命中）算冷记忆。只降权，不删除。 */
const COLD_AFTER_DAYS = 90
/**
 * 冷了很久、又几乎没被想起来过的原文，会退到归档区。
 *
 * 归档不删内容：文件还在、管理页还能翻到，只是不再进入日常检索和提示词。
 * 事实与经验永远不归档——它们本来就是为了长期记住才写下来的。
 */
const ARCHIVE_AFTER_DAYS = 180
const ARCHIVE_RECALL_LIMIT = 1
const MAX_ARCHIVE_PER_SWEEP = 50

/**
 * 从来源推出 scope，和 chat.mjs 的 scopeOf 同一口径。
 *
 * 这里复制一份而不反向依赖 chat.mjs：存储层只需要知道「这条记录归谁」，
 * 不应该为了这个判断去加载聊天协议、提示词和网关判断。
 */
function scopeFromSource(source) {
  if (source === null || typeof source !== 'object') return 'desktop'
  if (typeof source.channel !== 'string' || source.channel === '') return 'desktop'
  if (source.channel !== 'qq') return 'desktop'
  const chatType = source.chatType === 'group' ? 'group' : 'private'
  const openId = typeof source.openId === 'string' ? source.openId.trim() : ''
  return openId === '' ? `qq:${chatType}` : `qq:${chatType}:${openId}`
}

function normalizeScope(scope, source) {
  const explicit = typeof scope === 'string' ? scope.trim() : ''
  return explicit !== '' ? explicit : scopeFromSource(source)
}

/**
 * 原文层的闸门只挡三类，不套用完整的 classifyMemory 判断。
 *
 * 完整规则会把「我今天好累，先睡了」这类临时状态也挡掉，那属于长期记忆
 * 该不该收的问题；原文层先只处理「不该被送进模型」的部分：凭据、
 * 角色扮演、纯寒暄。其余内容照旧入库，避免该记的没记。
 */
const BLOCKED_TURN_REASONS = new Set(['secret', 'roleplay', 'greeting'])

function clampText(text) {
  const value = typeof text === 'string' ? text : ''
  return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) : value
}

/**
 * @param {object} options
 * @param {string} options.filePath 密文文件路径
 * @param {(value: object) => Promise<object>} [options.seal]
 * @param {(sealed: object) => Promise<Uint8Array>} [options.open]
 * @param {number} [options.maxItems]
 * @param {(...args: unknown[]) => void} [options.log]
 */
export function createMemoryStore(options) {
  const { filePath, seal, open, log, maxItems = DEFAULT_MAX_ITEMS, getMaxItems } = options
  const fallbackLimit = Number.isFinite(maxItems) && maxItems > 0 ? Math.floor(maxItems) : DEFAULT_MAX_ITEMS

  /** 上限跟着设置走：用户把条数改小，下一次写入就按新值裁。 */
  function currentLimit() {
    const value = typeof getMaxItems === 'function' ? Number(getMaxItems()) : fallbackLimit
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallbackLimit
  }

  /**
   * 每个 scope 各自保留上限条数。
   *
   * 上限仍是用户设的那个数字，语义从「全表上限」变成「每个会话上限」：
   * 一个群刷屏时，桌面的记忆不会被挤掉。
   */
  function trimAllScopes() {
    const limit = currentLimit()
    const excess = new Map()
    for (const item of records) {
      excess.set(item.scope, (excess.get(item.scope) ?? 0) + 1)
    }
    for (const [scope, count] of excess) {
      if (count <= limit) excess.delete(scope)
      else excess.set(scope, count - limit)
    }
    if (excess.size === 0) return

    // 从前往后保留，过量的旧记录直接跳过；最新的必须留下。
    const kept = []
    for (const item of records) {
      const left = excess.get(item.scope) ?? 0
      if (left > 0) {
        excess.set(item.scope, left - 1)
        continue
      }
      kept.push(item)
    }
    records = kept
  }

  /** @type {{ id: string, role: 'user'|'assistant', text: string, at: string }[]} */
  let records = []
  let updatedAt = null
  let loaded = false
  let saveTimer = null
  /** 有未落盘的变更。 */
  let dirty = false
  /** 读进来的是旧结构；下次落盘时顺手升级到 v2，不额外写一次盘。 */
  let needsRewrite = false
  /** 写入串行链，flush 能等到队列里的最后一份。 */
  let writeChain = Promise.resolve(true)

  let available = typeof seal === 'function' && typeof open === 'function'

  /** 加密仓库装配失败时由上层调用：从此不写盘、不报告已持久化。 */
  function disable() {
    available = false
    records = []
    updatedAt = null
  }

  async function readSealed() {
    const { readFile } = await import('node:fs/promises')
    try {
      return JSON.parse(await readFile(filePath, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  /** 损坏文件改名保留证据；读不出来就当空记忆，不猜测内容。 */
  async function quarantine(error) {
    const fs = await import('node:fs/promises')
    const backup = `${filePath}.corrupt-${Date.now()}`
    try {
      await fs.rename(filePath, backup)
      log?.('记忆文件无法读取，已改名保留：', backup, String(error?.message ?? error))
    } catch (renameError) {
      log?.('记忆文件隔离失败：', String(renameError?.message ?? renameError))
    }
  }

  async function load() {
    if (!available) {
      loaded = true
      return { ok: false, reason: 'vault-unavailable' }
    }
    let sealed = null
    try {
      sealed = await readSealed()
    } catch (error) {
      await quarantine(error)
      loaded = true
      return { ok: false, reason: 'unreadable' }
    }
    if (sealed === null) {
      loaded = true
      return { ok: true, count: 0 }
    }

    try {
      const plain = await open(sealed)
      const parsed = JSON.parse(new TextDecoder().decode(plain))
      const version = Number(parsed?.version)
      const list = Array.isArray(parsed?.records) ? parsed.records : []
      records = list
        .filter(
          (item) =>
            item !== null &&
            typeof item === 'object' &&
            typeof item.text === 'string' &&
            (item.role === 'user' || item.role === 'assistant')
        )
        .map((item) => {
          const source =
            item.source !== null && typeof item.source === 'object' ? item.source : null
          // v1 记录没有 scope：按 source 就地补。没有 source 的旧记录归桌面，
          // 所以旧文件不需要单独跑迁移脚本，读一次就已经分好桶。
          const scope =
            typeof item.scope === 'string' && item.scope.trim() !== ''
              ? item.scope.trim()
              : scopeFromSource(source)
          return {
            id: String(item.id ?? ''),
            role: item.role,
            text: clampText(item.text),
            at: typeof item.at === 'string' ? item.at : '',
            ...(source !== null ? { source } : {}),
            scope,
            // v3 新字段：旧记录没有 layer，一律回落 raw。
            layer: LAYERS.has(item.layer) ? item.layer : 'raw',
            cold: item.cold === true,
            lastHitAt: Number.isFinite(Number(item.lastHitAt)) ? Number(item.lastHitAt) : 0,
            // v4 新字段：被检索起来的次数、是否已归档。旧记录按 0 / false 回落。
            recallCount: Math.max(0, Math.floor(Number(item.recallCount) || 0)),
            archived: item.archived === true,
            archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : '',
            // v5 新字段：用户手动钉住。钉住的条目不降温、不归档，检索时也排得更靠前。
            pinned: item.pinned === true,
            supersedes: Array.isArray(item.supersedes)
              ? item.supersedes.filter((id) => typeof id === 'string').slice(0, 10)
              : [],
            supersededBy:
              typeof item.supersededBy === 'string' ? item.supersededBy : ''
          }
        })
      trimAllScopes()
      // 没有版本号或版本更旧，都算待升级；只标记，不主动写盘。
      needsRewrite = !Number.isFinite(version) || version < SCHEMA_VERSION
      updatedAt = typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null
      loaded = true
      return { ok: true, count: records.length }
    } catch (error) {
      await quarantine(error)
      records = []
      updatedAt = null
      loaded = true
      return { ok: false, reason: 'undecryptable' }
    }
  }

  /**
   * 写入串行化：多次写入排成一条链，后一次一定看到前一次的结果。
   * 有未落盘变更（dirty）才真正写，避免空转。
   */
  function writeNow() {
    if (!available) return Promise.resolve(false)
    const task = writeChain.then(async () => {
      if (!dirty && !needsRewrite) return true
      const snapshot = { version: SCHEMA_VERSION, updatedAt, records: [...records] }
      dirty = false
      needsRewrite = false
      try {
        const fs = await import('node:fs/promises')
        const sealed = await seal(snapshot)
        await fs.mkdir(filePath.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
        const temp = `${filePath}.tmp`
        await fs.writeFile(temp, JSON.stringify(sealed), 'utf8')
        await fs.rename(temp, filePath)
        return true
      } catch (error) {
        log?.('记忆写入失败：', String(error?.message ?? error))
        dirty = true
        return false
      }
    })
    writeChain = task.catch(() => false)
    return task
  }

  function scheduleSave() {
    if (!available) return
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void writeNow()
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * 追加一轮对话。deviceId 之类的元信息不在这里存：
   * 记忆只需要「谁说的、说了什么、什么时候、归哪个会话」。
   * source 是可选的来源标记（QQ 私聊 / 群聊），用于重启后仍能分清是谁在说；
   * scope 由调用方显式传入，不传时按 source 推出来。
   */
  function appendTurn(
    role,
    text,
    at = new Date().toISOString(),
    source = null,
    scope = null,
    options = {}
  ) {
    if (!available) return false
    const value = clampText(text).trim()
    if (value === '') return false
    if (role !== 'user' && role !== 'assistant') return false
    // 用户输入先过原文层闸门：凭据、角色扮演、纯寒暄不进记忆，
    // 也就不可能被下一次对话带进提示词发给模型。
    // 「别记这个 / 把刚才那个忘掉」是删除指令：先删掉上一轮，再拒绝本次写入。
    if (role === 'user') {
      const verdict = classifyMemory(value, { minLength: 0 })
      if (verdict.reason === 'explicit_forget') {
        forgetLatest(normalizeScope(scope, source))
        return false
      }
      if (BLOCKED_TURN_REASONS.has(verdict.reason)) return false
    }

    records.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text: value,
      at,
      ...(source !== null && typeof source === 'object' ? { source } : {}),
      scope: normalizeScope(scope, source),
      // 日常对话默认进原文层；调用方可以显式指定 episode / fact / lesson。
      layer: LAYERS.has(options.layer) ? options.layer : 'raw',
      cold: false,
      lastHitAt: 0,
      recallCount: 0,
      archived: false,
      archivedAt: '',
      pinned: options.pinned === true,
      supersedes: [],
      supersededBy: ''
    })
    trimAllScopes()
    updatedAt = at
    dirty = true
    scheduleSave()
    return true
  }

  /**
   * 把长期没碰过的原文和片段标成冷记忆。
   * 「碰过」包括写入时间和最近一次被检索命中的时间；只改标记，不删内容。
   */
  function refreshCold(now = Date.now()) {
    const at = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    const cutoff = at - COLD_AFTER_DAYS * 24 * 60 * 60 * 1000
    let changed = false
    for (const item of records) {
      if (item.cold) continue
      // 用户钉住的不降温，也不该被当成「很久没想起」。
      if (item.pinned === true) continue
      // 事实和经验不降温，它们本来就是长期层。
      if (item.layer === 'fact' || item.layer === 'lesson') continue
      const stamp = Date.parse(item.at)
      const lastHit = Number.isFinite(Number(item.lastHitAt)) ? Number(item.lastHitAt) : 0
      const touchedAt = Math.max(Number.isFinite(stamp) ? stamp : 0, lastHit)
      if (touchedAt > 0 && touchedAt < cutoff) {
        item.cold = true
        changed = true
      }
    }
    if (changed) {
      dirty = true
      scheduleSave()
    }
    return changed
  }

  /** 手动标记冷暖。观察台用它把某条原文挪进/挪出冷区。 */
  function setCold(id, cold) {
    const key = typeof id === 'string' ? id.trim() : ''
    const item = records.find((entry) => entry.id === key)
    if (item === undefined) return { ok: false, reason: 'not-found' }
    item.cold = cold === true
    dirty = true
    scheduleSave()
    return { ok: true, id: key, cold: item.cold }
  }

  /**
   * 主动遗忘：把冷了很久、又几乎没被想起来的原文挪进归档区。
   *
   * 只处理 raw / episode，事实和经验不动；一次最多归档 50 条，
   * 免得长时间没开后第一次扫描把整份记忆一次扫空。归档可手动取回。
   */
  function sweep(now = Date.now(), options = {}) {
    const at = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    refreshCold(at)
    const afterDays = Number(options?.afterDays)
    const days = Number.isFinite(afterDays) && afterDays > 0 ? afterDays : ARCHIVE_AFTER_DAYS
    const cutoff = at - days * 86_400_000
    const limit = Number.isFinite(Number(options?.limit))
      ? Math.max(1, Math.floor(Number(options.limit)))
      : MAX_ARCHIVE_PER_SWEEP

    const archived = []
    for (const item of records) {
      if (archived.length >= limit) break
      if (item.archived) continue
      // 钉住的是「她请我记住」的事，再怎么久都不自动归档。
      if (item.pinned === true) continue
      if (item.layer !== 'raw' && item.layer !== 'episode') continue
      if (item.supersededBy !== '') continue
      if ((Number(item.recallCount) || 0) > ARCHIVE_RECALL_LIMIT) continue
      const stamp = Date.parse(item.at)
      const lastHit = Number.isFinite(Number(item.lastHitAt)) ? Number(item.lastHitAt) : 0
      const touchedAt = Math.max(Number.isFinite(stamp) ? stamp : 0, lastHit)
      if (touchedAt === 0 || touchedAt >= cutoff) continue
      item.archived = true
      item.archivedAt = new Date(at).toISOString()
      archived.push(item.id)
    }

    if (archived.length > 0) {
      updatedAt = new Date(at).toISOString()
      dirty = true
      scheduleSave()
    }
    return { archived: archived.length, ids: archived }
  }

  /** 手动归档 / 取回。观察台和「想想这个」都用得到。 */
  function setArchived(id, archived) {
    const key = typeof id === 'string' ? id.trim() : ''
    const item = records.find((entry) => entry.id === key)
    if (item === undefined) return { ok: false, reason: 'not-found' }
    const next = archived === true
    item.archived = next
    item.archivedAt = next ? new Date().toISOString() : ''
    dirty = true
    scheduleSave()
    return { ok: true, id: key, archived: next }
  }


  /**
   * 钉子：用户亲手把一条记忆锁住。
   *
   * 钉住的条目不再变冷、不会被自动归档，检索时也享受「不衰减 + 轻微加权」；
   * 取消钉子后回到普通条目，下一次 refreshCold / sweep 会按原规则处理。
   */
  function setPinned(id, pinned) {
    const key = typeof id === 'string' ? id.trim() : ''
    const item = records.find((entry) => entry.id === key)
    if (item === undefined) return { ok: false, reason: 'not-found' }
    const next = pinned === true
    item.pinned = next
    // 钉住时顺手解冻：用户显然希望它回到日常检索里。
    if (next) {
      item.cold = false
      item.archived = false
      item.archivedAt = ''
    }
    dirty = true
    scheduleSave()
    return { ok: true, id: key, pinned: next }
  }


  /**
   * 记住一件新事实，并顺手处理被它取代的旧事实。
   *
   * 旧记录留在磁盘上，只是默认检索不再返回：用户想翻旧账时还能看见，
   * 平时不会被「过时的她」影响判断。
   * `about` 是关键词，命中旧事实文本就取代；`supersedes` 直接指定 id。
   */
  function rememberFact(options = {}) {
    if (!available) return { ok: false, reason: 'vault-unavailable', id: '', superseded: [] }
    const text = clampText(typeof options.text === 'string' ? options.text : '').trim()
    if (text === '') return { ok: false, reason: 'empty', id: '', superseded: [] }

    const scope = normalizeScope(options.scope, options.source ?? null)
    const at = typeof options.at === 'string' ? options.at : new Date().toISOString()
    const id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const wanted = new Set(
      Array.isArray(options.supersedes) ? options.supersedes.filter((key) => typeof key === 'string') : []
    )
    const keywords = Array.isArray(options.about)
      ? options.about.filter((word) => typeof word === 'string' && word.trim() !== '')
      : []

    const superseded = []
    for (const item of records) {
      if (item.scope !== scope || item.layer !== 'fact' || item.supersededBy !== '') continue
      const hitById = wanted.has(item.id)
      const hitByWord = keywords.length > 0 && keywords.some((word) => item.text.includes(word))
      if (!hitById && !hitByWord) continue
      item.supersededBy = id
      superseded.push(item.id)
    }

    records.push({
      id,
      role: 'user',
      text,
      at,
      scope,
      layer: 'fact',
      cold: false,
      lastHitAt: 0,
      recallCount: 0,
      archived: false,
      archivedAt: '',
      pinned: options.pinned === true,
      supersedes: superseded,
      supersededBy: ''
    })
    trimAllScopes()
    updatedAt = at
    dirty = true
    scheduleSave()
    return { ok: true, id, superseded }
  }

  /**
   * 最近若干条。给了 scope 就只在那一个会话里取；
   * 不传保持全局视图，管理页和统计仍然能看到整份记忆。
   */
  function recent(count = 8, scope = null) {
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 8
    const visible =
      typeof scope === 'string' && scope !== ''
        ? records.filter((item) => item.scope === scope)
        : records
    return visible.slice(-n).map((item) => ({ ...item }))
  }

  /**
   * 装配成提示词里的一段。没有记忆时返回空串，调用方据此不加这一段。
   */
  function digestText(count = 6, scope = null) {
    const items = recent(count, scope)
    if (items.length === 0) return ''
    const lines = items.map((item) => `${item.role === 'user' ? '用户' : '你'}：${item.text}`)
    return lines.join('\n')
  }

  /**
   * 按相关度找旧事。
   *
   * 和 recent 的分工：recent 回答「刚才聊了什么」，search 回答「以前说过的那件事」。
   * 候选集限定在同一个 scope，群里的记忆不会跑到桌面上来。
   *
   * `vectorScores` 是留给向量检索的口子：传一个 id → 0..1 的 Map，
   * 这里会和 BM25 分混合；不传就纯本地打分，不额外请求任何接口。
   */
  function search(query, options = {}) {
    const at = Number.isFinite(Number(options?.now)) ? Number(options.now) : Date.now()
    refreshCold(at)
    const scope =
      typeof options?.scope === 'string' && options.scope !== '' ? options.scope : null
    const includeCold = options?.includeCold === true
    const includeSuperseded = options?.includeSuperseded === true
    const includeArchived = options?.includeArchived === true
    // 默认把过期事实、冷记忆和已归档的旧事挡在候选集外：
    // 它们还在磁盘上，只是不参与这次回答。
    const visible = (scope === null ? records : records.filter((item) => item.scope === scope)).filter(
      (item) =>
        (includeSuperseded || item.supersededBy === '') &&
        (includeCold || !item.cold) &&
        (includeArchived || !item.archived)
    )
    const rawLimit = Number(options?.limit)
    const hits = rankMemories(query, visible, {
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
      now: at,
      vectorScores: options?.vectorScores ?? null,
      vectorWeight: options?.vectorWeight,
      // 分层半衰期：事实 / 经验不随时间衰减。
      halfLifeFor: (item) => LAYER_HALF_LIFE_DAYS[item?.layer] ?? LAYER_HALF_LIFE_DAYS.raw
    })
    // 被检索到就算又用上了一次：记下最近命中时间，冷记忆顺手解冻。
    // recallCount 每分钟最多加一，避免同一轮里多次检索把分数刷高。
    let touched = false
    for (const hit of hits) {
      const item = records.find((entry) => entry.id === hit.id)
      if (item === undefined) continue
      if (item.cold) {
        item.cold = false
        touched = true
      }
      // 明确把归档记忆翻出来看过，就等于重新想起来了：解冻归档。
      if (item.archived) {
        item.archived = false
        item.archivedAt = ''
        touched = true
      }
      if (item.lastHitAt !== at && at - item.lastHitAt >= 60_000) {
        item.recallCount = Math.max(0, Number(item.recallCount) || 0) + 1
      }
      if (item.lastHitAt !== at) {
        item.lastHitAt = at
        touched = true
      }
    }
    if (touched) {
      dirty = true
      scheduleSave()
    }
    return hits
  }

  /**
   * 分页读取，最新在前。offset / limit 都做上限保护：
   * 渲染侧传什么都不会一次把整份记忆抽走。
   * 传 scope 时只返回那个会话的记录，total 也按筛选后的数量算。
   */
  function list(options = {}) {
    refreshCold()
    const scope = typeof options?.scope === 'string' && options.scope !== '' ? options.scope : null
    const layer = LAYERS.has(options?.layer) ? options.layer : null
    const includeCold = options?.includeCold !== false
    const includeArchived = options?.includeArchived !== false
    // 管理页默认能看到冷记忆、归档和过期事实：用户翻记录时不该被悄悄藏掉。
    const visible = records.filter(
      (item) =>
        (scope === null || item.scope === scope) &&
        (layer === null || item.layer === layer) &&
        (includeCold || !item.cold) &&
        (includeArchived || !item.archived)
    )
    const total = visible.length
    const rawOffset = Number(options?.offset)
    const rawLimit = Number(options?.limit)
    const offset = Number.isFinite(rawOffset) ? Math.min(Math.max(Math.floor(rawOffset), 0), total) : 0
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 50
    const ordered = visible.slice().reverse()
    return {
      total,
      offset,
      limit,
      items: ordered.slice(offset, offset + limit).map((item) => ({ ...item }))
    }
  }

  /**
   * 忘掉最近一轮：从当前 scope 的最后一条 user 起，删到末尾。
   * 只动这个 scope，别的群或桌面的记忆不受影响。
   */
  function forgetLatest(scope = 'desktop') {
    const target = typeof scope === 'string' && scope !== '' ? scope : 'desktop'
    if (!available) return { ok: false, reason: 'vault-unavailable', removed: 0 }
    let start = -1
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const item = records[index]
      if (item !== undefined && item.scope === target && item.role === 'user') {
        start = index
        break
      }
    }
    if (start === -1) return { ok: false, reason: 'not-found', removed: 0 }

    const kept = []
    let removed = 0
    for (let index = 0; index < records.length; index += 1) {
      const item = records[index]
      if (item === undefined) continue
      if (index >= start && item.scope === target) {
        removed += 1
        continue
      }
      kept.push(item)
    }
    records = kept
    updatedAt = new Date().toISOString()
    dirty = true
    void writeNow()
    return { ok: true, removed }
  }

  /** 删除单条。删完立刻落盘，不留在防抖窗口里。 */
  function remove(id) {
    if (!available) return { ok: false, reason: 'vault-unavailable', removed: false, total: records.length }
    const key = typeof id === 'string' ? id.trim() : ''
    if (key === '') return { ok: false, reason: 'bad-id', removed: false, total: records.length }
    const index = records.findIndex((item) => item.id === key)
    if (index === -1) return { ok: false, reason: 'not-found', removed: false, total: records.length }

    const [removed] = records.splice(index, 1)
    updatedAt = new Date().toISOString()
    dirty = true
    void writeNow()
    return { ok: true, removed: true, total: records.length, item: { ...removed } }
  }

  /**
   * 清空记录：先把空快照落盘，成功后才清内存。
   * 失败时恢复原数组并把错误冒泡给调用方，避免「内存已空、磁盘还在」。
   * 并发调用复用同一个任务，只写一次盘。
   */
  let clearTask = null
  function clear() {
    if (clearTask !== null) return clearTask
    clearTask = (async () => {
      if (!available) return { ok: false, reason: 'vault-unavailable' }

      const savedRecords = records
      const savedUpdatedAt = updatedAt
      records = []
      updatedAt = new Date().toISOString()
      dirty = true

      const ok = await writeNow()
      if (!ok) {
        // 落盘失败：内存恢复原数组，dirty 由 writeNow 保持 true，下次可重试。
        records = savedRecords
        updatedAt = savedUpdatedAt
        return { ok: false, reason: 'persist-failed' }
      }
      return { ok: true }
    })().finally(() => {
      clearTask = null
    })
    return clearTask
  }

  function stats() {
    refreshCold()
    const scopes = {}
    const layers = { raw: 0, episode: 0, fact: 0, lesson: 0 }
    let cold = 0
    let archived = 0
    let pinned = 0
    for (const item of records) {
      scopes[item.scope] = (scopes[item.scope] ?? 0) + 1
      layers[item.layer] = (layers[item.layer] ?? 0) + 1
      if (item.cold) cold += 1
      if (item.archived) archived += 1
      if (item.pinned === true) pinned += 1
    }
    return {
      available,
      persisted: available && updatedAt !== null,
      count: records.length,
      limit: currentLimit(),
      updatedAt,
      loaded,
      scopes,
      layers,
      cold,
      archived,
      pinned
    }
  }

  async function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    // 等队列清空；如果等完之后又产生新变更，再补写一次。
    await writeChain
    if (!dirty && !needsRewrite) return true
    return await writeNow()
  }

  return {
    load,
    appendTurn,
    rememberFact,
    refreshCold,
    setCold,
    setPinned,
    sweep,
    setArchived,
    recent,
    search,
    list,
    remove,
    forgetLatest,
    digestText,
    clear,
    stats,
    flush,
    disable
  }
}
