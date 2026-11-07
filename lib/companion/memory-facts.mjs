/**
 * 结构化记忆：把「聊过什么」整理成能反复用的事实，而不是一堆原文。
 *
 * 借鉴 LivingMemory 的地方：
 * - 事实分四类：偏好、人物、项目、约定；
 * - 每条有自己的强度，被再次提到会变强；
 * - 久不被想起会慢慢变弱，弱到一定程度就归档，不删除；
 * - 召回时看「有多重要 + 有多新 + 和这句话像不像」，而不是只取最近几条。
 *
 * 加密由外面注入，封不上就不写盘；读坏了就当空记忆，不挡聊天。
 */
import fs from 'node:fs/promises'

const KINDS = new Set(['preference', 'person', 'project', 'promise', 'lesson'])
/**
 * 一条记忆可以被提起的场合：
 * - free：随时可以直说；
 * - soft_echo：可以借着语气带一点，但别把内容摊开（「你上次提过的那件事…」就够）；
 * - on_request：对方问起再说；
 * - never：不主动提，也不在别人面前提。
 */
const MENTION_POLICIES = new Set(['free', 'soft_echo', 'on_request', 'never'])
const MENTION_RANK = { free: 0, soft_echo: 1, on_request: 2, never: 3 }
const MAX_TEXT = 160
const DEFAULT_MAX_FACTS = 200
const DEFAULT_ARCHIVE_DAYS = 45
const SAVE_DEBOUNCE_MS = 800

const KIND_LABEL = {
  lesson: '对方纠正过你的（不要重犯）',
  preference: '你的偏好',
  person: '你身边的人',
  project: '你正在做的事',
  promise: '你们说好的事'
}

const KIND_WEIGHT = {
  lesson: 0.8,
  promise: 0.6,
  project: 0.5,
  person: 0.4,
  preference: 0.3
}

const DEFAULT_SCOPE = 'desktop'
/** 跨渠道的共同记忆：桌面和 QQ 都能读到。 */
const SHARED_SCOPE = 'shared'

/**
 * 被否认时的降级顺序：从「随时可提」一路退到「不再主动提」。
 *
 * 一次否认只退一格，避免对方一句「不是吧」就把整条记忆永久封存；
 * 连着被否认才会走到 never，那时候确实不该再自己翻出来了。
 */
const MENTION_DEMOTE = ['free', 'soft_echo', 'on_request', 'never']

function cleanScope(value) {
  if (typeof value !== 'string') return DEFAULT_SCOPE
  const scope = value.trim().slice(0, 120)
  return scope === '' ? DEFAULT_SCOPE : scope
}

/** 中文没有空格，用相邻两字片段做得很轻的相似度判断。 */
function bigrams(text) {
  const value = String(text ?? '').replace(/\s+/g, '')
  const result = new Set()
  for (let i = 0; i < value.length - 1; i += 1) result.add(value.slice(i, i + 2))
  return result
}

function similarity(a, b) {
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let hit = 0
  for (const item of left) if (right.has(item)) hit += 1
  return hit / Math.max(left.size, right.size)
}

function clampStrength(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(3, Math.max(0, number))
}

/** 抽取置信度：模型没给时按 0.7 起步，宁可信一半也不当成事实。 */
function clampConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.7
  return Math.min(1, Math.max(0, number))
}

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT)
}

function cleanMention(value) {
  return MENTION_POLICIES.has(value) ? value : 'free'
}

/**
 * 这条记忆此刻能不能进提示词。
 *
 * 群里人多眼杂：只有明确允许「随时可提」的才带进去；
 * 私聊仍然保留「被问到再说」的条目，只是分组时会提醒别主动开口。
 */
function mentionable(fact, context) {
  const policy = cleanMention(fact.mentionPolicy)
  if (policy === 'never') return false
  if (context === 'group') return policy === 'free'
  return true
}

/**
 * @param {object} options
 * @param {string} options.filePath
 * @param {(value: object) => Promise<object>} options.seal
 * @param {(sealed: object) => Promise<Uint8Array>} options.open
 * @param {() => number} [options.now]
 * @param {() => number} [options.getMaxFacts]
 * @param {(message: string, error?: unknown) => void} [options.log]
 */
export function createFactStore(options = {}) {
  const {
    filePath,
    seal,
    open,
    now = Date.now,
    getMaxFacts = () => DEFAULT_MAX_FACTS,
    log = () => {}
  } = options

  /** @type {{id:string,kind:string,text:string,strength:number,createdAt:number,lastSeenAt:number,lastAccessedAt:number,archived:boolean,source:string,confidence:number,scope:string}[]} */
  let facts = []
  let loaded = false
  let loading = null
  let saveTimer = null
  let writeChain = Promise.resolve(true)
  /**
   * 最近一轮真正进了提示词的记忆。
   *
   * 只留在内存里：它的用途是「对方下一句否认时，知道该把哪条往后退」，
   * 重启后没有上下文可谈，留着反而会误伤不相干的事。
   */
  let surfaced = []

  const available = typeof seal === 'function' && typeof open === 'function'

  function limit() {
    const value = Number(getMaxFacts())
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_FACTS
  }

  async function load() {
    if (loaded) return { ok: true, count: facts.length }
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
        const list = Array.isArray(parsed?.facts) ? parsed.facts : []
        facts = list
          .filter((item) => item !== null && typeof item === 'object')
          .map((item, index) => ({
            id: typeof item.id === 'string' && item.id !== '' ? item.id : `fact-${index}-${now()}`,
            kind: KINDS.has(item.kind) ? item.kind : 'preference',
            text: cleanText(item.text),
            strength: clampStrength(item.strength),
            createdAt: Number(item.createdAt) || now(),
            lastSeenAt: Number(item.lastSeenAt) || now(),
            lastAccessedAt: Number(item.lastAccessedAt) || 0,
            archived: item.archived === true,
            // 旧数据没有来源与置信度：按「来自桌面、七成可信」补，不把历史直接丢掉。
            source: typeof item.source === 'string' ? item.source.slice(0, 80) : '',
            confidence: clampConfidence(item.confidence),
            // 旧数据没有 scope：默认归到桌面这一份，不丢。
            scope: cleanScope(item.scope),
            // 旧数据没有提及策略：按「随时可提」补，行为与以前一致。
            mentionPolicy: cleanMention(item.mentionPolicy),
            // 以下几项是「断言」信息：什么时候开始成立、是否已经失效、当时有没有原话作证。
            // 旧数据一律补默认值——0 表示时间不详，空串表示没留下证据，都不改变旧条目的行为。
            validFrom: Number(item.validFrom) || 0,
            validTo: Number(item.validTo) || 0,
            evidence: cleanText(item.evidence)
          }))
          .filter((item) => item.text !== '')
          .slice(-limit())
        return { ok: true, count: facts.length }
      } catch (error) {
        log('结构化记忆读取失败，按空记忆继续', error)
        facts = []
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
        const sealed = await seal({ version: 1, facts })
        const temp = `${filePath}.tmp`
        await fs.mkdir(filePath.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
        await fs.writeFile(temp, JSON.stringify(sealed), 'utf8')
        await fs.rename(temp, filePath)
        return true
      } catch (error) {
        log('结构化记忆写入失败', error)
        return false
      }
    })
    return writeChain
  }

  /** 一组新事实并进来：同类的相似条目合并，反复出现的会变强。 */
  function upsert(list, at = now(), scope = DEFAULT_SCOPE) {
    const owner = cleanScope(scope)
    const incoming = Array.isArray(list) ? list : []
    let added = 0
    let reinforced = 0
    let superseded = 0
    for (const item of incoming) {
      const kind = KINDS.has(item?.kind) ? item.kind : 'preference'
      const text = cleanText(item?.text)
      if (text === '') continue
      const confidence = clampConfidence(item?.confidence)
      const source = typeof item?.source === 'string' ? item.source.slice(0, 80) : ''
      const mentionPolicy = cleanMention(item?.mentionPolicy)
      // 断言的时间边界与原话证据：没有就留 0 / 空，不强行编一个。
      const validFrom = Number(item?.validFrom) || 0
      const validTo = Number(item?.validTo) || 0
      const evidence = cleanText(item?.evidence)
      // 改口：模型明确抄回了被推翻的旧说法，就先归档旧条目。
      // 只认同作用域、且相似度够高的那一条，避免一句「现在换工作了」顺手抹掉别的项目。
      const supersedes = cleanText(item?.supersedes)
      if (supersedes !== '') {
        for (const fact of facts) {
          if (fact.archived || fact.scope !== owner) continue
          if (similarity(fact.text, supersedes) < 0.5) continue
          fact.archived = true
          fact.lastSeenAt = at
          superseded += 1
        }
      }
      // 只在同一个作用域里合并，桌面的偏好不会和 QQ 的混成一条。
      const existing = facts.find(
        (fact) =>
          fact.archived === false &&
          fact.kind === kind &&
          fact.scope === owner &&
          similarity(fact.text, text) >= 0.55
      )
      if (existing !== undefined) {
        existing.strength = clampStrength(existing.strength + 0.6)
        existing.lastSeenAt = at
        // 同一件事被再次确认时，取更高的置信度；来源只补空，不覆盖第一次的出处。
        existing.confidence = Math.max(clampConfidence(existing.confidence), confidence)
        if (existing.source === '' && source !== '') existing.source = source
        // 时间边界与证据只补空：第一次记下的那份更接近当时的原话，不被后来的转述盖掉。
        if (existing.validFrom === 0 && validFrom > 0) existing.validFrom = validFrom
        if (existing.validTo === 0 && validTo > 0) existing.validTo = validTo
        if (existing.evidence === '' && evidence !== '') existing.evidence = evidence
        // 提及策略只往更严的方向走：说过「别在人前提」，就不能被下一次默认覆盖回去。
        if ((MENTION_RANK[mentionPolicy] ?? 0) > (MENTION_RANK[cleanMention(existing.mentionPolicy)] ?? 0)) {
          existing.mentionPolicy = mentionPolicy
        }
        reinforced += 1
      } else {
        facts.push({
          id: `fact-${at}-${facts.length}`,
          kind,
          text,
          strength: 1,
          createdAt: at,
          lastSeenAt: at,
          lastAccessedAt: 0,
          archived: false,
          source,
          confidence,
          scope: owner,
          mentionPolicy,
          validFrom,
          validTo,
          evidence
        })
        added += 1
      }
    }
    if (added + reinforced + superseded > 0) {
      decay(at)
      trim()
      scheduleSave()
    }
    return { added, reinforced, superseded }
  }

  /** 时间会让记忆变淡；淡到几乎想不起来的，收进归档区。 */
  function decay(at = now()) {
    for (const fact of facts) {
      if (fact.archived) continue
      const days = Math.max(0, (at - fact.lastSeenAt) / 86_400_000)
      const lowConfidence = clampConfidence(fact.confidence) < 0.5
      // 每天淡 0.02：五十天左右从满格淡到 0，期间被提起会重新变强。
      // 低置信度的猜测淡得更快，一个月没再被确认就归档，不让它长期占着提示词。
      fact.strength = clampStrength(fact.strength - days * (lowConfidence ? 0.05 : 0.02))
      if (days >= 30 && lowConfidence && fact.strength < 0.35) fact.archived = true
      else if (days >= DEFAULT_ARCHIVE_DAYS && fact.strength < 0.3) fact.archived = true
    }
  }

  function trim() {
    const cap = limit()
    if (facts.length <= cap) return
    // 先丢归档里最弱的，再丢活跃里最弱的。
    facts.sort((a, b) => Number(a.archived) - Number(b.archived) || a.strength - b.strength)
    facts = facts.slice(facts.length - cap)
  }

  /**
   * 召回：重要 + 新鲜 + 和当前这句话相关，三者一起算。
   * 只取当前作用域，外加 shared 层的共同记忆。
   */
  function rank(query = '', count = 8, at = now(), scope = DEFAULT_SCOPE, context = 'private') {
    const owner = cleanScope(scope)
    decay(at)
    const q = String(query ?? '')
    const scored = facts
      .filter((fact) => !fact.archived)
      .filter((fact) => fact.scope === owner || fact.scope === SHARED_SCOPE)
      .filter((fact) => mentionable(fact, context))
      .map((fact) => {
        const days = Math.max(0, (at - fact.lastSeenAt) / 86_400_000)
        const recency = Math.max(0, 1.5 - days / 30)
        const related = q === '' ? 0 : similarity(q, fact.text) * 2.4
        const accessed = fact.lastAccessedAt > 0 ? 0.2 : 0
        // 低置信度的猜测默认往后排，避免它挤掉更确定的记忆。
        const doubt = clampConfidence(fact.confidence) < 0.5 ? 0.6 : 0
        return {
          fact,
          score:
            fact.strength * 2 +
            recency +
            related +
            (KIND_WEIGHT[fact.kind] ?? 0.3) +
            accessed -
            doubt
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, count))

    for (const item of scored) item.fact.lastAccessedAt = at
    if (scored.length > 0) scheduleSave()
    return scored.map((item) => item.fact)
  }

  /** 这条说法此刻是否还成立。0 表示没记过时间边界，按一直成立算。 */
  function stillValid(fact, at) {
    if (fact.validTo > 0 && fact.validTo <= at) return false
    if (fact.validFrom > 0 && fact.validFrom > at) return false
    return true
  }

  /**
   * 进入提示词之前的授权复核。
   *
   * 召回只负责把候选找出来；能不能说、说到什么程度，在这里重新判一次：
   * 作用域、场合、时效、证据，四样都得过。
   * 过期或还没生效的直接不出现；没有证据又没把握的，最多降级成「待确认」。
   */
  function selectAuthorized({ query = '', count = 8, scope = DEFAULT_SCOPE, context = 'private', at = now() } = {}) {
    const owner = cleanScope(scope)
    const live = facts.filter((fact) => {
      if (fact.archived) return false
      if (fact.scope !== owner && fact.scope !== SHARED_SCOPE) return false
      if (cleanMention(fact.mentionPolicy) === 'soft_echo') return false
      if (!mentionable(fact, context)) return false
      return stillValid(fact, at)
    })
    // 有原话作证，或者本来就过了半数把握，才算说得出口。
    const readyPool = live.filter(
      (fact) => fact.evidence !== '' || clampConfidence(fact.confidence) >= 0.5
    )
    const unsurePool = live.filter((fact) => !readyPool.includes(fact))

    const ranked = rank(query, Math.max(count * 2, count), at, scope, context)
    const ready = ranked.filter((fact) => readyPool.includes(fact))
    if (ready.length < count) {
      const rest = readyPool
        .slice()
        .sort((a, b) => b.strength - a.strength || b.lastSeenAt - a.lastSeenAt)
      for (const fact of rest) {
        if (ready.length >= count) break
        if (!ready.includes(fact)) ready.push(fact)
      }
    }

    const unsure = unsurePool
      .slice()
      .sort((a, b) => b.strength - a.strength || b.lastSeenAt - a.lastSeenAt)
      .slice(0, 2)
    // 「只借语气」的条目单独拿出来：不给内容，只给一点情绪上的线索。
    // 群里一律不出现——当着别人的面提一句，本身就已经把事说出去了。
    const echo = context === 'group'
      ? []
      : facts
          .filter((fact) => {
            if (fact.archived) return false
            if (fact.scope !== owner && fact.scope !== SHARED_SCOPE) return false
            if (cleanMention(fact.mentionPolicy) !== 'soft_echo') return false
            return stillValid(fact, at)
          })
          .sort((a, b) => b.strength - a.strength || b.lastSeenAt - a.lastSeenAt)
          .slice(0, 3)
    return { ready, unsure, echo, omitted: live.length - ready.length - unsure.length }
  }

  /** 给提示词用：按分类分区，只给还活着的；最近 3 条纠正固定带上。 */
  function digest({ query = '', count = 8, scope = DEFAULT_SCOPE, context = 'private' } = {}) {
    const at = now()
    const owner = cleanScope(scope)
    const selected = selectAuthorized({ query, count, scope, context, at })
    // 被纠正过的事优先级最高：即使和当前话题不相关，也要让模型看到，避免重犯。
    // 但群里不该翻出私下纠正过的私事，所以同样过一遍提及策略与时效。
    const lessons = facts
      .filter((fact) => !fact.archived && fact.kind === 'lesson')
      .filter((fact) => fact.scope === owner || fact.scope === SHARED_SCOPE)
      .filter((fact) => mentionable(fact, context))
      .filter((fact) => stillValid(fact, at))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, 3)
    const seen = new Set(lessons.map((fact) => fact.id))
    const merged = [...lessons, ...selected.ready.filter((fact) => !seen.has(fact.id))]
    // 群里人多，没确认过的猜测一律不端出来；私聊可以留一句，但要标明还没定。
    const unsure = context === 'group' ? [] : selected.unsure
    const echo = selected.echo
    // 记住这一轮端出了什么：对方下一句说「记错了」，才知道该往后退的是哪几条。
    surfaced = [...merged, ...unsure, ...echo]
      .map((fact) => ({ id: fact.id, at }))
      .slice(0, 12)
    if (merged.length === 0 && unsure.length === 0 && echo.length === 0) return ''
    // 「被问到再说」的条目单独分组：既有背景，又不暗示可以主动开口。
    const groups = new Map()
    for (const fact of merged) {
      const pending = cleanMention(fact.mentionPolicy) === 'on_request'
      const key = pending ? 'on_request' : fact.kind
      const list = groups.get(key) ?? []
      list.push(fact)
      groups.set(key, list)
    }
    const lines = []
    for (const [key, list] of groups) {
      lines.push(key === 'on_request' ? '对方问起时再说（别主动提）：' : `${KIND_LABEL[key] ?? '还记得'}：`)
      for (const fact of list) lines.push(`- ${fact.text}`)
    }
    if (unsure.length > 0) {
      lines.push('对方提过、但还没确认过的事（别当定论，需要时问一句）：')
      for (const fact of unsure) lines.push(`- ${fact.text}`)
    }
    // 只给语气，不给内容：让她记得「有这么一件事」，但别把细节摊在对方脸上。
    if (echo.length > 0) {
      lines.push('还有几件事可以放在语气里（别复述内容，对方主动说起再接）：')
      for (const fact of echo) lines.push(`- ${fact.text}`)
    }
    return lines.join('\n')
  }

  /** 设置页 / 诊断用。scope 为空时返回全部，并附上按作用域的计数。 */
  function snapshot(scope = '') {
    const wanted = typeof scope === 'string' ? scope.trim() : ''
    const list = wanted === '' ? facts : facts.filter((fact) => fact.scope === wanted)
    const byScope = {}
    for (const fact of facts) byScope[fact.scope] = (byScope[fact.scope] ?? 0) + 1
    return {
      total: list.length,
      all: facts.length,
      active: list.filter((fact) => !fact.archived).length,
      archived: list.filter((fact) => fact.archived).length,
      byScope,
      facts: list.map((fact) => ({ ...fact }))
    }
  }

  /** 删掉一条记错的事实。 */
  function remove(id) {
    const key = typeof id === 'string' ? id : ''
    const before = facts.length
    facts = facts.filter((fact) => fact.id !== key)
    if (facts.length === before) return { ok: false, reason: 'not-found' }
    scheduleSave()
    return { ok: true, remaining: facts.length }
  }

  /** 改一条记错的文本：保留强度和来源，只换内容。 */
  function update(id, text) {
    const key = typeof id === 'string' ? id : ''
    const fact = facts.find((item) => item.id === key)
    if (fact === undefined) return { ok: false, reason: 'not-found' }
    const clean = cleanText(text)
    if (clean === '') return { ok: false, reason: 'empty' }
    fact.text = clean
    fact.lastSeenAt = now()
    scheduleSave()
    return { ok: true, fact: { ...fact } }
  }

  /** 把一条事实提到 shared 层（两个渠道都记得），或退回自己的作用域。 */
  function setScope(id, scope) {
    const key = typeof id === 'string' ? id : ''
    const fact = facts.find((item) => item.id === key)
    if (fact === undefined) return { ok: false, reason: 'not-found' }
    fact.scope = cleanScope(scope)
    scheduleSave()
    return { ok: true, fact: { ...fact } }
  }

  /**
   * 导出为 JSONL：一行一条，方便追加、grep、手工改。
   * 带 id 与时间戳，导入时按 id 去重，重复导入不会越导越多。
   */
  function exportJsonl({ scope = 'all', includeArchived = true } = {}) {
    const all = scope === 'all'
    const owner = all ? '' : cleanScope(scope)
    const lines = facts
      .filter((fact) => (includeArchived ? true : !fact.archived))
      .filter((fact) => all || fact.scope === owner || fact.scope === SHARED_SCOPE)
      .map((fact) =>
        JSON.stringify({
          id: fact.id,
          kind: fact.kind,
          text: fact.text,
          scope: fact.scope,
          confidence: fact.confidence,
          source: fact.source,
          mentionPolicy: fact.mentionPolicy,
          validFrom: fact.validFrom,
          validTo: fact.validTo,
          evidence: fact.evidence,
          strength: fact.strength,
          createdAt: fact.createdAt,
          lastSeenAt: fact.lastSeenAt,
          mentions: fact.mentions,
          archived: fact.archived === true
        })
      )
    return lines.join('\n')
  }

  /**
   * 导入 JSONL：坏行只计数、不整批失败；同 id 的跳过，同作用域且说法相近的合并。
   * 归档条目也一并恢复，这样导出再导入是一次完整还原。
   */
  function importJsonl(text, { at = now(), scope = DEFAULT_SCOPE, includeArchived = true } = {}) {
    if (typeof text !== 'string' || text.trim() === '') {
      return { ok: false, reason: 'empty', added: 0, merged: 0, skipped: 0, invalid: 0 }
    }
    const fallback = cleanScope(scope)
    const cap = limit()
    let added = 0
    let merged = 0
    let skipped = 0
    let invalid = 0
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (line === '') continue
      let item
      try {
        item = JSON.parse(line)
      } catch {
        invalid += 1
        continue
      }
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        invalid += 1
        continue
      }
      const kind = KINDS.has(item.kind) ? item.kind : ''
      const body = cleanText(item.text)
      if (kind === '' || body === '') {
        invalid += 1
        continue
      }
      // 满了就停在当前条，不为了「导完」把已有的记忆挤掉。
      if (facts.length >= cap && added > 0) break

      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (id !== '' && facts.some((fact) => fact.id === id)) {
        skipped += 1
        continue
      }
      const owner =
        typeof item.scope === 'string' && item.scope.trim() !== '' ? cleanScope(item.scope) : fallback
      const archived = includeArchived && item.archived === true
      const strength = clampStrength(Number(item.strength))
      const confidence = clampConfidence(item.confidence)
      const source = typeof item.source === 'string' ? item.source.slice(0, 80) : ''
      const mentionPolicy = cleanMention(item.mentionPolicy)
      // 导入的旧文件可能没有这几项：一律按「时间不详、没留证据」补，不影响原有内容。
      const validFrom = Number(item.validFrom) || 0
      const validTo = Number(item.validTo) || 0
      const evidence = cleanText(item.evidence)
      const createdAt = Number.isFinite(item.createdAt) ? item.createdAt : at
      const lastSeenAt = Number.isFinite(item.lastSeenAt) ? item.lastSeenAt : at

      if (!archived) {
        const existing = facts.find(
          (fact) =>
            fact.archived === false &&
            fact.kind === kind &&
            fact.scope === owner &&
            similarity(fact.text, body) >= 0.55
        )
        if (existing !== undefined) {
          existing.strength = clampStrength(Math.max(existing.strength, strength))
          existing.lastSeenAt = Math.max(existing.lastSeenAt, lastSeenAt)
          existing.confidence = Math.max(clampConfidence(existing.confidence), confidence)
          if (existing.source === '' && source !== '') existing.source = source
          if ((MENTION_RANK[mentionPolicy] ?? 0) > (MENTION_RANK[cleanMention(existing.mentionPolicy)] ?? 0)) {
            existing.mentionPolicy = mentionPolicy
          }
          merged += 1
          continue
        }
      }

      facts.push({
        id: id !== '' ? id : `fact-${at}-${facts.length}`,
        kind,
        text: body,
        strength,
        createdAt,
        lastSeenAt,
        lastAccessedAt: 0,
        archived,
        source,
        confidence,
        scope: owner,
        mentionPolicy,
        validFrom,
        validTo,
        evidence,
        mentions: Number.isFinite(item.mentions) ? Math.max(0, Math.floor(item.mentions)) : 0
      })
      added += 1
    }
    if (added + merged > 0) {
      decay(at)
      trim()
      scheduleSave()
    }
    return { ok: true, added, merged, skipped, invalid, total: facts.length }
  }

  /**
   * 对方明确否认「你记错了」：把刚才端出来的那条往后退一格。
   *
   * 只退一格是有意的。一次否认可能只是记岔了或者语气重，
   * 连着否认才会一路退到 never；退完仍然保留内容，只是不再主动开口。
   * 没有指定 id 时取这一轮排在最前面的那条，它最可能正是刚刚说出口的话。
   */
  function noteDenial({ id = '', at = now(), windowMs = 30 * 60 * 1000 } = {}) {
    const recent = surfaced.filter((item) => at - item.at <= windowMs)
    const targetId =
      typeof id === 'string' && id !== ''
        ? id
        : recent.length > 0
          ? recent[0].id
          : ''
    if (targetId === '') return { ok: false, reason: 'nothing-surfaced' }
    const fact = facts.find((item) => item.id === targetId)
    if (fact === undefined) return { ok: false, reason: 'not-found' }
    const before = cleanMention(fact.mentionPolicy)
    const index = MENTION_DEMOTE.indexOf(before)
    if (index < 0) return { ok: false, reason: 'bad-policy' }
    fact.denials = (Number(fact.denials) || 0) + 1
    fact.deniedAt = at
    if (index >= MENTION_DEMOTE.length - 1) {
      scheduleSave()
      return { ok: false, reason: 'already-last', id: fact.id, before, after: before }
    }
    const after = MENTION_DEMOTE[index + 1]
    fact.mentionPolicy = after
    // 被否认过的事，分量也该轻一点；不然下次排序还是会把它顶到最前面。
    fact.strength = clampStrength(Number(fact.strength) - 0.2)
    scheduleSave()
    log(`记忆降级：${before} → ${after}`, fact.text.slice(0, 40))
    return { ok: true, id: fact.id, before, after, text: fact.text }
  }

  /** 改一条记忆的提及策略：随时可提 / 被问到再说 / 不主动提。 */
  function setMentionPolicy(id, value) {
    const key = typeof id === 'string' ? id : ''
    const fact = facts.find((item) => item.id === key)
    if (fact === undefined) return { ok: false, reason: 'not-found' }
    if (!MENTION_POLICIES.has(value)) return { ok: false, reason: 'bad-policy' }
    fact.mentionPolicy = value
    scheduleSave()
    return { ok: true, fact: { ...fact } }
  }

  async function reset() {
    facts = []
    await flush()
    return snapshot()
  }

  return {
    load,
    upsert,
    rank,
    digest,
    selectAuthorized,
    snapshot,
    remove,
    update,
    setScope,
    setMentionPolicy,
    noteDenial,
    exportJsonl,
    importJsonl,
    reset,
    flush,
    decay,
    toJSON: () => ({ facts })
  }
}
