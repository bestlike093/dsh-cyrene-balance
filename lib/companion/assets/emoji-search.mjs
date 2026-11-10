/**
 * 表情包检索后端：一句话 → 候选表情。
 *
 * 两层一起算：
 *   1. 本地匹配：直接命中表情 id、情绪词或场景词。零依赖、零延迟。
 *   2. 向量检索：复用 memory/embedding 的协议（{ id, text } 进，Map<id, 分数> 出），
 *      把「意思相近」补到本地匹配之上。没有可用的向量后端就安静退回纯本地。
 *
 * 与记忆检索同一条协议链：createEmbeddingService 产出 scoreAll，
 * 这里只负责把表情清单翻译成它认识的形状，再把分数并回来。
 */

/** 中文情绪词 → 清单里的英文标签，让「开心」也能命中 happy。 */
const EMOTION_ALIASES = {
  开心: 'happy',
  高兴: 'happy',
  快乐: 'happy',
  兴奋: 'excited',
  激动: 'excited',
  害羞: 'shy',
  难过: 'sad',
  伤心: 'sad',
  生气: 'angry',
  累: 'tired',
  困: 'tired',
  惊讶: 'surprised',
  吃惊: 'surprised',
  思考: 'thinking',
  温柔: 'gentle',
  平静: 'neutral'
}

/** 中文场景词 → 清单里的英文标签。 */
const SCENE_ALIASES = {
  早安: 'morning',
  早上: 'morning',
  晚安: 'night',
  晚上: 'night',
  吃饭: 'meal',
  午饭: 'noon',
  下午: 'afternoon',
  上班: 'work',
  工作: 'work',
  下班: 'work',
  告别: 'farewell',
  再见: 'farewell',
  安慰: 'comfort',
  夸: 'praise',
  打招呼: 'greeting',
  摸鱼: 'lazy',
  逗: 'tease'
}

/** 预计算的反向表：英文标签 → 能命中它的中文词。 */
function reverseAliases(table) {
  const reversed = {}
  for (const [zh, en] of Object.entries(table)) {
    reversed[en] = reversed[en] ?? []
    reversed[en].push(zh)
  }
  return reversed
}
const EMOTION_ZH = reverseAliases(EMOTION_ALIASES)
const SCENE_ZH = reverseAliases(SCENE_ALIASES)

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 表情条目 → 可嵌入的一段描述。中文别名帮助向量模型理解含义。 */
export function emojiSearchText(entry) {
  const id = typeof entry?.id === 'string' ? entry.id : ''
  const emotions = Array.isArray(entry?.emotions) ? entry.emotions.join(' ') : ''
  const scenes = Array.isArray(entry?.scenes) ? entry.scenes.join(' ') : ''
  return [id, emotions, scenes].filter((part) => part !== '').join(' ')
}

/** 本地匹配分：id 直接命中 > 情绪词命中 > 场景词命中 > 没命中。 */
export function localEmojiScore(entry, query) {
  const source = cleanText(query)
  if (source === '') return 0
  const id = typeof entry?.id === 'string' ? entry.id : ''
  if (source.includes(id) || id.includes(source)) return 1

  let score = 0
  const emotions = Array.isArray(entry?.emotions) ? entry.emotions : []
  for (const emotion of emotions) {
    const words = EMOTION_ZH[emotion] ?? []
    if (words.some((word) => source.includes(word)) || source.includes(emotion)) {
      score = Math.max(score, 0.75)
    }
  }
  const scenes = Array.isArray(entry?.scenes) ? entry.scenes : []
  for (const scene of scenes) {
    const words = SCENE_ZH[scene] ?? []
    if (words.some((word) => source.includes(word)) || source.includes(scene)) {
      score = Math.max(score, 0.5)
    }
  }
  return score
}

/**
 * @param {object} options
 * @param {Array<{id: string, file: string, emotions?: string[], scenes?: string[], weight?: number}>} options.catalog
 * @param {{scoreAll: (query: string, items: Array<{id: string, text: string}>) => Promise<Map<string, number>|null>}|null} [options.embedding]
 * @param {(message: string, error?: unknown) => void} [options.log]
 */
export function createEmojiSearch({
  catalog = [],
  embedding = null,
  log = () => {}
} = {}) {
  const entries = Array.isArray(catalog)
    ? catalog.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
    : []

  /**
   * 一句话 → 候选表情，按综合分降序。
   * 向量后端不可用时只用本地分；本地零命中时也返回空，不硬凑。
   */
  async function search(query, { limit = 5, minScore = 0 } = {}) {
    const text = cleanText(query)
    if (text === '') return []
    const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5
    const floor = Number.isFinite(minScore) ? Math.min(Math.max(minScore, 0), 1) : 0

    const local = new Map()
    for (const entry of entries) {
      const value = localEmojiScore(entry, text)
      if (value > 0) local.set(entry.id, value)
    }

    let semantic = null
    if (embedding !== null && typeof embedding?.scoreAll === 'function') {
      try {
        semantic = await embedding.scoreAll(text, entries.map((entry) => ({
          id: entry.id,
          text: emojiSearchText(entry)
        })))
      } catch (error) {
        log('表情语义检索失败，只用本地匹配', error)
      }
    }

    const scored = []
    for (const entry of entries) {
      const base = Math.max(local.get(entry.id) ?? 0, semantic?.get(entry.id) ?? 0)
      // 本地和语义都零命中就不硬凑：一句无关的话不该带出表情。
      if (base === 0) continue
      const weight = Number.isFinite(entry.weight) ? entry.weight : 1
      const score = base * weight
      if (score >= floor) scored.push({ id: entry.id, score, file: entry.file })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, max).map((item) => item.id)
  }

  return { search }
}
