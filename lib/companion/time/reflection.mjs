/**
 * 反思模块：把当天的巡视结果压成三条「印象」，写成普通 Markdown。
 *
 * 约束：
 * - 只是背景记录，不逐轮注入对话，也不改人格提示词；
 * - 没配置模型时用规则模板，不假装做过语义分析；
 * - 写入前统一脱敏：不落 Key、不落绝对路径、不落平台用户名。
 */

// 常见密钥形态：OpenAI/DeepSeek 的 sk-、GitHub 的 ghp_ 与 github_pat_、
// AWS 的 AKIA、Slack 的 xoxb-，一次全盖掉。
const SECRET_PATTERN = /\b(?:sk-|ghp_|github_pat_|AKIA|xoxb-)[A-Za-z0-9_-]{8,}\b/g
// 「Bearer <令牌>」整段盖掉，避免留下半个前缀。
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g
const WIN_PATH_PATTERN = /\b[A-Za-z]:\\[^\s"'，。；]+/g
// UNC 共享路径（\\server\share）也归为本地路径。
const UNC_PATH_PATTERN = /\\{2,}[^\s"'，。；]+/g
const UNIX_HOME_PATTERN = /\/(?:home|Users|root)\/[^\s"'，。；/]+/g

/** 写入前的统一脱敏；返回文本而不是就地修改，便于测试。 */
export function sanitizeReflectionText(text) {
  if (typeof text !== 'string' || text === '') return ''
  return text
    .replace(SECRET_PATTERN, '[已隐藏密钥]')
    .replace(BEARER_PATTERN, '[已隐藏密钥]')
    .replace(WIN_PATH_PATTERN, '[本地路径]')
    .replace(UNC_PATH_PATTERN, '[本地路径]')
    .replace(UNIX_HOME_PATTERN, '[本地路径]')
}

/**
 * 本地零点，用来判断「今天是哪天确认的」。
 * 传了 timeZone（IANA）就用 Intl 算那个人格时区的零点；不传仍用系统时区。
 */
function startOfDay(at, timeZone = '') {
  const parsed = Number(at)
  // 0 / NaN / null 都算缺失：0 是 1970 年，不是合法时间戳。
  const ms = parsed > 0 && Number.isFinite(parsed) ? parsed : Date.now()
  const date = new Date(ms)
  if (typeof timeZone !== 'string' || timeZone === '') {
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  // 用 Intl 拿目标时区的「今天」，再借墙钟偏差把该时区零点换算回 UTC 毫秒。
  const dayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const get = (parts, type) => {
    const found = parts.find((part) => part.type === type)
    return found === undefined ? 0 : Number(found.value)
  }
  const guess = Date.UTC(get(dayParts, 'year'), get(dayParts, 'month') - 1, get(dayParts, 'day'))
  const wall = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(guess))
  const wallAsUtc = Date.UTC(
    get(wall, 'year'),
    get(wall, 'month') - 1,
    get(wall, 'day'),
    get(wall, 'hour'),
    get(wall, 'minute'),
    get(wall, 'second')
  )
  // guess 被当成 UTC 日期，目标时区的墙上时间与它相差多少，零点就挪回去多少。
  return guess - (wallAsUtc - guess)
}

/** 证据原话只露一小截，别把整段聊天搬进笔记。 */
function clip(text, max = 26) {
  const clean = typeof text === 'string' ? text.trim() : ''
  // 按码点截断：slice 按 UTF-16 单元切，会把 emoji 这类代理对切成半个字。
  const points = Array.from(clean)
  if (points.length <= max) return clean
  return `${points.slice(0, max).join('')}…`
}

/**
 * 从还活着的断言里挑一条最值得写进印象的。
 * 优先级：今天确认过且有原话 → 有原话 → 最近被想起。
 * 只读真实字段，读不到就返回 null，让调用方回退到原来的模板句。
 */
function pickWitness(facts, now, timeZone = '') {
  const today = startOfDay(now, timeZone)
  const live = facts.filter((fact) => typeof fact.text === 'string' && fact.text.trim() !== '')
  if (live.length === 0) return null
  const scored = live
    .map((fact) => {
      let score = 0
      // 「今天又确认过」看最近一次被想起/更新的时间，不看 validFrom：
      // validFrom 是「开始成立」的时刻，成立好几年的事不该天天算「今天确认」。
      const confirmedAt = Math.max(Number(fact.lastSeenAt) || 0, Number(fact.updatedAt) || 0)
      if (confirmedAt >= today) score += 4
      if (typeof fact.evidence === 'string' && fact.evidence.trim() !== '') score += 2
      if (Number(fact.validTo) > 0) score -= 3
      return { fact, score, seen: Number(fact.lastSeenAt) || 0 }
    })
    .sort((a, b) => b.score - a.score || b.seen - a.seen)
  return scored[0].fact
}

/** 把一条断言写成一句人话；提及档位决定说到什么程度。 */
function describeWitness(fact) {
  const text = fact.text.trim()
  const policy = fact.mentionPolicy
  const evidence = clip(fact.evidence ?? '')
  if (policy === 'soft_echo') {
    // 软回响连内容都不落笔记：只留「有这么一件事」的重量。
    return '有一件事，我只记住它的分量，不写下内容，也不主动提。'
  }
  if (policy === 'on_request') {
    return `关于「${text}」，我记着，但要等你问起才说。`
  }
  if (evidence !== '') {
    return `关于「${text}」，我还留着你当时那句话：「${evidence}」。`
  }
  return `关于「${text}」，今天又确认了一次，我把它握得更稳了。`
}

/**
 * 规则版印象：只根据真实字段生成，不编造事件。
 * review 结构来自 daily-review.buildDailyReview。
 * facts 是结构化记忆（memory-facts 的 snapshot().facts），有就落在真实断言上。
 */
export function buildReflection({
  review,
  facts = [],
  extra = [],
  now = Date.now(),
  memoryLines = [],
  timeZone = ''
}) {
  const impressions = []
  const parsedRounds = Number(review?.rounds)
  // NaN / 'abc' 这类坏值一律按 0 轮处理，不能直接拼进句子。
  const rounds = Number.isFinite(parsedRounds) && parsedRounds >= 0 ? Math.floor(parsedRounds) : 0

  if (rounds === 0) {
    impressions.push('今天几乎没有对话，安静被完整地留了下来。')
  } else if (rounds >= 20) {
    impressions.push(`今天聊了 ${rounds} 轮，话题一直很密。`)
  } else {
    impressions.push(`今天聊了 ${rounds} 轮，节奏不快不慢。`)
  }

  const live = Array.isArray(facts) ? facts.filter((fact) => fact && fact.archived !== true) : []
  const witness = pickWitness(live, now, timeZone)
  const delta = review?.memoryDelta
  if (witness !== null) {
    impressions.push(describeWitness(witness))
  } else if (typeof delta === 'number' && delta > 0) {
    impressions.push(`新增了 ${delta} 条记忆，说明有些话值得留下来。`)
  } else {
    impressions.push('没有新增记忆，今天更像是在原地陪了一会儿。')
  }

  const todos = Array.isArray(review?.todos) ? review.todos : []
  if (todos.length > 0) {
    impressions.push(`明天可以先从「${todos[0]}」开始。`)
  } else if (typeof review?.balance === 'number') {
    impressions.push(`账户余额还剩 ${review.balance} 元，暂时不用操心。`)
  } else {
    impressions.push('明天还没有明确计划，留一点空白也好。')
  }

  // 核心印象固定占满三条，extra 以前永远进不了输出：
  // 这里单独给它留一个名额，保证至少能挤进一条。
  const base = impressions.slice(0, 3)
  const extraLine = (Array.isArray(extra) ? extra : [])
    .filter((line) => typeof line === 'string' && line.trim() !== '')
    .map((line) => line.trim())[0]

  // 原话记忆（调用方不传时行为不变）：单独占一条，不挤占核心三条。
  const quoted = (Array.isArray(memoryLines) ? memoryLines : [])
    .filter((line) => typeof line === 'string' && line.trim() !== '')
    .slice(0, 3)
    .map((line) => `「${clip(line, 40)}」`)
    .join('、')

  const result = [...base]
  if (extraLine !== undefined) result.push(extraLine)
  if (quoted !== '') result.push(`对方今天说过的原话：${quoted}`)
  return result
}

/** 生成 Markdown 正文；标题用日期，不用任何机器路径。 */
export function renderReflectionMarkdown({ date, impressions, summary }) {
  const lines = [`# ${date} 的印象`, '']
  for (const item of impressions) {
    lines.push(`- ${sanitizeReflectionText(item)}`)
  }
  const tail = sanitizeReflectionText(summary ?? '')
  if (tail !== '') {
    lines.push('', `> ${tail}`)
  }
  lines.push('', '_这份记录由本地规则整理，只作背景参考，不代表真实感受。_', '')
  return lines.join('\n')
}

/** 格式合法还不够：2 月 30 日这种日期要能被 Date 反查回同一天才算数。 */
function isValidRealDate(date) {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  )
}

/** 写入 userData/notes/reflection/YYYY-MM-DD.md。日期不合法直接拒绝。 */
export async function writeReflection({ fs, path, dir, date, markdown, now = Date.now() }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !isValidRealDate(date)) {
    throw new Error('反思日期不合法')
  }
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `${date}.md`)
  const clean = sanitizeReflectionText(markdown)
  // 同一天再反思一次不覆盖旧的：追加一段，带时间戳分隔。
  let content = clean
  try {
    const existing = await fs.readFile(target, 'utf8')
    if (existing.trim() !== '') {
      const time = new Date(now()).toTimeString().slice(0, 5)
      content = `${existing.trimEnd()}\n\n---\n\n_补记于 ${time}_\n\n${clean}`
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  // 先写临时文件再 rename：追加过程退出也不会留下半截文件。
  const tmp = path.join(dir, `.${date}.md.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, target)
  return target
}
