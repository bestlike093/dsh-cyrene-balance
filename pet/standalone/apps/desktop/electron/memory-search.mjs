/**
 * 记忆检索：本地打分，不依赖外部接口。
 *
 * 背景：DeepSeek 没有 embeddings 端点，真向量要么本地跑模型，要么另挂一家 Key。
 * 这一层先把「能找到相关旧事」做出来：中文按字二元组切、英文按词切，
 * BM25 打分，再乘一个时间衰减。零依赖、可离线、单次查询是毫秒级。
 *
 * 向量接口已经留好：调用方拿到向量分后塞进 `vectorScores`（id → 0..1），
 * 这里按 `vectorWeight` 与 BM25 归一化分混合。以后配了第三方 Key 或本地模型，
 * 不需要改这一层的调用方式。
 */

/** 检索默认分寸。 */
export const DEFAULT_SEARCH = {
  /** 一次最多返回几条。 */
  limit: 8,
  /** 时间衰减半衰期：默认 30 天前的记忆权重减半。 */
  halfLifeDays: 30,
  /** BM25 参数，沿用常见取值。 */
  k1: 1.2,
  b: 0.75,
  /** 低于这个最终分就不返回，避免「什么都算相关」。 */
  minScore: 0.01,
  /** 配了向量时的混合权重：0 全看 BM25，1 全看向量。 */
  vectorWeight: 0.6
}

const CJK_RUN = /[\u4e00-\u9fff]+/g
const LATIN_WORD = /[a-z0-9]+/g

/**
 * 切词。
 *
 * 中文不引入词典：连续汉字段切成字二元组，「降温了」→ 降温 / 温了。
 * 短句足够稳，也不会因为分词器把专有名词切碎。英文和数字按整词。
 */
export function tokenize(text) {
  const cleaned = String(text ?? '').toLowerCase()
  const tokens = []

  for (const word of cleaned.match(LATIN_WORD) ?? []) {
    tokens.push(word)
  }
  for (const run of cleaned.match(CJK_RUN) ?? []) {
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2))
    }
  }

  return tokens
}

/** 余弦相似度；任一侧为空或维度对不上就返回 0。 */
export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return 0
  if (left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index])
    const b = Number(right[index])
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function parseTime(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const stamp = Date.parse(String(value ?? ''))
  return Number.isFinite(stamp) ? stamp : fallback
}

/**
 * 给一批记忆打分并排序。
 *
 * `items` 需要有 `text`，`id` 可选（向量分靠它对上），`at` 可选（时间衰减）。
 * 返回新的数组，不改动传入的对象。
 */
export function rankMemories(query, items, options = {}) {
  const config = { ...DEFAULT_SEARCH, ...options }
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return []

  const queryTokens = [...new Set(tokenize(query))]
  // 查询里一个有效词都没有（比如只有标点），交给调用方回退到最近记忆。
  if (queryTokens.length === 0) return []

  const now = Number.isFinite(config.now) ? config.now : Date.now()
  const docs = list.map((item) => ({
    item,
    tokens: tokenize(item?.text),
    at: parseTime(item?.at, now)
  }))

  const totalLength = docs.reduce((sum, doc) => sum + doc.tokens.length, 0)
  const averageLength = totalLength === 0 ? 1 : totalLength / docs.length

  // 文档频率：一个词出现在多少条记忆里。
  const documentFrequency = new Map()
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }

  const scored = docs.map((doc) => {
    const counts = new Map()
    for (const token of doc.tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }

    let bm25 = 0
    for (const token of queryTokens) {
      const termFrequency = counts.get(token)
      if (termFrequency === undefined) continue
      const df = documentFrequency.get(token) ?? 0
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))
      const lengthRatio = doc.tokens.length / averageLength
      const denominator =
        termFrequency + config.k1 * (1 - config.b + config.b * lengthRatio)
      bm25 += idf * ((termFrequency * (config.k1 + 1)) / denominator)
    }

    const ageDays = Math.max(0, (now - doc.at) / 86_400_000)
    // 调用方可以按层给半衰期；Infinity 表示这一层不随时间衰减。
    const halfLifeDays =
      typeof config.halfLifeFor === 'function'
        ? Number(config.halfLifeFor(doc.item))
        : Number(config.halfLifeDays)
    const decay =
      halfLifeDays === Infinity
        ? 1
        : Math.pow(0.5, ageDays / (Number.isFinite(halfLifeDays) && halfLifeDays > 0 ? halfLifeDays : 30))
    // 衰减只压到六成，不把旧事抹成零：重要的旧记忆仍然有机会被翻出来。
    // 用户钉住的条目按「长期有效」处理，不参与时间衰减。
    const recency = doc.item?.pinned === true ? 1 : 0.6 + 0.4 * decay

    return { ...doc.item, _bm25: bm25, _recency: recency, _at: doc.at }
  })

  const maxBm25 = scored.reduce((max, item) => Math.max(max, item._bm25), 0)
  if (maxBm25 <= 0) return []

  const hasVector = config.vectorScores instanceof Map && config.vectorScores.size > 0
  const vectorWeight = hasVector
    ? Math.min(Math.max(Number(config.vectorWeight) || 0, 0), 1)
    : 0

  const ranked = scored
    .map((item) => {
      const normalized = item._bm25 / maxBm25
      const vectorScore = hasVector
        ? Math.min(Math.max(Number(config.vectorScores.get(item.id)) || 0, 0), 1)
        : 0
      // 被反复想起来的旧事会更牢：每次命中加一点，最多 +30%。
      // 这样「聊过很多次的事」能压过同分的新鲜事，而不会无限放大。
      const recallCount = Math.max(0, Number(item.recallCount) || 0)
      const reinforcement = 1 + Math.min(0.3, 0.12 * Math.log10(1 + recallCount))
      // 钉住的事额外抬一点，但不至于盖过「这一句本来就更相关」。
      const pinBoost = item.pinned === true ? 1.2 : 1
      const score =
        (hasVector
          ? normalized * (1 - vectorWeight) + vectorScore * vectorWeight
          : normalized * item._recency) * reinforcement * pinBoost
      return {
        ...item,
        score: Math.round(score * 10_000) / 10_000,
        bm25: Math.round(item._bm25 * 10_000) / 10_000,
        recency: Math.round(item._recency * 1000) / 1000
      }
    })
    .filter((item) => item.score >= config.minScore)
    // 同分时新的在前，避免每次查询顺序漂移。
    .sort((left, right) => right.score - left.score || right._at - left._at)

  // 调用方可能显式传 limit: undefined（想用默认值），不能让它把默认值覆盖成 NaN。
  const limit = Number.isFinite(Number(config.limit))
    ? Math.max(1, Math.floor(Number(config.limit)))
    : DEFAULT_SEARCH.limit

  return ranked
    .slice(0, limit)
    .map(({ _bm25, _recency, _at, ...rest }) => rest)
}
