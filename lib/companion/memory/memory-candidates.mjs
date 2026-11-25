/**
 * 记忆候选箱：弹性渠道（QQ 等）挑出来的记忆候选先在这里等人审核。
 *
 * 四态：
 * - candidate：进箱待审。候选箱不是提示词数据源，只有 factStore 才是，所以天然不进 prompt；
 * - active：审核通过，已由调用方写入 factStore；
 * - archived：改判时旧说法归档，留作审计；
 * - rejected：拒绝，留 reason 喂 lesson。
 *
 * 审核动作只改箱内状态，并返回条目给调用方做落库/写教训；
 * 本模块不依赖 factStore，保持纯数据层，便于测试。
 * 加密由外面注入（与 factStore 同一 vault），封不上就不写盘；读坏了按空箱继续，不挡聊天。
 */
import fs from 'node:fs/promises'
import { ENABLED_SLOT_IDS, normalizeSlotId } from './memory-slots.mjs'
import { MEMORY, TIME } from '../standard.mjs'

const STATUSES = new Set(['candidate', 'active', 'archived', 'rejected'])
const DEFAULT_MAX_CANDIDATES = MEMORY.candidateLimit
const DEFAULT_KEEP_DAYS = MEMORY.candidateKeepDays
const SAVE_DEBOUNCE_MS = MEMORY.saveDebounceMs
const MAX_TEXT = MEMORY.factTextLimit
const MAX_REASON = MEMORY.sourceTextLimit

function clampConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return MEMORY.candidateConfidence
  return Math.min(MEMORY.confidenceMax, Math.max(MEMORY.confidenceMin, number))
}

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT)
}

function cleanStatus(value) {
  return STATUSES.has(value) ? value : 'candidate'
}

function cleanScope(value) {
  if (typeof value !== 'string') return 'shared'
  const scope = value.trim().slice(0, MEMORY.scopeTextLimit)
  return scope === '' ? 'shared' : scope
}

/**
 * 一条记忆的身份：scope + slot + 正文。
 *
 * 记忆库用 `slot:text` 判重，候选箱以前用 `evidence + slot + scope`，
 * 同一句话换一种证据写法就会被当成新候选。这里统一成一个键，
 * 证据只用于回看，不参与「是不是同一件事」。
 */
export function memoryDedupeKey(item) {
  const scope = cleanScope(item?.scope)
  const slot = normalizeSlotId(item?.slot)
  const text = cleanText(item?.text)
  return `${scope}:${slot}:${text}`
}

/**
 * @param {object} options
 * @param {string} options.filePath
 * @param {(value: object) => Promise<object>} options.seal
 * @param {(sealed: object) => Promise<Uint8Array>} options.open
 * @param {() => number} [options.now]
 * @param {() => number} [options.getMaxCandidates]
 * @param {number} [options.keepDays] 候选超过多少天未审转 rejected
 * @param {(message: string, error?: unknown) => void} [options.log]
 */
/**
 * B2-004：load 的返回结果不能整体盖掉内存。
 *
 * 两个调用方都不等 load：index.js:2091 用 withTimeout(box.load(), 2000, null) 包着往下走，
 * companion-runtime.mjs:197 干脆 void candidates.load() 发射即忘。
 * 所以「load 还在飞、箱里已经被写了几笔」是常态路径。原来 `items = list...` 那行
 * 一执行，期间 add 进去的候选就静默消失了。
 *
 * 合并规则，按 id 与内容键两条判据走：
 *  - 盘上有、内存也有的同 id：以内存为准——内存里可能已经改判（approve/reject）或刷新过时间；
 *  - 盘上有、内存没有：照旧收进来，这是历史；
 *  - 内存有、盘上没有：in-flight 新增，保住；若只是内容同源（slot+text+scope）而 id 不同，
 *    不再补一条，避免跟盘上那条重复堆。
 * 末尾仍旧 sort + slice(-limit)，容量约束跟原来一样。
 */
function mergeWithInFlight(memoryItems, diskItems, limit) {
  const memoryById = new Map(memoryItems.map((item) => [item.id, item]))
  const diskIds = new Set(diskItems.map((item) => item.id))
  const diskKeys = new Set(diskItems.map((item) => memoryDedupeKey(item)))
  const fresh = memoryItems.filter(
    (item) => !diskIds.has(item.id) && !diskKeys.has(memoryDedupeKey(item)),
  )
  const merged = diskItems.map((item) => memoryById.get(item.id) ?? item).concat(fresh)
  return merged.sort((a, b) => a.at - b.at).slice(-limit)
}

export function createCandidateBox(options = {}) {
  const {
    filePath,
    seal,
    open,
    now = Date.now,
    getMaxCandidates = () => DEFAULT_MAX_CANDIDATES,
    keepDays = DEFAULT_KEEP_DAYS,
    log = () => {}
  } = options

  /** @type {Array<{id:string,slot:string,text:string,confidence:number,evidence:string,source:string,scope:string,at:number,status:string,reason:string,decidedAt:number}>} */
  let items = []
  let loaded = false
  let loading = null
  let saveTimer = null
  let writeChain = Promise.resolve(true)

  const available = typeof seal === 'function' && typeof open === 'function'

  function limit() {
    const value = Number(getMaxCandidates())
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_CANDIDATES
  }

  async function load() {
    if (loaded) return { ok: true, count: items.length }
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (!available) return { ok: false, reason: 'vault-unavailable' }
        let sealed = null
        try {
          sealed = JSON.parse(await fs.readFile(filePath, 'utf8'))
        } catch (error) {
          if (error?.code === 'ENOENT') return { ok: true, count: 0 }
          throw error
        }
        const plain = await open(sealed)
        const parsed = JSON.parse(new TextDecoder().decode(plain))
        const list = Array.isArray(parsed?.items) ? parsed.items : []
        const fromDisk = list
          .filter((item) => item !== null && typeof item === 'object')
          .map((item, index) => ({
            id: typeof item.id === 'string' && item.id !== '' ? item.id : `cand-${index}-${now()}`,
            slot: normalizeSlotId(item.slot),
            text: cleanText(item.text),
            confidence: clampConfidence(item.confidence),
            evidence: cleanText(item.evidence),
            source: typeof item.source === 'string' ? item.source.slice(0, MEMORY.sourceTextLimit) : '',
            scope: cleanScope(item.scope),
            at: Number(item.at) || now(),
            status: cleanStatus(item.status),
            reason: typeof item.reason === 'string' ? item.reason.slice(0, MAX_REASON) : '',
            decidedAt: Number(item.decidedAt) || 0
          }))
          .filter((item) => item.text !== '')
        /* 合并而不是覆盖：见 mergeWithInFlight 的注释——这条链以前直接赋给 items，
         * 会把 load 飞行期间 add 进来的候选整批抹掉。 */
        items = mergeWithInFlight(items, fromDisk, limit())
        return { ok: true, count: items.length }
      } catch (error) {
        log('候选箱读取失败，按空箱继续', error)
        /* 第二把同族的刀：读不到盘不等于箱该空。以前这里 items = []，
         * 配上面那个整体重赋值，迟到与失败两条路都能抹掉 in-flight 写入。
         * 现在保持内存不动，只如实报 ok:false。 */
        return { ok: false, reason: 'unreadable' }
      } finally {
        loaded = true
        loading = null
      }
    })()
    return loading
  }

  function scheduleSave() {
    if (!available || saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flush()
    }, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }

  async function flush() {
    if (!available) return false
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    writeChain = writeChain.then(async () => {
      try {
        const sealed = await seal({ version: 1, items })
        const temp = `${filePath}.tmp`
        await fs.mkdir(filePath.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
        await fs.writeFile(temp, JSON.stringify(sealed), 'utf8')
        await fs.rename(temp, filePath)
        return true
      } catch (error) {
        log('候选箱写入失败', error)
        return false
      }
    })
    return writeChain
  }

  /**
   * 新候选进箱。同 evidence+slot+scope 只留一条：
   * 已在箱内的取更高置信度并刷新时间，不重复堆。
   * @returns {{ added: number, duped: number }}
   */
  function add(list, options = {}) {
    const source = typeof options.source === 'string' ? options.source.slice(0, MEMORY.sourceTextLimit) : ''
    const scope = cleanScope(options.scope)
    const at = Number(options.at) || now()
    const incoming = Array.isArray(list) ? list : []
    let added = 0
    let duped = 0
    const touched = []
    for (const item of incoming) {
      const slot = normalizeSlotId(item?.slot)
      const text = cleanText(item?.text)
      if (text === '' || !ENABLED_SLOT_IDS.includes(slot)) continue
      const evidence = cleanText(item?.evidence)
      const confidence = clampConfidence(item?.confidence)
      const identity = memoryDedupeKey({ slot, text, scope })
      const existing = items.find(
        (entry) => entry.status === 'candidate' && memoryDedupeKey(entry) === identity,
      )
      if (existing !== undefined) {
        existing.confidence = Math.max(existing.confidence, confidence)
        existing.at = at
        touched.push(existing)
        duped += 1
        continue
      }
      const entry = {
        id: `cand-${at}-${items.length}`,
        slot,
        text,
        confidence,
        evidence,
        source,
        scope,
        at,
        status: 'candidate',
        reason: '',
        decidedAt: 0
      }
      items.push(entry)
      touched.push(entry)
      added += 1
    }
    /* C2-006：重复项也要触发落盘。上面 :226-227 就地抬了 confidence、刷了 at，
     * 两个都是要持久化的字段 —— at 还参与 mergeWithInFlight 的排序与 expire 的过期判定。
     * 只认 added 的话，「一批全是重复」这条常见路径一次都不落盘：
     * 同一句话被反复抽到时，盘上永远停在第一次的置信度与时间，重启也回不来。
     * scheduleSave 自带 debounce 与 saveTimer 去重（:171-178），多这一路不会多写一次盘。 */
    if (added > 0 || duped > 0) scheduleSave()
    return { added, duped, touched: touched.map((item) => ({ ...item })) }
  }

  /**
   * 抽取结果先统一进候选箱，再由这里决定哪些直接通过。
   *
   * 这是生产链路的唯一入口：低置信候选留在 candidate，不会绕过四态
   * 直接进提示词；只有 autoApprove 返回 true 的条目才转 active。
   *
   * @param {Array<object>} list
   * @param {{ source?: string, scope?: string, at?: number, autoApprove?: (item: object) => boolean }} [options]
   * @returns {{ added: number, duped: number, approved: Array<object>, pending: Array<object> }}
   */
  function ingest(list, options = {}) {
    const at = Number(options.at) || now()
    const autoApprove = typeof options.autoApprove === 'function' ? options.autoApprove : () => false
    const result = add(list, { ...options, at })
    const approved = []
    const pending = []
    const seen = new Set()
    for (const candidate of result.touched) {
      if (candidate.status !== 'candidate' || seen.has(candidate.id)) continue
      seen.add(candidate.id)
      let pass = false
      try {
        pass = autoApprove({ ...candidate }) === true
      } catch {
        pass = false
      }
      if (!pass) {
        pending.push({ ...candidate })
        continue
      }
      const decision = approve(candidate.id)
      if (decision.ok) approved.push(decision.item)
      else pending.push({ ...candidate })
    }
    return { added: result.added, duped: result.duped, approved, pending }
  }

  /** 待审候选，按时间倒序；传 scope 只看该范围。 */
  function list(scope = null) {    const owner = scope === null || scope === '' ? null : cleanScope(scope)
    return items
      .filter((item) => item.status === 'candidate' && (owner === null || item.scope === owner))
      .sort((a, b) => b.at - a.at)
      .map((item) => ({ ...item }))
  }

  /** 箱内统计，给观察台与反思用。 */
  function snapshot() {
    const byStatus = { candidate: 0, active: 0, archived: 0, rejected: 0 }
    for (const item of items) byStatus[item.status] += 1
    return { total: items.length, byStatus, pending: byStatus.candidate }
  }

  function findPending(id) {
    const item = items.find((entry) => entry.id === id && entry.status === 'candidate')
    return item === undefined ? null : item
  }

  /** 通过：箱内标 active，返回条目给调用方写入 factStore。 */
  function approve(id) {
    const item = findPending(id)
    if (item === null) return { ok: false, reason: 'not-found' }
    item.status = 'active'
    item.decidedAt = now()
    scheduleSave()
    return { ok: true, item: { ...item } }
  }

  /** 改判：旧说法归档、按新槽/新文案写 active，返回新条目与旧条目。 */
  function rejudge(id, patch = {}) {
    const old = findPending(id)
    if (old === null) return { ok: false, reason: 'not-found' }
    const slot = normalizeSlotId(patch?.slot)
    const text = cleanText(patch?.text)
    if (!ENABLED_SLOT_IDS.includes(slot) || text === '') {
      return { ok: false, reason: 'invalid-patch' }
    }
    old.status = 'archived'
    old.reason = 'rejudged'
    old.decidedAt = now()
    const next = {
      id: `cand-${now()}-${items.length}`,
      slot,
      text,
      confidence: old.confidence,
      evidence: old.evidence,
      source: old.source,
      scope: old.scope,
      at: old.at,
      status: 'active',
      reason: '',
      decidedAt: now()
    }
    items.push(next)
    scheduleSave()
    return { ok: true, item: { ...next }, previous: { ...old } }
  }

  /** 拒绝：箱内标 rejected 并留原因；同 reason 由调用方聚合写 lesson。 */
  function reject(id, reason = '') {
    const item = findPending(id)
    if (item === null) return { ok: false, reason: 'not-found' }
    item.status = 'rejected'
    item.reason = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON) || 'rejected' : 'rejected'
    item.decidedAt = now()
    scheduleSave()
    return { ok: true, item: { ...item } }
  }

  /** 超期清理：候选超过 keepDays 未审转 rejected，reason=expired。返回条数。 */
  function expire() {
    const at = now()
    const daysMs = Math.max(MEMORY.candidateKeepDaysMin, Number(keepDays) || DEFAULT_KEEP_DAYS) * TIME.DAY
    let count = 0
    for (const item of items) {
      if (item.status !== 'candidate') continue
      if (at - item.at < daysMs) continue
      item.status = 'rejected'
      item.reason = 'expired'
      item.decidedAt = at
      count += 1
    }
    if (count > 0) scheduleSave()
    return count
  }

  function reset() {
    items = []
    loaded = true
  }

  return { load, flush, add, ingest, list, snapshot, approve, rejudge, reject, expire, reset }
}
