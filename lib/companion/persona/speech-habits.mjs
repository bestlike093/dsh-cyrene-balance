import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 说话习惯：从她自己说过的句子里学一点语感。
 *
 * 只统计形状，不保存原句：
 * - 常挂在嘴边的 2~4 字短语
 * - 句尾爱用的语气词
 * - 标点习惯（用不用句号、省略号、波浪号）
 * - 句子长度与连发节奏
 *
 * 学到的东西只在提示词里占一小段，明确写「只借一点」。
 * 她的人格不因此改变，也不去假装自己是对方。
 */

const MAX_SCOPES = 12
const MAX_PHRASE_ENTRIES = 160
const MIN_SAMPLES = 12
const PHRASE_MIN_COUNT = 3
const PHRASE_MIN_MESSAGES = 2
const MAX_PHRASES_IN_NOTE = 4
const MAX_NOTE_LENGTH = 180
const BURST_WINDOW_MS = 25_000
const MAX_TEXT = 300

/** 只认会出现在句尾的语气词；「了」「的」这种太常见，学来也没味道。 */
const TAIL_PARTICLES = new Set(['呀', '啦', '呢', '吧', '啊', '哦', '嘛', '喔', '诶', '欸', '哈', '咯', '呐', '嘞', '哇'])

/**
 * 停用词：虚词、代词、时间词、口头填充。
 * 不拦这些，2 字统计里十有八九全是「今天」「可以」「就是」。
 */
const STOPWORDS = new Set([
  '一个', '一下', '一点', '一些', '一样', '一直', '一起', '一般',
  '这个', '那个', '这些', '那些', '这样', '那样', '这里', '那里', '这种', '那种',
  '什么', '怎么', '怎样', '为什么', '哪个', '哪些', '多少', '几个',
  '我们', '你们', '他们', '她们', '它们', '大家', '自己', '别人',
  '因为', '所以', '但是', '可是', '然后', '而且', '不过', '虽然', '如果', '要是', '而是', '就是', '还是', '也是', '只是', '不是',
  '已经', '没有', '可以', '应该', '需要', '必须', '可能', '也许', '大概', '其实', '真的', '确实',
  '今天', '明天', '昨天', '现在', '刚才', '最近', '以后', '以前', '时候', '时间',
  '知道', '觉得', '认为', '感觉', '看到', '听到', '想到', '说', '做', '用',
  '东西', '地方', '事情', '问题', '情况', '样子', '感觉',
  '还有', '以及', '或者', '并且', '于是', '这样', '那样',
  '好的', '好啊', '行吧', '嗯嗯', '哈哈', '呵呵', '嘿嘿'
])

/** 含人称、数字、英文的片段一律不当口头禅，噪声太大。 */
const NOISY_FRAGMENT = /[0-9a-zA-Z你我他她它您]/

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)
}

/** 切出连续的汉字段，标点、空白、表情都当分隔符。 */
function hanSegments(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00ff]/g, ' ')
    .split(/\s+/)
    .map((item) => item.replace(/[^\u4e00-\u9fa5]/g, ''))
    .filter((item) => item.length >= 2)
}

/** 一条消息里出现过的 2~3 字候选，同一条里重复只计一次。 */
export function extractCandidates(text) {
  const found = new Set()
  for (const segment of hanSegments(text)) {
    // 只统计到 3 字：4 字片段多半是整句的一部分，当成口头禅会越学越像复读。
    for (let size = 2; size <= 3; size += 1) {
      for (let i = 0; i + size <= segment.length; i += 1) {
        const piece = segment.slice(i, i + size)
        if (STOPWORDS.has(piece)) continue
        if (NOISY_FRAGMENT.test(piece)) continue
        // 「吃饭吧」这种是句子尾巴，不是独立的口头禅；去掉语气词后的「吃饭」才留下。
        if (size >= 3 && TAIL_PARTICLES.has(piece.slice(-1))) continue
        found.add(piece)
      }
    }
  }
  return [...found]
}

/** 句尾那个字：先剥掉标点和空白，再看是不是语气词。 */
export function tailParticle(text) {
  const cleaned = String(text ?? '').replace(/[\s。！？!?…~～.,，、；;：:"'“”‘’）)】\]】]+$/g, '')
  const last = cleaned.slice(-1)
  return TAIL_PARTICLES.has(last) ? last : ''
}

function blankScope() {
  return {
    samples: 0,
    phrases: {},
    endings: {},
    punct: { total: 0, ellipsis: 0, wave: 0, exclaim: 0, question: 0, period: 0, comma: 0, bare: 0 },
    length: { sum: 0, count: 0 },
    burst: { hits: 0, total: 0 },
    lastAt: 0,
    mentionAt: 0
  }
}

function ensureScope(state, scope) {
  const key = typeof scope === 'string' && scope.trim() !== '' ? scope.trim().slice(0, 80) : 'desktop'
  if (state.scopes[key] === undefined) state.scopes[key] = blankScope()
  return { key, bucket: state.scopes[key] }
}

function trimPhrases(bucket) {
  const entries = Object.entries(bucket.phrases)
  if (entries.length <= MAX_PHRASE_ENTRIES) return
  entries.sort((a, b) => (b[1].count ?? 0) - (a[1].count ?? 0))
    .slice(MAX_PHRASE_ENTRIES)
    .forEach(([key]) => {
      delete bucket.phrases[key]
    })
}

function trimScopes(state) {
  const keys = Object.keys(state.scopes)
  if (keys.length <= MAX_SCOPES) return
  keys
    .sort((a, b) => (state.scopes[a].mentionAt ?? 0) - (state.scopes[b].mentionAt ?? 0))
    .slice(0, keys.length - MAX_SCOPES)
    .forEach((key) => {
      delete state.scopes[key]
    })
}

/**
 * 收下一句她自己说的话。纯函数式地改 state（store 内部使用）。
 * 群聊不进来：群里说话的是很多人，混在一起学不出「她自己」。
 */
export function observeText(state, scope, text, at) {
  const clean = cleanText(text)
  if (clean === '') return state
  const { bucket } = ensureScope(state, scope)

  const pieces = extractCandidates(clean)
  // count 与 messages 分开记：count 是「出现了几次」，messages 是「出现在几条消息里」。
  // 同一条消息里重复出现的短语只算一条消息、多次出现，两个字段不再恒等。
  const segments = hanSegments(clean)
  for (const piece of pieces) {
    let seen = 0
    for (const segment of segments) {
      let from = 0
      while (from <= segment.length - piece.length) {
        const hit = segment.indexOf(piece, from)
        if (hit === -1) break
        seen += 1
        from = hit + 1
      }
    }
    const item = bucket.phrases[piece] ?? { count: 0, messages: 0, lastAt: 0 }
    item.count += seen
    item.messages += 1
    item.lastAt = at
    bucket.phrases[piece] = item
  }

  const tail = tailParticle(clean)
  if (tail !== '') bucket.endings[tail] = (bucket.endings[tail] ?? 0) + 1

  const punct = bucket.punct
  punct.total += 1
  if (/…|\.{3,}/.test(clean)) punct.ellipsis += 1
  if (/[~～]/.test(clean)) punct.wave += 1
  if (/[！!]/.test(clean)) punct.exclaim += 1
  if (/[？?]/.test(clean)) punct.question += 1
  if (/。/.test(clean)) punct.period += 1
  if (/[，,]/.test(clean)) punct.comma += 1
  if (!/[。！？!?]/.test(clean)) punct.bare += 1

  const visible = clean.replace(/\s+/g, '')
  bucket.length.sum += visible.length
  bucket.length.count += 1

  // 连发：上一条刚说完没多久，这一条又短，多半是把一句话拆成了几条。
  bucket.burst.total += 1
  if (bucket.lastAt > 0 && at - bucket.lastAt <= BURST_WINDOW_MS && visible.length <= 25) {
    bucket.burst.hits += 1
  }
  bucket.lastAt = at
  bucket.mentionAt = at
  bucket.samples += 1

  trimPhrases(bucket)
  trimScopes(state)
  return state
}

/** 从统计里挑几个真正常用的短语。长短语优先，避免「好家」压过「好家伙」。 */
export function pickPhrases(bucket, limit = MAX_PHRASES_IN_NOTE) {
  const eligible = Object.entries(bucket.phrases)
    .filter(([, item]) => (item.count ?? 0) >= PHRASE_MIN_COUNT && (item.messages ?? 0) >= PHRASE_MIN_MESSAGES)
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length)
  const kept = []
  for (const [text, item] of eligible) {
    if (kept.length >= limit) break
    const covered = kept.some((chosen) => chosen.text.includes(text) || text.includes(chosen.text))
    if (covered) continue
    kept.push({ text, count: item.count })
  }
  return kept
}

/**
 * 整段太长时在短语边界截断：找截断范围内最后一个完整引号或顿号，
 * 宁短勿切半，别让模型看到半个词。
 */
function clipNote(note) {
  if (note.length <= MAX_NOTE_LENGTH) return note
  const head = note.slice(0, MAX_NOTE_LENGTH)
  let cut = -1
  for (let i = head.length - 1; i >= 0; i -= 1) {
    const ch = head[i]
    if (ch === '」' || ch === '、' || ch === '，' || ch === '。') {
      cut = i
      break
    }
  }
  return cut > 0 ? head.slice(0, cut) : head
}

/** 生成给模型看的那一小段；样本不够就什么都不说。 */
export function buildHabitNote(state, scope) {
  const key = typeof scope === 'string' && scope.trim() !== '' ? scope.trim().slice(0, 80) : 'desktop'
  const bucket = state.scopes?.[key]
  if (bucket === undefined) return ''
  if (bucket.samples < MIN_SAMPLES) return ''

  const lines = []
  const phrases = pickPhrases(bucket)
  if (phrases.length > 0) {
    lines.push(`常挂在嘴边：${phrases.map((item) => `「${item.text}」`).join('、')}`)
  }

  const endings = Object.entries(bucket.endings)
    .filter(([, count]) => count >= 3 && count / Math.max(1, bucket.samples) >= 0.08)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([word]) => `「${word}」`)
  if (endings.length > 0) lines.push(`句尾容易带上：${endings.join('、')}`)

  const punct = bucket.punct
  const total = Math.max(1, punct.total)
  const habits = []
  if (punct.period / total < 0.15) habits.push('很少打句号')
  if (punct.ellipsis / total >= 0.2) habits.push('常用省略号')
  if (punct.wave / total >= 0.1) habits.push('会用波浪号')
  if (punct.bare / total >= 0.6) habits.push('句末常常什么都不加')
  const avgLength = bucket.length.count > 0 ? bucket.length.sum / bucket.length.count : 0
  if (avgLength > 0 && avgLength <= 12) habits.push('句子偏短')
  else if (avgLength >= 32) habits.push('习惯把一句说完')
  if (bucket.burst.total >= 6 && bucket.burst.hits / bucket.burst.total >= 0.3) habits.push('常把一句话拆成几条发')
  if (habits.length > 0) lines.push(`打字习惯：${habits.join('，')}`)

  if (lines.length === 0) return ''
  const note = [
    '你平时说话的样子（只是语感参考，别照搬，也别为了像她而改掉自己的说法）：',
    ...lines.map((line) => `- ${line}`)
  ].join('\n')
  return clipNote(note)
}

export function createSpeechHabitStore({ filePath = null, now = Date.now, log = () => {} } = {}) {
  let state = { version: 1, scopes: {} }
  let loaded = false
  let dirty = false
  let saving = null
  // 变更计数：flush 靠它判断「写盘期间有没有新样本进来」。
  let mutation = 0
  // 最近一次读盘失败（非 ENOENT）的原因；坏文件隔离成功前禁止写盘覆盖。
  let loadError = null

  function markDirty() {
    dirty = true
    mutation += 1
  }

  async function load() {
    if (loaded) return state
    if (filePath === null) {
      loaded = true
      return state
    }
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && parsed.scopes !== null && typeof parsed.scopes === 'object') {
        state = { version: 1, scopes: parsed.scopes }
      }
      loadError = null
      loaded = true
    } catch (error) {
      if (error?.code === 'ENOENT') {
        // 文件本来就不存在，属于首次启动，直接按空白开始。
        loadError = null
        loaded = true
      } else {
        // 读失败保持未加载，让下一次 load() 有机会重试；
        // 坏文件在写盘前会被先隔离，而不是被空状态覆盖。
        loadError = error
        loaded = false
        log(`[habits] 读取失败，等待重试：${error?.message ?? error}`)
      }
    }
    return state
  }

  async function flush() {
    if (filePath === null || !dirty) return { ok: true }
    if (saving !== null) return await saving
    saving = (async () => {
      try {
        // 读盘失败过的坏文件不能直接覆盖：先改名隔离，改不了名就这次不写。
        if (loadError !== null) {
          try {
            await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`)
            loadError = null
          } catch (error) {
            if (error?.code === 'ENOENT') {
              // 文件已经不在了，没有可覆盖的坏文件，放行这次写入。
              loadError = null
            } else {
              log(`[habits] 坏文件隔离失败，本次跳过写入：${error?.message ?? error}`)
              return { ok: false, error: String(error?.message ?? error) }
            }
          }
        }
        // 写盘期间可能又有新样本进来：每轮先冻结一份快照，
        // 写完后版本号没变才敢清 dirty；变了就带着最新状态再补写一轮。
        while (dirty) {
          const versionAtStart = mutation
          const payload = JSON.stringify(JSON.parse(JSON.stringify({ version: 1, scopes: state.scopes })))
          const tmp = `${filePath}.tmp`
          await fs.mkdir(path.dirname(filePath), { recursive: true })
          await fs.writeFile(tmp, payload, 'utf8')
          await fs.rename(tmp, filePath)
          if (mutation === versionAtStart) {
            dirty = false
            break
          }
          // 版本号变了说明保存期间有新增量，保留 dirty 再写一轮。
        }
        return { ok: true }
      } catch (error) {
        log(`[habits] 保存失败：${error?.message ?? error}`)
        return { ok: false, error: String(error?.message ?? error) }
      } finally {
        saving = null
      }
    })()
    return await saving
  }

  function observe(scope, text, at = now()) {
    // 群聊不采样：那里混着很多人的话，学出来不像她，也不该拿别人的口癖。
    if (typeof scope === 'string' && scope.startsWith('qq:group')) return state
    observeText(state, scope, text, at)
    markDirty()
    return state
  }

  function note(scope) {
    return buildHabitNote(state, scope)
  }

  function snapshot(scope = '') {
    const wanted = typeof scope === 'string' ? scope.trim() : ''
    if (wanted !== '') return state.scopes[wanted] ?? null
    return state.scopes
  }

  function clear() {
    state = { version: 1, scopes: {} }
    markDirty()
  }

  return { load, observe, note, snapshot, clear, flush }
}
