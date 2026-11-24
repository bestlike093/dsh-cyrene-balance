/**
 * 结构化记忆：把「聊过什么」整理成能反复用的事实，而不是一堆原文。
 *
 * 借鉴 LivingMemory 的地方：
 * - 事实按槽位分类：偏好、人物、项目、约定、事件、纠正等；
 * - 每条有自己的强度，被再次提到会变强；
 * - 久不被想起会慢慢变弱，弱到一定程度就归档，不删除；
 * - 召回时看「有多重要 + 有多新 + 和这句话像不像」，而不是只取最近几条。
 *
 * 加密由外面注入，封不上就不写盘；读坏了就当空记忆，不挡聊天。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ENABLED_SLOT_IDS,
  migrateSlotId,
  normalizeSlotId,
  slotLabel,
  slotWeight
} from './memory-slots.mjs'
import { MEMORY, TIME } from '../standard.mjs'
/**
 * 一条记忆可以被提起的场合：
 * - free：随时可以直说；
 * - soft_echo：可以借着语气带一点，但别把内容摊开（「你上次提过的那件事…」就够）；
 * - on_request：对方问起再说；
 * - never：不主动提，也不在别人面前提。
 */
const MENTION_POLICIES = new Set(['free', 'soft_echo', 'on_request', 'never'])
const MENTION_RANK = { free: 0, soft_echo: 1, on_request: 2, never: 3 }
const MAX_TEXT = MEMORY.factTextLimit
const DEFAULT_MAX_FACTS = MEMORY.factStoreLimit
const DEFAULT_ARCHIVE_DAYS = MEMORY.factArchiveDays
const SAVE_DEBOUNCE_MS = MEMORY.saveDebounceMs

const KIND_LABEL = Object.fromEntries(ENABLED_SLOT_IDS.map((id) => [id, slotLabel(id)]))

const KIND_WEIGHT = Object.fromEntries(ENABLED_SLOT_IDS.map((id) => [id, slotWeight(id)]))

const FACT_TUNING = MEMORY.ranking.facts

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
  const scope = value.trim().slice(0, MEMORY.scopeTextLimit)
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

/**
 * 短 query 的相似度只有一两个 bigram，命中一个就接近 1.0；
 * 按标准里的固定系数降权，避免「猫」这类两个字压过强度和类型。
 */
function queryRelevanceScale(query) {
  const length = Array.from(String(query ?? '').replace(/\s+/g, '')).length
  return length > 0 && length < FACT_TUNING.shortQueryLength ? FACT_TUNING.shortQueryScale : 1
}

function clampStrength(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return MEMORY.defaultStrength
  return Math.min(MEMORY.strengthMax, Math.max(MEMORY.strengthMin, number))
}

/** 抽取置信度：模型没给时按「未确认」0.45 起步，先放进 unsure 池，不冒充事实。 */
function clampConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return MEMORY.defaultConfidence
  return Math.min(MEMORY.confidenceMax, Math.max(MEMORY.confidenceMin, number))
}

/** 兼容时间戳：数字、数字字符串、ISO 日期字符串都能读；读不出才落回兜底值。 */
function parseTimestamp(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    if (Number.isFinite(number)) return number
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
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
  /** 上次读取失败且损坏文件无法隔离时置真：禁止写盘，绝不覆盖证据。 */
  let writesBlocked = false
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
        const mapped = list
          .filter((item) => item !== null && typeof item === 'object')
          .map((item, index) => ({
            id: typeof item.id === 'string' && item.id !== '' ? item.id : `fact-${index}-${now()}`,
            /* 旧数据 kind 走迁移（person → identity），未知分类回落到偏好，不丢内容。 */
            kind: normalizeSlotId(item.kind),
            text: cleanText(item.text),
            strength: clampStrength(item.strength),
            createdAt: Number(item.createdAt) || now(),
            lastSeenAt: Number(item.lastSeenAt) || now(),
            lastAccessedAt: Number(item.lastAccessedAt) || 0,
            // 衰减结算锚点：旧数据用 lastSeenAt 补，迁移后不会把旧账重复扣一遍。
            decayedAt: Number(item.decayedAt) || Number(item.lastSeenAt) || now(),
            archived: item.archived === true,
            // 旧数据没有来源与置信度：按「来自桌面、不到半数把握」补，让它先待在待确认池。
            source: typeof item.source === 'string' ? item.source.slice(0, MEMORY.sourceTextLimit) : '',
            confidence: clampConfidence(item.confidence),
            // 只有模型/导入显式给过置信度才算「确认过」；补出来的默认值不算。
            confidenceExplicit: Number.isFinite(Number(item.confidence)),
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
        facts = mapped
        // 超限时按同一套淘汰规则收口：先归档里最弱的，再活跃里最弱的，
        // 不按写入顺序截尾，避免一条重要的纠正在很久以前写过就被丢掉。
        if (facts.length > limit()) {
          log(`结构化记忆共 ${facts.length} 条，超过上限 ${limit()}，按活跃与强度保留`)
          trim()
        }
        return { ok: true, count: facts.length }
      } catch (error) {
        log('结构化记忆读取失败，按空记忆继续', error)
        facts = []
        // 读坏的文件先隔离改名：既保留证据，也避免后续写入用空数组覆盖它。
        try {
          await fs.rename(filePath, `${filePath}.corrupt-${now()}`)
          log('损坏的结构化记忆文件已隔离，下次写入另起新文件')
        } catch (moveError) {
          writesBlocked = true
          log('损坏文件无法改名，已禁止写入以避免覆盖证据', moveError)
        }
        return { ok: false, reason: 'unreadable' }
      } finally {
        loaded = true
        loading = null
      }
    })()
    return loading
  }

  function scheduleSave() {
    if (!available || writesBlocked || saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flush()
    }, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }

  async function flush() {
    if (!available) return false
    if (writesBlocked) {
      log('结构化记忆写盘被禁止：上次读取失败且损坏文件无法隔离')
      return false
    }
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    writeChain = writeChain.then(async () => {
      try {
        const sealed = await seal({ version: 1, facts })
        const temp = `${filePath}.tmp`
        await fs.mkdir(path.dirname(filePath), { recursive: true })
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
      const kind = normalizeSlotId(item?.kind)
      const text = cleanText(item?.text)
      if (text === '') continue
      const confidence = clampConfidence(item?.confidence)
      const confidenceExplicit =
        item?.confidence !== undefined && item?.confidence !== null && Number.isFinite(Number(item?.confidence))
      const source = typeof item?.source === 'string' ? item.source.slice(0, MEMORY.sourceTextLimit) : ''
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
          if (similarity(fact.text, supersedes) < FACT_TUNING.supersedesThreshold) continue
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
          similarity(fact.text, text) >= FACT_TUNING.mergeThreshold
      )
      if (existing !== undefined) {
        existing.strength = clampStrength(existing.strength + FACT_TUNING.reinforceStep)
        existing.lastSeenAt = at
        // 重新被提起等于刚结算过衰减，锚点跟着走，不会把旧账重复扣一遍。
        existing.decayedAt = at
        // 同一件事被再次确认时，取模型显式给出的置信度；没给就保持原值，不用默认值抬升。
        if (confidenceExplicit) {
          existing.confidence = confidence
          existing.confidenceExplicit = true
        }
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
          strength: MEMORY.defaultStrength,
          createdAt: at,
          lastSeenAt: at,
          lastAccessedAt: 0,
          decayedAt: at,
          archived: false,
          source,
          confidence,
          confidenceExplicit,
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
      // 强度只结算「上次结算之后」的新增天数：同一时刻反复调用不重复扣，
      // 聊得再密也不会让记忆掉得比时间本身更快。
      const anchor = Number(fact.decayedAt) || Number(fact.lastSeenAt) || at
      const deltaDays = Math.max(0, (at - anchor) / TIME.DAY)
      if (deltaDays <= 0) continue
      // 归档看的是「多久没再被确认」；结算锚点会被刷新，不能拿它当闲置天数。
      const idleDays = Math.max(0, (at - fact.lastSeenAt) / TIME.DAY)
      const lowConfidence = clampConfidence(fact.confidence) < FACT_TUNING.lowConfidenceThreshold
      // 标准衰减是每天 0.02：五十天左右从满格淡到 0，期间被提起会重新变强。
      // 低置信度的猜测按 0.05 淡得更快，一个月没再被确认就归档，不让它长期占着提示词。
      fact.strength = clampStrength(
        fact.strength -
          deltaDays * (lowConfidence ? FACT_TUNING.lowConfidenceDailyDecay : FACT_TUNING.dailyDecay)
      )
      fact.decayedAt = at
      if (idleDays >= FACT_TUNING.lowConfidenceArchiveDays && lowConfidence && fact.strength < FACT_TUNING.lowConfidenceArchiveStrength) {
        fact.archived = true
      } else if (idleDays >= DEFAULT_ARCHIVE_DAYS && fact.strength < FACT_TUNING.archiveStrength) {
        fact.archived = true
      }
    }
  }

  function trim() {
    const cap = limit()
    if (facts.length <= cap) return
    /*
     * 保留优先级：活跃在前、强的在前；同分时新的在前。
     * 排序只发生在副本上，裁完再按原顺序过滤，设置页不会因一次裁剪跳序。
     */
    const keep = new Set(
      facts
        .slice()
        .sort(
          (a, b) =>
            Number(a.archived) - Number(b.archived) ||
            b.strength - a.strength ||
            b.lastSeenAt - a.lastSeenAt
        )
        .slice(0, cap)
    )
    facts = facts.filter((fact) => keep.has(fact))
  }

  /**
   * 召回：重要 + 新鲜 + 和当前这句话相关，三者一起算。
   * 只取当前作用域，外加 shared 层的共同记忆。
   *
   * markAccessed=false 用于「先多召回、再授权复核」的路径：
   * 只有最终真正进了提示词的条目才算被想起，不能把落选的候选也记成用过。
   */
  function rank(query = '', count = MEMORY.factsLimit, at = now(), scope = DEFAULT_SCOPE, context = 'private', markAccessed = true) {
    const owner = cleanScope(scope)
    // count 为 0 表示「本轮不想召回」：直接空手而归，不偷偷带回一条。
    if (count <= 0) return []
    decay(at)
    const q = String(query ?? '')
    const relevanceScale = q === '' ? 0 : queryRelevanceScale(q)
    const scored = facts
      .filter((fact) => !fact.archived)
      .filter((fact) => fact.scope === owner || fact.scope === SHARED_SCOPE)
      .filter((fact) => mentionable(fact, context))
      .map((fact) => {
        const days = Math.max(0, (at - fact.lastSeenAt) / TIME.DAY)
        const recency = Math.max(0, FACT_TUNING.recencyBase - days / FACT_TUNING.recencyWindowDays)
        const related = q === '' ? 0 : similarity(q, fact.text) * FACT_TUNING.relevanceWeight * relevanceScale
        // 被召回过会短时加分，两周内随未使用慢慢归零，不搞「召回过一次就永久 +0.2」。
        const accessedAge =
          fact.lastAccessedAt > 0
            ? Math.max(0, Math.min(1, (at - fact.lastAccessedAt) / (FACT_TUNING.accessedWindowDays * TIME.DAY)))
            : 1
        const accessed = FACT_TUNING.accessedBonus * (1 - accessedAge)
        // 低置信度的猜测默认往后排，避免它挤掉更确定的记忆。
        const doubt =
          clampConfidence(fact.confidence) < FACT_TUNING.lowConfidenceThreshold ? FACT_TUNING.doubtPenalty : 0
        return {
          fact,
          score:
            fact.strength * FACT_TUNING.strengthWeight +
            recency +
            related +
            (KIND_WEIGHT[fact.kind] ?? FACT_TUNING.defaultSlotWeight) +
            accessed -
            doubt
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(MEMORY.recallMinLimit, count))

    if (markAccessed) {
      for (const item of scored) item.fact.lastAccessedAt = at
      if (scored.length > 0) scheduleSave()
    }
    return scored.map((item) => item.fact)
  }

  /** 这条说法此刻是否还成立。0 表示没记过时间边界，按一直成立算。 */
  function stillValid(fact, at) {
    if (fact.validTo > 0 && fact.validTo <= at) return false
    if (fact.validFrom > 0 && fact.validFrom > at) return false
    return true
  }

  /** 记忆槽开关同样管事实：关掉的槽不注入人格，不再从结构化事实里绕回来。 */
  function slotAllowed(fact, slots) {
    return !Array.isArray(slots) || slots.includes(fact.kind)
  }

  /**
   * 进入提示词之前的授权复核。
   *
   * 召回只负责把候选找出来；能不能说、说到什么程度，在这里重新判一次：
   * 作用域、场合、时效、证据，四样都得过。
   * 过期或还没生效的直接不出现；没有证据又没把握的，最多降级成「待确认」。
   */
  function selectAuthorized({ query = '', count = MEMORY.factsLimit, scope = DEFAULT_SCOPE, context = 'private', at = now(), slots = null } = {}) {
    const owner = cleanScope(scope)
    const live = facts.filter((fact) => {
      if (fact.archived) return false
      if (fact.scope !== owner && fact.scope !== SHARED_SCOPE) return false
      if (!slotAllowed(fact, slots)) return false
      if (cleanMention(fact.mentionPolicy) === 'soft_echo') return false
      if (!mentionable(fact, context)) return false
      return stillValid(fact, at)
    })
    // 有原话作证，或模型显式给过半数以上的把握，才算说得出口；
    // 旧数据补的默认置信度不算「确认过」，没有证据时先进待确认池，不再恒空。
    const readyPool = live.filter(
      (fact) =>
        fact.evidence !== '' ||
        (fact.confidenceExplicit === true && clampConfidence(fact.confidence) >= FACT_TUNING.minReadyConfidence)
    )
    const unsurePool = live.filter((fact) => !readyPool.includes(fact))

    const ranked = rank(query, Math.max(count * FACT_TUNING.oversampleFactor, count), at, scope, context, false)
    // 多召回只是给「有证据的优先」留余量；最终能进提示词的仍只到 count。
    const ready = ranked.filter((fact) => readyPool.includes(fact)).slice(0, Math.max(0, count))
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
      .slice(0, FACT_TUNING.unsureLimit)
    // 「只借语气」的条目单独拿出来：不给内容，只给一点情绪上的线索。
    // 群里一律不出现——当着别人的面提一句，本身就已经把事说出去了。
    const echo = context === 'group'
      ? []
      : facts
          .filter((fact) => {
            if (fact.archived) return false
            if (fact.scope !== owner && fact.scope !== SHARED_SCOPE) return false
            if (!slotAllowed(fact, slots)) return false
            if (cleanMention(fact.mentionPolicy) !== 'soft_echo') return false
            return stillValid(fact, at)
          })
          .sort((a, b) => b.strength - a.strength || b.lastSeenAt - a.lastSeenAt)
          .slice(0, FACT_TUNING.echoLimit)
    // 统计里把 echo 也算作「被端出去过」：只借语气同样占用了这一轮的注意力。
    const total = live.length + echo.length
    const visible = ready.length + unsure.length + echo.length
    // 只有这一轮真正会出现在提示词里的条目才更新「被想起」时间；
    // rank 多召回但落选的候选不记，否则会有条目从没被端出来却越来越新鲜。
    const surfacedFacts = [...ready, ...unsure, ...echo]
    for (const fact of surfacedFacts) fact.lastAccessedAt = at
    if (surfacedFacts.length > 0) scheduleSave()
    return {
      ready,
      unsure,
      echo,
      total,
      visible,
      omitted: Math.max(0, total - visible)
    }
  }

  /** 给提示词用：按分类分区，只给还活着的；最近 3 条纠正固定带上。 */
  function digest({ query = '', count = MEMORY.factDigestLimit, scope = DEFAULT_SCOPE, context = 'private', slots = null } = {}) {
    const at = now()
    const owner = cleanScope(scope)
    const selected = selectAuthorized({ query, count, scope, context, at, slots })
    // 被纠正过的事优先级最高：即使和当前话题不相关，也要让模型看到，避免重犯。
    // 但群里不该翻出私下纠正过的私事，所以同样过一遍提及策略与时效。
    const lessons = facts
      .filter((fact) => !fact.archived && fact.kind === 'lesson')
      .filter((fact) => fact.scope === owner || fact.scope === SHARED_SCOPE)
      .filter((fact) => slotAllowed(fact, slots))
      // 「只借语气」的纠正不能整条写进提示词：与 selectAuthorized 的口径一致。
      .filter((fact) => cleanMention(fact.mentionPolicy) !== 'soft_echo')
      .filter((fact) => mentionable(fact, context))
      .filter((fact) => stillValid(fact, at))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, MEMORY.recentLessonLimit)
    const seen = new Set(lessons.map((fact) => fact.id))
    const merged = [...lessons, ...selected.ready.filter((fact) => !seen.has(fact.id))]
    // 群里人多，没确认过的猜测一律不端出来；私聊可以留一句，但要标明还没定。
    const unsure = context === 'group' ? [] : selected.unsure
    const echo = selected.echo
    // 记住这一轮端出了什么：对方下一句说「记错了」，才知道该往后退的是哪几条。
    // origin 用来区分「固定附带的纠正」和「这一轮真正召回的内容」：否认默认该落在后者身上。
    surfaced = [
      ...lessons.map((fact) => ({ id: fact.id, at, origin: 'lesson' })),
      ...selected.ready
        .filter((fact) => !seen.has(fact.id))
        .map((fact) => ({ id: fact.id, at, origin: 'ready' })),
      ...unsure.map((fact) => ({ id: fact.id, at, origin: 'unsure' })),
      ...echo.map((fact) => ({ id: fact.id, at, origin: 'echo' }))
    ].slice(0, MEMORY.surfacedLimit)
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
    // 只给语气，不给内容：让她记得「有这么几类事」，但别把细节摊在对方脸上。
    if (echo.length > 0) {
      const labels = [...new Set(echo.map((fact) => KIND_LABEL[fact.kind] ?? '旧事'))]
      lines.push('还有几件事可以放在语气里（别复述内容，对方主动说起再接）：')
      lines.push(`- ${labels.join('、')}（只借情绪，不展开）`)
    }
    return lines.join('\n')
  }

  /** 设置页 / 诊断用。scope 为空时返回全部，并附上按作用域的计数。 */
  function snapshot(scope = '') {
    const wanted = typeof scope === 'string' ? scope.trim() : ''
    const list = wanted === '' ? facts : facts.filter((fact) => fact.scope === wanted)
    // 作用域是用户可改的字符串，用无原型对象计数，避免 __proto__ 之类键改到原型上。
    const byScope = Object.create(null)
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
    fact.decayedAt = now()
    // 改完可能和另一条已有记忆几乎一样：主动合并，不留两条重复条目。
    const dupe = facts.find(
      (item) =>
        item.id !== fact.id &&
        item.archived === false &&
        item.kind === fact.kind &&
        item.scope === fact.scope &&
        similarity(item.text, clean) >= 0.55
    )
    let mergedInto = false
    if (dupe !== undefined) {
      fact.strength = clampStrength(Math.max(fact.strength, dupe.strength))
      fact.createdAt = Math.min(fact.createdAt, dupe.createdAt)
      if (fact.evidence === '' && dupe.evidence !== '') fact.evidence = dupe.evidence
      if ((MENTION_RANK[cleanMention(dupe.mentionPolicy)] ?? 0) > (MENTION_RANK[cleanMention(fact.mentionPolicy)] ?? 0)) {
        fact.mentionPolicy = dupe.mentionPolicy
      }
      facts = facts.filter((item) => item.id !== dupe.id)
      mergedInto = true
      log('编辑记忆后与已有条目重合，已合并', clean.slice(0, 40))
    }
    scheduleSave()
    return { ok: true, fact: { ...fact }, mergedInto }
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
      // 指定作用域时只导这一份；shared 是独立作用域，不跟着任意一侧被带走。
      .filter((fact) => all || fact.scope === owner)
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
          decayedAt: fact.decayedAt,
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
      /* 导入只收启用槽；旧键先迁移（person → identity），备用槽与未知键拒绝。 */
      const kind = migrateSlotId(item.kind)
      const body = cleanText(item.text)
      if (!ENABLED_SLOT_IDS.includes(kind) || body === '') {
        invalid += 1
        continue
      }
      // 满了就停在当前条，不为了「导完」把已有的记忆挤掉。
      // 容量判断放到真正 push 之前：已有条目仍可合并，新的条目不再超限写入。

      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (id !== '' && facts.some((fact) => fact.id === id)) {
        skipped += 1
        continue
      }
      // 不导入归档时，归档条目整条跳过，而不是把它「复活」成活跃记忆。
      if (item.archived === true && !includeArchived) {
        skipped += 1
        continue
      }
      const owner =
        typeof item.scope === 'string' && item.scope.trim() !== '' ? cleanScope(item.scope) : fallback
      const archived = item.archived === true
      const strength = clampStrength(Number(item.strength))
      const confidence = clampConfidence(item.confidence)
      const confidenceExplicit = Number.isFinite(Number(item.confidence))
      const source = typeof item.source === 'string' ? item.source.slice(0, MEMORY.sourceTextLimit) : ''
      const mentionPolicy = cleanMention(item.mentionPolicy)
      // 导入的旧文件可能没有这几项：一律按「时间不详、没留证据」补，不影响原有内容。
      const validFrom = Number(item.validFrom) || 0
      const validTo = Number(item.validTo) || 0
      const evidence = cleanText(item.evidence)
      const createdAt = parseTimestamp(item.createdAt, at)
      const lastSeenAt = parseTimestamp(item.lastSeenAt, at)
      const decayedAt = parseTimestamp(item.decayedAt, lastSeenAt)

      if (!archived) {
        const existing = facts.find(
          (fact) =>
            fact.archived === false &&
            fact.kind === kind &&
            fact.scope === owner &&
            similarity(fact.text, body) >= FACT_TUNING.mergeThreshold
        )
        if (existing !== undefined) {
          existing.strength = clampStrength(Math.max(existing.strength, strength))
          existing.lastSeenAt = Math.max(existing.lastSeenAt, lastSeenAt)
          existing.decayedAt = Math.max(Number(existing.decayedAt) || 0, decayedAt)
          if (confidenceExplicit) {
            existing.confidence = confidence
            existing.confidenceExplicit = true
          }
          if (existing.source === '' && source !== '') existing.source = source
          if ((MENTION_RANK[mentionPolicy] ?? 0) > (MENTION_RANK[cleanMention(existing.mentionPolicy)] ?? 0)) {
            existing.mentionPolicy = mentionPolicy
          }
          merged += 1
          continue
        }
      }

      if (facts.length >= cap) break

      facts.push({
        id: id !== '' ? id : `fact-${at}-${facts.length}`,
        kind,
        text: body,
        strength,
        createdAt,
        lastSeenAt,
        lastAccessedAt: 0,
        decayedAt,
        archived,
        source,
        confidence,
        confidenceExplicit,
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
   * 没有指定 id 时优先取这一轮真正召回的内容，其次才是固定附带的纠正；
   * 这样用户否认一条普通偏好时，不会误把另一条无关的 lesson 降级。
   */
  function noteDenial({
    id = '',
    at = now(),
    windowMs = FACT_TUNING.denialWindowMinutes * TIME.MINUTE
  } = {}) {
    // 只认「此刻之前、窗口之内」的端出记录；未来时间戳不算数。
    const recent = surfaced.filter((item) => item.at <= at && at - item.at <= windowMs)
    const recalled = recent.find((item) => item.origin === 'ready' || item.origin === 'unsure')
    const targetId =
      typeof id === 'string' && id !== ''
        ? id
        : recalled?.id ?? recent[0]?.id ?? ''
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
    fact.strength = clampStrength(Number(fact.strength) - FACT_TUNING.denialStrengthStep)
    scheduleSave()
    log(`记忆降级：${before} → ${after}`, fact.text.slice(0, MEMORY.logExcerptLimit))
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
    const previous = facts
    facts = []
    const saved = await flush()
    if (!saved) {
      // 写盘失败时把内存恢复原样：否则下一次自动保存会把空数组落盘，等于静默清空。
      facts = previous
      return { ...snapshot(), ok: false, reason: 'flush-failed' }
    }
    surfaced = []
    return { ok: true, ...snapshot() }
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
