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

/**
 * 群聊里认一个「共同点」需要几个不同的人。
 * 三个是下限：两个人可能只是刚好都说了一次，三个人开始像一种说法。
 */
const MIN_SPEAKERS = 3
/** 每个短语最多记多少个说话人的短标记，只用来去重，不存原始 id。 */
const MAX_SPEAKERS_PER_PHRASE = 10
/** 待审候选上限：一个人确认得完的量，不是仓库。 */
const MAX_PENDING = 40

/** 一眼不像人说的话：链接、广告、刷屏、纯符号。 */
const NOISE_TEXT = /https?:\/\/|www\.|公众号|加群|扫码|优惠|代购|代理|刷单|返利/

/**
 * 不学的东西：骂人、羞辱、性暗示、地域攻击。
 *
 * 这群人里如果有三个人都爱说某句脏话，按「共同点」的规则它会被选中。
 * 但那不是说话方式，是伤害。所以这类内容在入口就丢掉，不进入统计，
 * 也不进待审——待审是给「拿不准」的，这些是「确定不要」。
 *
 * 词表只做粗筛，宁可漏一点，也不想因为过度匹配把正常的词误杀。
 */
const REFUSE_TEXT = /操你|草你|日你|傻逼|傻b|煞笔|沙比|贱人|婊子|骚货|滚蛋|去死|死全家|nmsl|cnm|rnm|你妈死|地域黑/i

/** 含性暗示或成人内容的片段，不当口头禅。 */
const ADULT_TEXT = /裸|做爱|约炮|一夜情|开房|色情|黄片|av女/i

function looksHuman(text) {
  if (text.length < 2) return false
  if (NOISE_TEXT.test(text)) return false
  if (REFUSE_TEXT.test(text)) return false
  if (ADULT_TEXT.test(text)) return false
  if (!/[\u4e00-\u9fa5]/.test(text)) return false
  // 刷屏：同一个字连着出现四次以上。
  if (/(.)\1{3,}/.test(text)) return false
  return true
}

/** 说话人的短标记：只为在同一短语里区分不同的人，不可逆推回账号。 */
function speakerMark(value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

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
    // 先收三字片段：它会把自身的两字切片一起覆盖掉，
    // 免得「真的假」和「假的」当成两个不同的说法各算一次。
    const triples = []
    for (let i = 0; i + 3 <= segment.length; i += 1) {
      const piece = segment.slice(i, i + 3)
      if (STOPWORDS.has(piece)) continue
      if (NOISY_FRAGMENT.test(piece)) continue
      // 「吃饭吧」这种是句子尾巴，不是独立的口头禅。
      if (TAIL_PARTICLES.has(piece.slice(-1))) continue
      triples.push(piece)
      found.add(piece)
    }
    for (let i = 0; i + 2 <= segment.length; i += 1) {
      const piece = segment.slice(i, i + 2)
      if (STOPWORDS.has(piece)) continue
      if (NOISY_FRAGMENT.test(piece)) continue
      // 已经是某个三字片段的一截，就不再单独记。
      if (triples.some((tri) => tri.includes(piece))) continue
      found.add(piece)
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
    // 群聊标记：只有群里才要求「多个不同的人都这么说」。
    multi: false,
    // 群聊里「两个人说过、还没到三人」的说法，先进待审，不进提示词。
    pending: {},
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
  if (state.scopes[key] === undefined) {
    state.scopes[key] = { ...blankScope(), multi: key.startsWith('qq:group') }
  } else {
    // 旧版本写下的 scope 可能缺字段。缺什么补什么，
    // 免得一次升级之后，第一条消息就崩在 stats 里。
    const bucket = state.scopes[key]
    const blank = blankScope()
    for (const field of Object.keys(blank)) {
      if (bucket[field] === undefined || bucket[field] === null) bucket[field] = blank[field]
    }
    for (const field of ['punct', 'length', 'burst']) {
      if (typeof bucket[field] === 'object') bucket[field] = { ...blank[field], ...bucket[field] }
    }
  }
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
export function observeText(state, scope, text, at, speaker = '') {
  const clean = cleanText(text)
  if (clean === '') return state
  // 链接、广告、刷屏、纯符号不进样本：这些不是人说话的样子。
  if (!looksHuman(clean)) return state
  const { key, bucket } = ensureScope(state, scope)
  const multi = key.startsWith('qq:group')
  const mark = speakerMark(speaker)

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
    const item = bucket.phrases[piece] ?? { count: 0, messages: 0, lastAt: 0, speakers: {} }
    item.count += seen
    item.messages += 1
    item.lastAt = at
    // 群聊要记「有几个人这么说过」。只留短标记，不落原始账号。
    // 不设「消息数刷满就不记」的上限：同一个人刷得再多，也不该挡住新说话人进来。
    if (multi && mark !== '') {
      if (item.speakers === undefined) item.speakers = {}
      if (item.speakers[mark] === undefined && Object.keys(item.speakers).length < MAX_SPEAKERS_PER_PHRASE) {
        item.speakers[mark] = at
      }
      // 两个人说过、还差一个人确认的，先放进待审。
      // 这个列表不参与生成，只等主人看一眼：像回事就放行，不像就丢掉。
      const speakers = Object.keys(item.speakers).length
      // 凑够三个人就不再需要审了，从待审里撤掉。
      if (speakers >= MIN_SPEAKERS && bucket.pending[piece] !== undefined) {
        delete bucket.pending[piece]
      }
      if (speakers === 2 && bucket.pending[piece] === undefined && Object.keys(bucket.pending).length < MAX_PENDING) {
        bucket.pending[piece] = { count: item.count, speakers, at }
      }
    }
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
  const needSpeakers = bucket?.multi === true ? MIN_SPEAKERS : 1
  const eligible = Object.entries(bucket.phrases)
    .filter(([, item]) => {
      // 主人点头过的，不再要求三个人。
      if (item.approved === true) return true
      if ((item.count ?? 0) < PHRASE_MIN_COUNT) return false
      if ((item.messages ?? 0) < PHRASE_MIN_MESSAGES) return false
      // 群聊只收共同点：一个人反复说某个词，是他的口癖，不是这群人的说话方式。
      const speakers = Object.keys(item.speakers ?? {}).length
      return speakers >= needSpeakers
    })
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length)
  const kept = []
  for (const [text, item] of eligible) {
    if (kept.length >= limit) break
    const covered = kept.some((chosen) => {
      if (chosen.text.includes(text) || text.includes(chosen.text)) return true
      // 同一个词的错位切分：「真的假」和「的假的」字几乎一样，留一个就够。
      if (chosen.text.length === text.length) {
        const pool = new Set(chosen.text)
        let hit = 0
        for (const char of new Set(text)) if (pool.has(char)) hit += 1
        if (hit >= chosen.text.length - 1) return true
      }
      return false
    })
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

export function createSpeechHabitStore({
  filePath = null,
  legacyPath = null,
  now = Date.now,
  log = () => {},
  seal = null,
  open = null
} = {}) {
  let state = { version: 1, scopes: {}, learning: true }
  let loaded = false
  let dirty = false
  let saving = null
  let legacyPending = false
  // 变更计数：flush 靠它判断「写盘期间有没有新样本进来」。
  let mutation = 0
  // 最近一次读盘失败（非 ENOENT）的原因；坏文件隔离成功前禁止写盘覆盖。
  let loadError = null

  function markDirty() {
    dirty = true
    mutation += 1
  }

  function looksLikeState(value) {
    return value !== null && typeof value === 'object' && value.scopes !== null && typeof value.scopes === 'object'
  }

  /**
   * 读盘：先当密文解，解不开再当旧版明文读。
   *
   * 旧文件只在这里被读一次，下一次 flush 就写成密文，
   * 之后磁盘上不会再有可读的明文副本。
   */
  async function decodeFile(raw) {
    if (open !== null) {
      try {
        const plain = await open(JSON.parse(raw))
        if (looksLikeState(plain)) return plain
      } catch {
        // 密文仓还没起来，或者这本就是加密前的旧文件，往下按明文再试。
      }
    }
    return JSON.parse(raw)
  }

  /**
   * 返回 { ok, value } 而不是直接吞错：读失败（非 ENOENT）要留给 load()
   * 决定是否重试、是否禁止写盘，不能当成「没文件」糊弄过去。
   */
  async function readStateFile(target) {
    try {
      const raw = await fs.readFile(target, 'utf8')
      const parsed = await decodeFile(raw)
      return { ok: true, value: looksLikeState(parsed) ? parsed : null }
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: true, value: null }
      return { ok: false, error }
    }
  }

  function apply(parsed) {
    state = {
      version: 1,
      scopes: parsed.scopes,
      // 严格布尔：只有 true 才是开启；旧文件没写过这个字段时保持默认开启。
      learning: parsed.learning === undefined ? true : parsed.learning === true
    }
  }

  async function load() {
    if (loaded) return state
    if (filePath === null) {
      loaded = true
      return state
    }

    const current = await readStateFile(filePath)
    if (!current.ok) {
      // 读失败保持未加载，让下一次 load() 有机会重试；
      // 坏文件在写盘前会被先隔离，而不是被空状态覆盖。
      loadError = current.error
      log(`[habits] 读取失败，等待重试：${current.error?.message ?? current.error}`)
      return state
    }
    loadError = null
    loaded = true
    if (current.value !== null) {
      apply(current.value)
      return state
    }

    // 加密之前留下的明文文件：读一次接过来，等下一次落盘换成密文再删掉。
    if (legacyPath !== null && legacyPath !== filePath) {
      const legacy = await readStateFile(legacyPath)
      if (legacy.ok && legacy.value !== null) {
        apply(legacy.value)
        markDirty()
        legacyPending = true
        log('[habits] 读到旧明文习惯文件，下次落盘会改写成密文')
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
          const body = JSON.parse(
            JSON.stringify({ version: 1, scopes: state.scopes, learning: state.learning })
          )
          // 调用方给了密文仓就按信封写；没给（独立脚本、测试）才退回明文。
          const payload = JSON.stringify(seal === null ? body : await seal(body))
          const tmp = `${filePath}.tmp`
          await fs.mkdir(path.dirname(filePath), { recursive: true })
          await fs.writeFile(tmp, payload, 'utf8')
          await fs.rename(tmp, filePath)
          if (legacyPending && legacyPath !== null) {
            // 密文已经落稳，才删旧的明文。顺序反了会丢一轮学习结果。
            await fs.unlink(legacyPath).catch(() => {})
            legacyPending = false
          }
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

  function observe(scope, text, speaker = '') {
    // 总开关关掉时，连统计都不做：不是学完不用，是根本没在听。
    if (state.learning !== true) return state
    observeText(state, scope, text, now(), speaker)
    markDirty()
    return state
  }

  function note(scope) {
    return buildHabitNote(state, scope)
  }

  /** 设置页用：这一轮学到了什么，哪些还在等人点头。 */
  function list(scope = '') {
    const key = typeof scope === 'string' && scope.trim() !== '' ? scope.trim().slice(0, 80) : 'desktop'
    const bucket = state.scopes[key]
    if (bucket === undefined) return { adopted: [], pending: [], learning: learning() }
    const adopted = pickPhrases(bucket, 20).map((item) => ({
      text: item.text,
      count: item.count,
      approved: item.approved === true
    }))
    const pending = Object.entries(bucket.pending ?? {})
      .sort((a, b) => (b[1].count ?? 0) - (a[1].count ?? 0))
      .slice(0, 20)
      .map(([text, item]) => ({ text, count: item.count ?? 0, speakers: item.speakers ?? 0 }))
    return { adopted, pending, learning: learning() }
  }

  /**
   * 主人裁决一条待审。
   * 留下就标成 approved，直接进提示词；丢掉就从待审里删掉。
   */
  function resolve(scope, text, keep) {
    const key = typeof scope === 'string' && scope.trim() !== '' ? scope.trim().slice(0, 80) : 'desktop'
    const bucket = state.scopes[key]
    if (bucket === undefined) return { ok: false, reason: 'no_bucket' }
    if (typeof text !== 'string' || text === '') return { ok: false, reason: 'bad_text' }
    const pending = bucket.pending?.[text] !== undefined
    const adopted = bucket.phrases?.[text]?.approved === true
    if (!pending && !adopted) return { ok: false, reason: 'not_pending' }
    delete bucket.pending[text]
    if (keep === true) {
      const phrase = bucket.phrases[text] ?? { count: 0, messages: 0, lastAt: 0, speakers: {} }
      phrase.approved = true
      bucket.phrases[text] = phrase
    } else if (adopted && bucket.phrases?.[text] !== undefined) {
      // 已经会说的，也能收回：从短语表里彻底拿掉。
      delete bucket.phrases[text]
    }
    markDirty()
    return { ok: true }
  }

  /** 总开关：关掉就不再听任何人的说话方式。 */
  function setLearning(value) {
    // 严格布尔：只有 true 才是开启；0、null、"false" 这类假值一律按关闭处理。
    state.learning = value === true
    markDirty()
    return { ok: true, learning: state.learning }
  }

  function learning() {
    return state.learning === true
  }

  function snapshot(scope = '') {
    const wanted = typeof scope === 'string' ? scope.trim() : ''
    if (wanted !== '') return state.scopes[wanted] ?? null
    return state.scopes
  }

  function clear() {
    state = { version: 1, scopes: {}, learning: state.learning === true }
    markDirty()
  }

  return { load, observe, note, snapshot, clear, flush, list, resolve, setLearning, learning }
}
