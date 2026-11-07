/**
 * 社交语感：唤醒词、群聊说话方式、梗、黑话、记忆闸门。
 *
 * 这一层只做「判断」和「写提示词」，不读写盘、不发请求：
 * - 唤醒词在本地剥掉，模型看不到「昔涟」两个字被当成正文；
 * - 群聊画像是统计算出来的，不猜；
 * - 梗只认「跨人重复出现」的短语，避免把一次口误当梗；
 * - 谐音、黑话、缩写只标「疑似」，让模型自己决定接不接；
 * - 记忆闸门先排除寒暄、临时状态、玩笑、转述和密钥，剩下的才交给抽取。
 *
 * 任何一项拿不到都返回空结果，不抛错，不影响主链。
 */

import { MEME_STOP_WORDS } from '@pet/shared'

const DEFAULT_WAKE_WORDS = ['昔涟', '迷迷', '德谬歌', '小涟']

/** 寒暄与低信息短句：不进入记忆。 */
const GREETING_PATTERN = /^(在吗|在不在|早安|早上好|晚安|晚上好|午安|哈+|嘿+|hi|hello|好|好的|行|嗯+|哦+|收到|谢谢|多谢|辛苦了|牛的|666|233+)[。！!？?~～…\s]*$/i

/** 临时状态：只在当下有意义，写进长期记忆会变成噪音。 */
const TEMPORARY_PATTERN =
  /(今天|刚刚|刚才|现在|这会儿|等下|待会|马上|正在).{0,8}(累|困|饿|渴|忙|加班|吃饭|洗澡|上班|下班|上课|通勤|路上|躺|睡|摸鱼|开会)/

/** 玩笑、反讽、角色扮演：说出来不代表是真的。 */
const JOKE_PATTERN = /(开玩笑|开个玩笑|狗头|doge|绷不住|笑死|乐死|整活|玩梗|演一下|假装)/i
const ROLEPLAY_PATTERN = /(\*[^*]{1,30}\*|（[^）]{0,20}(笑|哭|叹气|摆手|耸肩)[^）]{0,20}）)/

/** 转述别人的话：可以记「这个人是谁」，不能记成用户自己的事实。 */
const QUOTE_PATTERN = /(我朋友|我同学|我同事|我室友|他说|她说|他们说|群里有人说|有人说过)/

/** 未兑现的打算：可以记成「想做」，不能记成「已经在做」。 */
const PLAN_PATTERN = /(打算|准备|计划|想着|可能会|也许会|以后要|将来要)/

/** 凭据类内容一律不落记忆。 */
const SECRET_PATTERN =
  /(密码|口令|验证码|密钥|token|api[_-]?key|sk-[A-Za-z0-9_-]{8,}|身份证|银行卡|手机号)/i

/** 明确要求记住。 */
const EXPLICIT_REMEMBER_PATTERN = /(记住|记一下|别忘|不要忘|帮我记|以后记得)/

/**
 * 明确要求忘掉。只认祈使句，不认叙述：
 * 「我忘了带钥匙」这类长句不触发，避免把普通聊天当成删除指令。
 */
const EXPLICIT_FORGET_PATTERN =
  /(^|[，。！？!?、\s])(请|麻烦)?(你)?(把)?(刚才|刚刚|之前|上面|上一条|这条|这个|那些|这些)?(说的|聊的|记的)?(那个|这条|这个|内容|事情|事|那句)?\s*(忘掉|忘了|忘记|删掉|删了|删除|别记|不要记|别记住|不用记|别再提)(吧|掉|一下|这条|这个|它|这件事)?[。！!？?~～…\s]*$/

/** 稳定偏好。 */
const PREFERENCE_PATTERN = /(喜欢|讨厌|最爱|不吃|不能吃|过敏|受不了|偏爱|习惯)/

/** 稳定事实。 */
const FACT_PATTERN = /(生日|住在|老家|职业|工作|上学|专业|名字|叫|家人|爸妈|养了|有一只)/

/** 约定与承诺。 */
const PROMISE_PATTERN = /(说好|约好|答应|下次|以后每周|每周|每天|周五|周六|周日|月底|见面)/

/** 关系变化。 */
const RELATION_PATTERN = /(我们|你和我|咱俩|关系|信任|依赖|想你|陪你)/

/** 常见黑话与网络缩写：只做提示，不解释含义。 */
const SLANG_WORDS = [
  'yyds',
  'xswl',
  'awsl',
  'u1s1',
  '绝绝子',
  '栓q',
  '蚌埠住了',
  '破防',
  'emo',
  'e人',
  'i人',
  '搭子',
  '显眼包',
  '纯爱战神',
  '电子榨菜',
  '嘴替',
  '上强度',
  '掉 san',
  '量子纠缠',
  '精神状态'
]

/** 数字谐音与梗数字：看到就提醒模型「这可能是梗」。 */
const NUMBER_PLAY_PATTERN = /(520|521|666|888|233+|996|114514|4399|555+)/

/** 拼音首字母缩写：连续 2-5 个大写字母，且不是常见英文词。 */
const ACRONYM_PATTERN = /\b[A-Z]{2,5}\b/

function asText(value) {
  return typeof value === 'string' ? value : ''
}

/** 全角转半角，只处理会影响匹配的字符。 */
export function normalizeText(text) {
  return asText(text)
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .trim()
}

/**
 * 唤醒词匹配。
 *
 * 支持「昔涟」「@昔涟」「昔涟，在吗」三种写法；命中后把唤醒词和紧跟的标点剥掉，
 * 剩下的才是要给模型看的正文。不在开头也算命中，但会标 atStart=false，
 * 方便上层决定「群里被点名」还是「聊天里顺口提到」。
 */
export function matchWake(text, options = {}) {
  const source = asText(text)
  const words = Array.isArray(options.words) && options.words.length > 0 ? options.words : DEFAULT_WAKE_WORDS
  const plain = normalizeText(source)
  if (plain === '') return { woken: false, word: '', text: source, atStart: false }

  let best = null
  for (const raw of words) {
    const word = asText(raw).trim()
    if (word === '') continue
    const index = plain.toLowerCase().indexOf(word.toLowerCase())
    if (index < 0) continue
    if (best === null || index < best.index || (index === best.index && word.length > best.word.length)) {
      best = { index, word }
    }
  }
  if (best === null) return { woken: false, word: '', text: source, atStart: false }

  const before = plain.slice(0, best.index)
  const after = plain.slice(best.index + best.word.length)
  const stripped = `${before}${after}`
    .replace(/^[\s@＠,，。.!！?？:：、~～…-]+/, '')
    .replace(/^的/, '')
    .trim()

  return {
    woken: true,
    word: best.word,
    text: stripped,
    atStart: best.index === 0 || /^@\s*$/.test(before)
  }
}

/** 句尾有没有标点。用来判断「这群人打字带不带句号」。 */
function hasEndPunctuation(text) {
  return /[。.!！?？~～…]$/.test(text)
}

/**
 * 学一群人的说话方式。
 *
 * 只统计能直接看到的东西：句子多长、用不用标点、爱不爱用 emoji、
 * 常出现的语气词和高频短语；再加格式维度：@ 人、发表情、连发条数、接话间隔。
 * 样本太少时返回 sampleSize，让调用方别当真。
 */
export function analyzeStyle(messages) {
  const list = Array.isArray(messages) ? messages.filter((item) => item && typeof item.text === 'string') : []
  const texts = list.map((item) => item.text.trim()).filter((text) => text !== '')
  if (texts.length === 0) {
    return {
      sampleSize: 0,
      avgLength: 0,
      shortRatio: 0,
      emojiRatio: 0,
      punctuationRatio: 0,
      particles: [],
      frequentPhrases: [],
      mentionRatio: 0,
      imageRatio: 0,
      burst: { one: 0, two: 0, threePlus: 0, avg: 1 },
      avgGapSeconds: 0,
      openers: [],
      closers: []
    }
  }

  let totalLength = 0
  let short = 0
  let emoji = 0
  let punctuated = 0
  let mentioned = 0
  let withImage = 0
  const particleCount = new Map()

  for (const item of list) {
    const text = item.text.trim()
    if (text === '') continue
    totalLength += Array.from(text).length
    if (Array.from(text).length <= 8) short += 1
    if (/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(text)) emoji += 1
    if (hasEndPunctuation(text)) punctuated += 1
    if (item.mentioned === true) mentioned += 1
    if (Number(item.imageCount) > 0) withImage += 1
    for (const particle of ['哈哈', 'hhh', '呀', '啦', '呢', '吧', '嘛', '啊', '哦', '诶', '草', '笑死']) {
      if (text.includes(particle)) particleCount.set(particle, (particleCount.get(particle) ?? 0) + 1)
    }
  }

  const particles = [...particleCount.entries()]
    .filter(([, count]) => count >= Math.max(2, Math.ceil(texts.length * 0.2)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)

  return {
    sampleSize: texts.length,
    avgLength: Math.round((totalLength / texts.length) * 10) / 10,
    shortRatio: Math.round((short / texts.length) * 100) / 100,
    emojiRatio: Math.round((emoji / texts.length) * 100) / 100,
    punctuationRatio: Math.round((punctuated / texts.length) * 100) / 100,
    particles,
    frequentPhrases: frequentPhrases(texts, 4),
    mentionRatio: Math.round((mentioned / texts.length) * 100) / 100,
    imageRatio: Math.round((withImage / texts.length) * 100) / 100,
    burst: analyzeBurst(list),
    avgGapSeconds: averageGapSeconds(list),
    openers: edgeWords(texts, 'open'),
    closers: edgeWords(texts, 'close')
  }
}

/** 同一个人连着说几条：这群人是「一句一句发」还是「一段一段发」。 */
function analyzeBurst(messages) {
  const runs = []
  let currentSpeaker = ''
  let currentRun = 0
  for (const item of messages) {
    if (item.text.trim() === '') continue
    const speaker = asText(item.speaker) || '匿名'
    if (speaker === currentSpeaker) {
      currentRun += 1
    } else {
      if (currentRun > 0) runs.push(currentRun)
      currentSpeaker = speaker
      currentRun = 1
    }
  }
  if (currentRun > 0) runs.push(currentRun)
  if (runs.length === 0) return { one: 0, two: 0, threePlus: 0, avg: 1 }
  const one = runs.filter((count) => count === 1).length
  const two = runs.filter((count) => count === 2).length
  const threePlus = runs.filter((count) => count >= 3).length
  const total = runs.reduce((sum, count) => sum + count, 0)
  return {
    one: Math.round((one / runs.length) * 100) / 100,
    two: Math.round((two / runs.length) * 100) / 100,
    threePlus: Math.round((threePlus / runs.length) * 100) / 100,
    avg: Math.round((total / runs.length) * 10) / 10
  }
}

/**
 * 接话间隔：只看 15 分钟以内的相邻消息。
 * 隔了半天再说话是「又开了一个话题」，不是「接话慢」。
 */
function averageGapSeconds(messages) {
  const gaps = []
  for (let index = 1; index < messages.length; index += 1) {
    const prev = Number(messages[index - 1]?.at)
    const next = Number(messages[index]?.at)
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue
    const seconds = (next - prev) / 1000
    if (seconds >= 0 && seconds <= 900) gaps.push(seconds)
  }
  if (gaps.length === 0) return 0
  return Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length)
}

/** 常用开头 / 结尾词：固定看两个字，出现至少 3 次才记。 */
function edgeWords(texts, edge) {
  const counts = new Map()
  for (const text of texts) {
    const chars = Array.from(text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ''))
    if (chars.length < 2) continue
    const word = edge === 'open' ? chars.slice(0, 2).join('') : chars.slice(-2).join('')
    if (MEME_STOP_WORDS.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word)
}

/** 高频短语：2-6 个汉字，出现至少 3 次，去掉常用词。 */
function frequentPhrases(texts, limit) {
  const counts = new Map()
  for (const text of texts) {
    const chars = Array.from(text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' '))
    for (let size = 2; size <= 6; size += 1) {
      for (let index = 0; index + size <= chars.length; index += 1) {
        const slice = chars.slice(index, index + size).join('')
        if (slice.includes(' ')) continue
        if (MEME_STOP_WORDS.has(slice)) continue
        counts.set(slice, (counts.get(slice) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .filter(([phrase, count]) => count >= 3 && prefixFree(phrase, counts))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }))
}

/** 子串如果只是因为包含更长的重复片段才高频，就不要再单独列出来。 */
function prefixFree(phrase, counts) {
  for (const [other, count] of counts) {
    if (other.length > phrase.length && other.includes(phrase) && count >= (counts.get(phrase) ?? 0)) {
      return false
    }
  }
  return true
}

/**
 * 整句都是口头禅拼起来的，不算梗。
 * 例：「哈哈确实」由「哈哈」+「确实」组成，去掉常用词后什么都不剩。
 */
function isStopPhrase(phrase) {
  let rest = phrase
  const words = [...MEME_STOP_WORDS].sort((a, b) => b.length - a.length)
  for (const word of words) rest = rest.split(word).join('')
  return rest.length < 2
}

/** 把统计结果写成一句人话，给模型看。 */
export function describeStyle(stats) {
  if (!stats || stats.sampleSize < 5) return ''
  const parts = [`这群人说话平均 ${stats.avgLength} 个字`]
  if (stats.shortRatio >= 0.5) parts.push('短句居多')
  if (stats.punctuationRatio <= 0.3) parts.push('经常不打句号')
  if (stats.emojiRatio >= 0.25) parts.push('爱用 emoji')
  if (stats.mentionRatio >= 0.15) parts.push('常 @ 人')
  if (stats.imageRatio >= 0.2) parts.push('常发表情包')
  if (stats.burst?.threePlus >= 0.2) parts.push('常连着发两三条')
  else if (stats.burst?.avg >= 1.8) parts.push('习惯分成几条发')
  if (stats.avgGapSeconds > 0 && stats.avgGapSeconds <= 60) parts.push('接话很快')
  const detail = parts.join('，')
  const particles = Array.isArray(stats.particles) && stats.particles.length > 0 ? `；常带「${stats.particles.join('」「')}」` : ''
  const phrases =
    Array.isArray(stats.frequentPhrases) && stats.frequentPhrases.length > 0
      ? `；反复出现「${stats.frequentPhrases.map((item) => item.phrase).join('」「')}」`
      : ''
  const edges = []
  if (Array.isArray(stats.openers) && stats.openers.length > 0) edges.push(`常用开头「${stats.openers.join('」「')}」`)
  if (Array.isArray(stats.closers) && stats.closers.length > 0) edges.push(`常用结尾「${stats.closers.join('」「')}」`)
  const edgeText = edges.length > 0 ? `；${edges.join('，')}` : ''
  return `${detail}${particles}${phrases}${edgeText}。`
}

/**
 * 把统计翻译成「这一条具体怎么发」：分几条、要不要 @、要不要带表情。
 * 只给建议，不替模型写内容。
 */
export function describeFormatAdvice(stats) {
  if (!stats || stats.sampleSize < 5) return ''
  const advice = []
  if (stats.burst?.avg >= 2.2 && stats.burst?.threePlus >= 0.25) {
    advice.push('可以分 2 条，但别超过 3 条')
  } else if (stats.burst?.avg >= 1.5) {
    advice.push('分成 2 条更自然')
  } else {
    advice.push('一条说完')
  }
  if (stats.mentionRatio >= 0.25) advice.push('叫到具体的人时 @ 上')
  if (stats.imageRatio >= 0.25) advice.push('可以用一个表情包收尾')
  if (Array.isArray(stats.openers) && stats.openers.length > 0) {
    advice.push(`开头可以像「${stats.openers[0]}」这样起`)
  }
  if (stats.avgGapSeconds > 0 && stats.avgGapSeconds <= 30) advice.push('接话别拖')
  return advice.join('；')
}

/**
 * 找梗：跨至少两个人、出现至少三次的短语。
 *
 * 一个人反复说同一句，更可能是口头禅；两个以上的人都在用，才像群里的梗。
 */
export function extractMemeCandidates(messages, options = {}) {
  const minCount = Number.isFinite(options.minCount) ? options.minCount : 3
  const minSpeakers = Number.isFinite(options.minSpeakers) ? options.minSpeakers : 2
  const list = Array.isArray(messages) ? messages.filter((item) => item && typeof item.text === 'string') : []

  const buckets = new Map()
  for (const item of list) {
    const speaker = asText(item.speaker) || '匿名'
    const text = item.text
    for (let size = 2; size <= 6; size += 1) {
      const chars = Array.from(text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' '))
      for (let index = 0; index + size <= chars.length; index += 1) {
        const phrase = chars.slice(index, index + size).join('')
        if (phrase.includes(' ')) continue
        if (MEME_STOP_WORDS.has(phrase)) continue
        const bucket = buckets.get(phrase) ?? { phrase, count: 0, speakers: new Set(), examples: [] }
        bucket.count += 1
        bucket.speakers.add(speaker)
        if (bucket.examples.length < 2) bucket.examples.push(text.slice(0, 40))
        buckets.set(phrase, bucket)
      }
    }
  }

  return [...buckets.values()]
    .filter((item) => item.count >= minCount && item.speakers.size >= minSpeakers)
    .filter((item) => !isStopPhrase(item.phrase))
    .filter((item) => prefixFree(item.phrase, new Map([...buckets].map(([key, value]) => [key, value.count]))))
    .sort((a, b) => b.speakers.size - a.speakers.size || b.count - a.count)
    .slice(0, Number.isFinite(options.limit) ? options.limit : 5)
    .map((item) => ({
      phrase: item.phrase,
      count: item.count,
      speakers: [...item.speakers],
      examples: item.examples
    }))
}

/**
 * 识别「这里可能在玩语言」：谐音、黑话、缩写、数字梗。
 *
 * 只标疑似，不给结论。模型看到这张小卡片后，可以选择顺着接、追问，
 * 或者干脆不接——比硬解释一个自己没听懂的梗安全。
 */
export function detectLanguagePlay(text) {
  const source = asText(text)
  if (source === '') return { slang: [], acronyms: [], numberPlay: [], likelyPlayful: false }

  const lower = source.toLowerCase()
  const slang = SLANG_WORDS.filter((word) => lower.includes(word.toLowerCase()))
  const acronyms = (source.match(new RegExp(ACRONYM_PATTERN.source, 'g')) ?? [])
    .filter((word) => !/^(OK|QQ|TV|APP|PC|AI)$/i.test(word))
    .slice(0, 4)
  const numberPlay = source.match(new RegExp(NUMBER_PLAY_PATTERN.source, 'g')) ?? []
  const quoted = /[「『"'][^」』"']{2,10}[」』"']/.test(source)
  const likelyPlayful = slang.length > 0 || acronyms.length > 0 || numberPlay.length > 0 || quoted

  return { slang, acronyms, numberPlay: [...new Set(numberPlay)], likelyPlayful }
}

/**
 * 纠正句式：对方在指出「你刚才说错了 / 不该这样」。
 *
 * 只认明确指向上一轮或明确纠错的说法，避免把「我不是学生，是老师」这种自我介绍
 * 当成对 AI 的纠正。命中后写成一条 lesson，下一轮提示词会提醒不要重犯。
 */
const CORRECTION_PATTERN =
  /(你(?:刚才|刚刚)?说错|不对(?:吧)?[，,。！!]|说错了|记错了|搞错了|不是这个意思|别这么说|别这样说|不要这样说|下次(?:要|别|不要)|以后(?:要|别|不要)|应该(?:是|说|叫)|你(?:刚才|刚刚)?(?:不是|说))/
const CORRECTION_QUIZ = /(是不是|对不对|好不好|行不行)[^。！!]*[？?]\s*$/

export function detectCorrection(text) {
  const source = asText(text).trim().replace(/\s+/g, ' ')
  if (source === '') return { corrected: false }
  const chars = Array.from(source).length
  if (chars < 4 || chars > 120) return { corrected: false }
  if (CORRECTION_QUIZ.test(source)) return { corrected: false }
  if (!CORRECTION_PATTERN.test(source)) return { corrected: false }

  // 「不是 A，是 B」是信息量最高的形态，直接把错的和对的都记下来。
  const pair = /不是(.{1,30}?)[，,。 ]*(?:是|而是)(.{1,30})/.exec(source)
  const lesson =
    pair === null
      ? `对方纠正过：${source}`
      : `对方纠正过：不是「${pair[1].trim()}」，是「${pair[2].trim()}」`
  return {
    corrected: true,
    wrong: pair === null ? '' : pair[1].trim(),
    right: pair === null ? '' : pair[2].trim(),
    text: lesson.slice(0, 160)
  }
}

/**
 * 记忆闸门：这句话值不值得记。
 *
 * 默认不记。只有明确偏好、稳定事实、约定、关系变化或用户点名要记，才放行。
 * 排除的每一类都给出 reason，设置页可以显示「为什么没记」。
 */
export function classifyMemory(text, options = {}) {
  const source = asText(text).trim()
  const minLength = Number.isFinite(options.minLength) ? options.minLength : 4
  const reject = (reason) => ({ include: false, kind: 'other', reason, confidence: 0 })

  if (source === '') return reject('empty')
  // 先认寒暄与「别记这个」：这两类都不该被当成普通内容处理。
  if (GREETING_PATTERN.test(normalizeText(source))) return reject('greeting')
  if (EXPLICIT_FORGET_PATTERN.test(normalizeText(source))) {
    return { include: false, kind: 'other', reason: 'explicit_forget', confidence: 1 }
  }
  if (Array.from(source).length < minLength) return reject('too_short')
  if (SECRET_PATTERN.test(source)) return reject('secret')
  if (ROLEPLAY_PATTERN.test(source)) return reject('roleplay')
  if (JOKE_PATTERN.test(source)) return reject('joke')
  if (TEMPORARY_PATTERN.test(source)) return reject('temporary')
  if (QUOTE_PATTERN.test(source)) return reject('quoted_other')
  if (PLAN_PATTERN.test(source)) return { include: false, kind: 'promise', reason: 'unfulfilled_plan', confidence: 0.2 }

  if (EXPLICIT_REMEMBER_PATTERN.test(source)) {
    return { include: true, kind: 'preference', reason: 'explicit_request', confidence: 0.95 }
  }
  if (PREFERENCE_PATTERN.test(source)) {
    return { include: true, kind: 'preference', reason: 'stable_preference', confidence: 0.8 }
  }
  if (PROMISE_PATTERN.test(source)) {
    return { include: true, kind: 'promise', reason: 'agreement', confidence: 0.75 }
  }
  if (FACT_PATTERN.test(source)) {
    return { include: true, kind: 'person', reason: 'stable_fact', confidence: 0.7 }
  }
  if (RELATION_PATTERN.test(source)) {
    return { include: true, kind: 'person', reason: 'relationship', confidence: 0.6 }
  }

  return reject('low_value')
}

/**
 * 拼一段「怎么在这种场合说话」的提示词。
 *
 * 群聊和私聊分开写：群聊更短、更少追问；私聊可以多接一句。
 * 没学到东西就返回空字符串，不占提示词预算。
 */
export function buildSocialNote(options = {}) {
  const scope = options.scope === 'group' ? 'group' : options.scope === 'desktop' ? 'desktop' : 'private'
  const style = options.style ?? null
  const memes = Array.isArray(options.memes) ? options.memes : []
  const play = options.play ?? null
  const lines = []

  if (scope === 'group') {
    lines.push('这是群聊。跟着大家的节奏说话：一次一句，别刷屏，别连续追问。')
    // 格式模仿默认开；用户可以在设置里关掉，避免所有群都被同一种腔调带跑。
    if (options.imitate !== false) {
      const described = describeStyle(style)
      if (described !== '') lines.push(`这群人的说话方式：${described}`)
      const format = describeFormatAdvice(style)
      if (format !== '') lines.push(`这条回复可以这样发：${format}`)
    }
    if (memes.length > 0) {
      lines.push(`群里反复出现的说法：${memes.map((item) => `「${item.phrase}」`).join('、')}。只在你确定含义时顺着用；不确定就别接，更不要解释它。`)
    }
  } else if (scope === 'private') {
    lines.push('这是私聊。可以比群里多接一句，但别把每句话都变成提问。')
  }

  if (play && play.likelyPlayful) {
    const marks = []
    if (play.slang.length > 0) marks.push(`黑话/网络词：${play.slang.join('、')}`)
    if (play.acronyms.length > 0) marks.push(`缩写：${play.acronyms.join('、')}`)
    if (play.numberPlay.length > 0) marks.push(`数字梗：${play.numberPlay.join('、')}`)
    lines.push(
      `这句话里可能有谐音、黑话或梗（${marks.join('；')}）。听出来就顺着接一句，听不懂就问一句，别装懂，也别把梗当字面意思回答。`
    )
  }

  if (options.memoryHint === 'rejected') {
    lines.push('刚才那句话更像临时的状态或玩笑，不用记进长期记忆，也不用在之后提起。')
  }

  return lines.join('\n')
}

/** 给设置页和日志用的短标签。 */
export const MEMORY_REASON_LABEL = {
  empty: '空内容',
  too_short: '太短',
  greeting: '寒暄',
  secret: '凭据',
  roleplay: '角色扮演',
  joke: '玩笑',
  temporary: '临时状态',
  quoted_other: '转述他人',
  explicit_forget: '要求忘记',
  unfulfilled_plan: '还没做',
  low_value: '低信息',
  explicit_request: '明确要求',
  stable_preference: '稳定偏好',
  agreement: '约定',
  stable_fact: '稳定事实',
  relationship: '关系线索'
}

export { DEFAULT_WAKE_WORDS }
