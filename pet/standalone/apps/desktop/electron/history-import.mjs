/**
 * 历史聊天导入：把已经落盘的对话翻一遍，挑出「对方说过自己」的句子。
 *
 * 这里不做模型摘要。旧聊天里每一句都可能是玩笑、转述或者反问，
 * 让模型事后去总结一遍，反而容易把语气当成事实。
 * 所以只认几种明确的自我陈述句式，抽出来的条目一律标成「被问到再说」，
 * 先把线索留住，等以后再聊到时由对方确认。
 *
 * 分片只用于控制单次处理的长度和统计话题，不产出「总结段落」。
 */

/** 句子太短或太长都不像一句可用的自我陈述。 */
const MIN_CLAIM = 3
const MAX_CLAIM = 40

/**
 * 明确的自我陈述。捕获组就是要记住的那半句。
 * 顺序有意义：先匹配「不喜欢」，避免被「喜欢」先吃掉。
 */
const PATTERNS = [
  {
    kind: 'preference',
    re: /我(?:不太|不|最不)(?:喜欢|爱)([^，。！？,.!?；;\s]{2,16})/,
    label: (body) => `不喜欢${body}`
  },
  {
    kind: 'preference',
    re: /我(?:很|最|超|特别|挺)?(?:喜欢|爱)([^，。！？,.!?；;\s]{2,16})/,
    label: (body) => `喜欢${body}`
  },
  {
    kind: 'project',
    re: /我(?:在|正在)(?:做|写|开发|推进|弄)([^，。！？,.!?；;\s]{2,24})/,
    label: (body) => `在做${body}`
  },
  {
    kind: 'project',
    re: /我(?:在学|正在学|想学)([^，。！？,.!?；;\s]{2,20})/,
    label: (body) => `在学${body}`
  },
  {
    kind: 'person',
    re: /我(?:的|养的|养了|养)?(?:猫|狗|宠物)叫([^，。！？,.!?；;\s]{1,12})/,
    label: (body, match) => {
      const pet = /猫/.test(match[0]) ? '猫' : /狗/.test(match[0]) ? '狗' : '宠物'
      return `养的${pet}叫${body}`
    }
  },
  {
    kind: 'person',
    re: /我叫([^，。！？,.!?；;\s]{1,12})/,
    label: (body) => `名字叫${body}`
  }
]

/** 句尾语气词不属于事实本身，抽出来时去掉。 */
const TRAILING_PARTICLES = /[啊呀呢吧哦啦嘛哈]+$/

function asText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 兼容 content（渲染侧）与 text（存储层）两种字段。 */
function readMessage(item) {
  if (item === null || typeof item !== 'object') return null
  const role =
    typeof item.role === 'string'
      ? item.role
      : item.from === 'user'
        ? 'user'
        : item.from === 'assistant'
          ? 'assistant'
          : ''
  const text = asText(item.content) || asText(item.text)
  if (text === '') return null
  const at = Number(item.at ?? item.time ?? item.createdAt) || 0
  return { role, text, at, source: typeof item.source === 'string' ? item.source : '' }
}

/**
 * 从一句话里抽出可记为事实的片段。
 * 只返回第一处匹配：一句话里塞进来的第二件事通常已经换了话题。
 */
export function extractClaim(text) {
  const source = asText(text).replace(/\s+/g, ' ')
  if (source === '') return null
  // 问句不是在陈述自己；转述别人的话也跳过。
  if (/[？?]\s*$/.test(source)) return null
  for (const { kind, re, label } of PATTERNS) {
    const match = re.exec(source)
    if (match === null) continue
    const body = match[1].replace(TRAILING_PARTICLES, '').trim()
    if (body.length < MIN_CLAIM - 1) continue
    // 带「你」的句子多半在说对方，不往自己身上记。
    if (body.includes('你') && kind !== 'person') continue
    return { kind, text: label(body, match).slice(0, MAX_CLAIM), raw: source.slice(0, 120) }
  }
  return null
}

/** 按条数切段；分片边界只用来控制处理长度。 */
export function chunkMessages(messages, size = 40) {
  const list = Array.isArray(messages) ? messages : []
  const step = Number.isFinite(size) && size > 0 ? Math.floor(size) : 40
  const chunks = []
  for (let index = 0; index < list.length; index += step) {
    chunks.push(list.slice(index, index + step))
  }
  return chunks
}

/** 统计式分片概况：多少条、谁说的、反复出现什么词。不伪造摘要。 */
export function summarizeChunk(chunk) {
  const list = Array.isArray(chunk) ? chunk : []
  let userTurns = 0
  let assistantTurns = 0
  const counts = new Map()
  for (const item of list) {
    const message = readMessage(item)
    if (message === null) continue
    if (message.role === 'user') userTurns += 1
    else if (message.role === 'assistant') assistantTurns += 1
    if (message.role !== 'user') continue
    // 只统计用户自己的话：她说了什么不重要，对方在意什么才重要。
    const chars = message.text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
    for (let i = 0; i < chars.length - 1; i += 1) {
      const gram = chars.slice(i, i + 2)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
  }
  const topics = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word)
  return { total: list.length, userTurns, assistantTurns, topics }
}

/**
 * 把历史对话整理成候选事实；纯函数，不写库，方便测试。
 *
 * 同一段话里反复出现同一件事时只保留一条，避免一个习惯被记十遍。
 */
export function collectHistoryCandidates(messages, { limit = 12 } = {}) {
  const list = Array.isArray(messages) ? messages : []
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 12
  const seen = new Set()
  const candidates = []
  for (const item of list) {
    const message = readMessage(item)
    if (message === null) continue
    if (message.role !== '' && message.role !== 'user') continue
    const claim = extractClaim(message.text)
    if (claim === null) continue
    if (seen.has(claim.text)) continue
    seen.add(claim.text)
    candidates.push({
      kind: claim.kind,
      text: claim.text,
      evidence: claim.raw,
      confidence: claim.kind === 'project' ? 0.55 : 0.6,
      mentionPolicy: 'on_request',
      at: message.at
    })
    if (candidates.length >= max) break
  }
  return candidates
}

/**
 * 把候选写进记忆库。已经记过的事不再写，避免每次启动都把强度刷一遍。
 * 返回的统计只描述这次做了什么，不代表对方确认过这些内容。
 */
export async function importHistoryCandidates({
  messages,
  factStore,
  scope = 'desktop',
  at = Date.now,
  log = () => {}
} = {}) {
  const list = Array.isArray(messages) ? messages : []
  if (list.length === 0) return { ok: true, examined: 0, candidates: 0, added: 0, skipped: 0 }
  if (factStore === null || typeof factStore?.upsert !== 'function') {
    return { ok: false, reason: 'no-store', examined: 0, candidates: 0, added: 0, skipped: 0 }
  }
  const candidates = collectHistoryCandidates(list)
  if (candidates.length === 0) {
    return { ok: true, examined: list.length, candidates: 0, added: 0, skipped: 0 }
  }
  const known = new Set(
    factStore
      .snapshot(scope)
      .facts.filter((fact) => !fact.archived)
      .map((fact) => fact.text.replace(/\s+/g, ''))
  )
  const fresh = candidates.filter((item) => !known.has(item.text.replace(/\s+/g, '')))
  const skipped = candidates.length - fresh.length
  if (fresh.length === 0) {
    return { ok: true, examined: list.length, candidates: candidates.length, added: 0, skipped }
  }
  const now = typeof at === 'function' ? at() : Date.now()
  const stamped = fresh.map((item, index) => ({
    kind: item.kind,
    text: item.text,
    evidence: item.evidence,
    confidence: item.confidence,
    mentionPolicy: item.mentionPolicy,
    source: `history:${scope}`,
    // 同一次导入的条目错开 1ms，方便在设置页按时间排开。
    validFrom: (item.at > 0 ? item.at : now) + index
  }))
  const result = factStore.upsert(stamped, now, scope)
  log(
    `历史聊天导入：看过 ${list.length} 条，候选 ${candidates.length} 条，新记下 ${result.added} 条，已有 ${skipped} 条`
  )
  return {
    ok: true,
    examined: list.length,
    candidates: candidates.length,
    added: result.added,
    reinforced: result.reinforced,
    skipped
  }
}
