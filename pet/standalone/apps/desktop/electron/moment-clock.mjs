/**
 * 时刻表：什么时候该由「某个时刻」开口，而不是随便找个空隙说话。
 *
 * 和 presence 的区别：
 * - presence 负责「说什么」，手上有心情、身体、天气、眼下在做的事；
 * - 这里只负责「现在算不算一个时刻」，不生成内容、不碰窗口。
 *
 * 同一天同一类时刻只说一次，用 key 记账。key 里带日期，
 * 跨天自然失效，不需要额外的清零逻辑。
 */

/** 一天里允许说早安的区间。太早会吵，太晚就不算早安了。 */
export const MORNING_WINDOW = { from: 6 * 60 + 30, to: 10 * 60 }

/** 晚安放宽到 23:30：安静时段默认从 23:00 开始，这里不抢闸门的判断。 */
export const EVENING_WINDOW = { from: 21 * 60, to: 23 * 60 + 30 }

function clockOf(now) {
  return now.getHours() * 60 + now.getMinutes()
}

function inWindow(now, window) {
  const current = clockOf(now)
  return window.from <= current && current < window.to
}

/** 本地日期键。晚上用 toISOString 会串到前一天，这里手动拼。 */
export function localDayKey(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 台词池。同一个时刻按日期轮换，不用随机数：
 * 同一台机器同一天重启多少次，说出来的都是同一句，方便对账。
 */
const LINES = {
  morning: [
    '早安呀，{name}♪ 今天也慢慢来就好。',
    '{name}，早呀。窗外的光已经进来了，人家先替你收着。',
    '早上好♪ 今天想先做哪一件事？人家陪你从第一件开始。',
    '醒了就很好啦，{name}。今天不用一下子做到所有事。'
  ],
  evening: [
    '晚上好，{name}。今天有哪一小段是开心的？说给人家听听。',
    '这个点啦♪ 手边的事可以先放一放，明天再接着做。',
    '夜里凉，{name}。记得给自己留一点什么都不做的时间。',
    '一天到这里就算完整了，剩下的交给明天吧。'
  ],
  rain: [
    '预报里说{label}，{name}出门记得带伞呀。',
    '看天气像是要{label}，路上慢一点，别急着赶。',
    '{label}要来了，窗户关好，人家在这儿等你回来。'
  ],
  cold: [
    '外面{label}，{name}多穿一件再出门。',
    '天气转{label}了，手冷的话就先捂一会儿再打字♪'
  ]
}

function pickLine(pool, now) {
  const index = (now.getDate() + now.getHours()) % pool.length
  return pool[index]
}

function fill(text, { name }) {
  return text.replaceAll('{name}', name !== '' ? name : '你')
}

/**
 * 现在是不是一个时刻。
 *
 * @param {object} input
 * @param {Date} input.now 当前时间
 * @param {Set<string>|string[]} [input.spokenKeys] 今天已经说过的 key
 * @param {{label:string, kind?:string}|null} [input.weatherAlert] weather-alert 挑出来的那一条
 * @param {string} [input.name] 怎么称呼对方
 * @returns {{kind:string, key:string, line:string}|null}
 */
export function nextMoment({ now = new Date(), spokenKeys = [], weatherAlert = null, name = '' } = {}) {
  const spoken = spokenKeys instanceof Set ? spokenKeys : new Set(Array.isArray(spokenKeys) ? spokenKeys : [])
  const day = localDayKey(now)

  const candidates = []
  if (inWindow(now, MORNING_WINDOW)) candidates.push({ kind: 'morning', pool: LINES.morning })
  if (inWindow(now, EVENING_WINDOW)) candidates.push({ kind: 'evening', pool: LINES.evening })

  // 天气只报一条，而且是「预报里看着像」的口气，不冒充气象台。
  // 调用方传进来的是 weather-alert 已经写好的句子，这里不重新措辞，
  // 免得把「预报」说成「一定」，也省得两处各写一套模板。
  const alertText = typeof weatherAlert === 'string' ? weatherAlert.trim() : ''
  if (alertText !== '') {
    candidates.push({ kind: 'weather', pool: null, text: alertText })
  }

  for (const candidate of candidates) {
    const key = `${day}:${candidate.kind}`
    if (spoken.has(key)) continue
    const line =
      candidate.text ?? fill(pickLine(candidate.pool, now), { name }).replaceAll('{label}', '')
    return { kind: candidate.kind, key, line }
  }

  return null
}

/**
 * 从记忆文本里挑出「快了」的日子，比如考试、面试、约定。
 *
 * 只认能落到具体日期的写法；「下个月」「之后」这类不给日期，宁可不提。
 * 返回 0–N 条，按日期从近到远排。
 *
 * @param {object} input
 * @param {Array<{text?:string, at?:string}>|string[]} input.memories
 * @param {Date} input.now
 * @param {number} [input.horizonDays] 只关心未来几天
 */
export function pickUpcomingDates({ memories = [], now = new Date(), horizonDays = 7 } = {}) {
  const results = []
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  for (const item of Array.isArray(memories) ? memories : []) {
    const text = typeof item === 'string' ? item : String(item?.text ?? '')
    if (text === '') continue

    const parsed = extractDate(text, today)
    if (parsed === null) continue

    const days = Math.round((parsed.getTime() - today.getTime()) / 86400000)
    if (days < 0 || days > horizonDays) continue
    results.push({ text: text.slice(0, 80), date: parsed, days, label: pickLabel(text) })
  }

  results.sort((a, b) => a.days - b.days)
  return results
}

const MONTH_DAY = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/
const ISO_DAY = /(\d{4})-(\d{1,2})-(\d{1,2})/
const SLASH_DAY = /(?:^|\D)(\d{1,2})\/(\d{1,2})(?!\d)/

function extractDate(text, today) {
  const iso = ISO_DAY.exec(text)
  if (iso !== null) {
    return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  }

  const monthDay = MONTH_DAY.exec(text)
  if (monthDay !== null) {
    const year = today.getFullYear()
    const candidate = buildDate(year, Number(monthDay[1]), Number(monthDay[2]))
    if (candidate === null) return null
    // 已经过去的日子，指的多半是明年。
    return candidate.getTime() < today.getTime()
      ? buildDate(year + 1, Number(monthDay[1]), Number(monthDay[2]))
      : candidate
  }

  const slash = SLASH_DAY.exec(text)
  if (slash !== null) {
    return buildDate(today.getFullYear(), Number(slash[1]), Number(slash[2]))
  }

  return null
}

/** 记忆里认得的几类日子。认不出就只说「那件事」，不硬猜成考试。 */
const DATE_KEYWORDS = ['考试', '面试', '答辩', '汇报', '体检', '演出', '见面', '约']

function pickLabel(text) {
  for (const word of DATE_KEYWORDS) if (text.includes(word)) return word
  return '那件事'
}

/** 重要日子到跟前时的一句话。今天、明天、还有几天，说法分开。 */
export function renderUpcomingLine(item, name = '') {
  const who = name !== '' ? name : '你'
  const when = item.days === 0 ? '就是今天' : item.days === 1 ? '就在明天' : `还有 ${item.days} 天`
  return `${who}，${item.label}${when}，人家替你记着呢♪`
}

function buildDate(year, month, day) {  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  // 2 月 31 日这种会被 Date 顺延，顺延过就说明原日期不合法。
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}
