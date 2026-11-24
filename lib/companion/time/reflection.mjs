/**
 * 反思模块：把当天的巡视结果压成三条「印象」，写成普通 Markdown。
 *
 * 约束：
 * - 只是背景记录，不逐轮注入对话，也不改人格提示词；
 * - 没配置模型时用规则模板，不假装做过语义分析；
 * - 写入前统一脱敏：不落 Key、不落绝对路径、不落平台用户名。
 */

import { REFLECTION } from '../standard.mjs'
import { personaDayKey } from '../persona/persona-time.mjs'

/* 凭据与隐私都在落盘前统一处理；顺序从「长令牌」到「短号码」，避免被局部替换打断。 */
const SECRET_PATTERNS = Object.freeze([
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s，。；]{4,}/gi,
])
const WIN_PATH_PATTERN = /\b[A-Za-z]:\\[^\s"'，。；]+/g
const UNC_PATH_PATTERN = /\\\\[^\s"'，。；]+/g
const UNIX_HOME_PATTERN = /\/(?:home|Users|root)\/[^\s"'，。；/]+/g
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g
const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const ID_PATTERN = /(?<!\d)\d{17}[\dXx](?!\d)/g

/** 写入前的统一脱敏；返回文本而不是就地修改，便于测试。 */
export function sanitizeReflectionText(text) {
  if (typeof text !== 'string' || text === '') return ''
  let clean = text
  for (const pattern of SECRET_PATTERNS) {
    clean = clean.replace(pattern, '[已隐藏密钥]')
  }
  return clean
    .replace(WIN_PATH_PATTERN, '[本地路径]')
    .replace(UNC_PATH_PATTERN, '[本地路径]')
    .replace(UNIX_HOME_PATTERN, '[本地路径]')
    .replace(EMAIL_PATTERN, '[已隐藏联系方式]')
    .replace(PHONE_PATTERN, '[已隐藏联系方式]')
    .replace(ID_PATTERN, '[已隐藏联系方式]')
}

/** 证据原话只露一小截，别把整段聊天搬进笔记；按码点截，避免拆开 emoji。 */
function clip(text, max = REFLECTION.evidenceTextLimit) {
  const clean = typeof text === 'string' ? text.trim() : ''
  const chars = Array.from(clean)
  if (chars.length <= max) return clean
  return `${chars.slice(0, max).join('')}…`
}

/**
 * 从还活着的断言里挑一条最值得写进印象的。
 * 优先级：今天确认过且有原话 → 有原话 → 最近被想起。
 * 只读真实字段，读不到就返回 null，让调用方回退到原来的模板句。
 */
function pickWitness(facts, now) {
  const todayKey = personaDayKey(now)
  const live = facts.filter((fact) => {
    if (typeof fact.text !== 'string' || fact.text.trim() === '') return false
    const validFrom = Number(fact.validFrom) || 0
    const validTo = Number(fact.validTo) || 0
    if (validFrom > 0 && validFrom > now) return false
    if (validTo > 0 && validTo <= now) return false
    return true
  })
  if (live.length === 0) return null
  const scored = live
    .map((fact) => {
      let score = 0
      // 「今天确认过」看最后一次被提起，不看 validFrom：一条旧事今天被重新确认，也该算今天。
      const seenAt = Number(fact.lastSeenAt) || 0
      if (seenAt > 0 && personaDayKey(seenAt) === todayKey) score += REFLECTION.witnessTodayScore
      if (typeof fact.evidence === 'string' && fact.evidence.trim() !== '') {
        score += REFLECTION.witnessEvidenceScore
      }
      return { fact, score, seen: seenAt }
    })
    .sort((a, b) => b.score - a.score || b.seen - a.seen)
  return scored[0].fact
}

/** 把一条断言写成一句人话；提及档位决定说到什么程度。 */
function describeWitness(fact) {
  const text = fact.text.trim()
  const policy = fact.mentionPolicy
  const evidence = clip(fact.evidence ?? '')
  if (policy === 'never') {
    // 答应过不写下来的事，连分量都不落纸面。
    return '有一件事，我答应过不记下内容，也不说出去；知道它还在，就够了。';
  }
  if (policy === 'soft_echo') {
    // 软回响连内容都不落笔记：只留「有这么一件事」的重量。
    return '有一件事，我只记住它的分量，不写下内容，也不主动提。';
  }
  if (policy === 'on_request') {
    return `关于「${text}」，我记着，但要等你问起才说。`;
  }
  if (evidence !== '') {
    return `关于「${text}」，我还留着你当时那句话：「${evidence}」。`;
  }
  return `关于「${text}」，今天又确认了一次，我把它握得更稳了。`;
}

/**
 * 规则版印象：只根据真实字段生成，不编造事件。
 * review 结构来自 daily-review.buildDailyReview。
 * facts 是结构化记忆（memory-facts 的 snapshot().facts），有就落在真实断言上。
 * candidates 是候选箱里待审条数：只提醒去审核，不替用户做决定。
 */
export function buildReflection({ review, facts = [], candidates = 0, extra = [], now = Date.now(), timeZone = '' }) {
  const impressions = []
  const rounds = Number.isFinite(Number(review?.rounds))
    ? Math.max(0, Math.floor(Number(review.rounds)))
    : 0

  if (rounds === 0) {
    impressions.push('今天几乎没有对话，安静被完整地留了下来。')
  } else if (rounds >= REFLECTION.busyRounds) {
    impressions.push(`今天聊了 ${rounds} 轮，话题一直很密。`)
  } else {
    impressions.push(`今天聊了 ${rounds} 轮，节奏不快不慢。`)
  }

  const live = Array.isArray(facts) ? facts.filter((fact) => fact && fact.archived !== true) : []
  const witness = pickWitness(live, now, timeZone)
  const delta = review?.memoryDelta
  const pending = Number.isFinite(Number(candidates)) && Number(candidates) > 0 ? Math.floor(Number(candidates)) : 0
  const pendingLine =
    pending <= 0
      ? ''
      : pending >= REFLECTION.candidateWarn
        ? `候选箱里积了 ${pending} 条，最好今天过一眼。`
        : `抽屉里还有 ${pending} 条候选，等你点头才会真正记住。`
  if (witness !== null) {
    impressions.push(describeWitness(witness))
    if (pendingLine !== '') impressions.push(pendingLine)
  } else if (pendingLine !== '') {
    impressions.push(pendingLine)
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

  /*
   * 额外印象单独占位：核心三条先写满，再把 extra 接在后面。
   * 以前把 extra 也塞进同一条队列再 slice，轮数、见证、计划三句一占满，
   * 调用方传来的一年一日、天气提醒就永远进不了正文。
   */
  const extraLines = []
  for (const line of Array.isArray(extra) ? extra : []) {
    if (typeof line !== 'string' || line.trim() === '') continue
    extraLines.push(line.trim())
    if (extraLines.length >= REFLECTION.extraLimit) break
  }

  return impressions.slice(0, REFLECTION.maxImpressions).concat(extraLines)
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

/** 真实日历日校验；格式对但日子不存在（02-31）也要拒绝。 */
function isRealDayKey(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return false
  const [year, month, day] = date.split('-').map(Number)
  if (
    year < REFLECTION.yearMin ||
    month < REFLECTION.monthMin ||
    month > REFLECTION.monthMax ||
    day < REFLECTION.dayMin ||
    day > REFLECTION.dayMax
  ) {
    return false
  }
  const parsed = new Date(year, month - 1, day)
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
}

/** 同日第二次生成：保留已有正文，把新内容作为补记追加，不覆盖前一次。 */
function mergeSameDayReflection(existing, incoming, at) {
  const body = incoming
    .split('\n')
    .filter((line) => !line.startsWith('# ') && !line.startsWith('_这份记录由本地规则整理'))
    .join('\n')
    .trim()
  if (body === '') return existing
  if (existing.includes(body)) return existing
  const stamp = new Date(at).toTimeString().slice(0, REFLECTION.clockTextLength)
  return `${existing.trimEnd()}\n\n---\n\n### 补记 ${stamp}\n\n${body}\n`
}

/**
 * 反思进提示词的唯一闸门：主人、且「记忆感知」开着。
 * 访客/中转没有这一层，记忆轴关掉时也不拿日记当特例偷偷塞回去。
 */
export function reflectionsForPrompt(groups, { scope = 'owner', memoryOn = true } = {}) {
  if (scope !== 'owner' || memoryOn === false) return []
  return Array.isArray(groups) ? groups : []
}

/**
 * 回读最近的反思：只收真实日期文件，按日期倒序，每天取前几条。
 * 返回 [{ date, lines: [] }]，正文统一脱敏并按标准截断。
 * 读不到目录或单日文件时安静跳过，不让反思反过来挡住对话。
 */
export async function readRecentReflections({
  fs,
  path,
  dir,
  days = REFLECTION.readDays,
  linesPerDay = REFLECTION.readLinesPerDay,
  maxChars = REFLECTION.readMaxChars,
} = {}) {
  if (!fs || typeof fs.readdir !== 'function' || !path || typeof path.join !== 'function') return []
  const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const dates = files
    .filter((entry) => entry?.isFile?.() === true)
    .map((entry) => String(entry.name ?? ''))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .map((name) => name.slice(0, -3))
    .filter((date) => isRealDayKey(date))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, Math.max(1, Math.floor(Number(days) || REFLECTION.readDays)))

  const groups = []
  for (const date of dates) {
    let raw = ''
    try {
      raw = await fs.readFile(path.join(dir, `${date}.md`), 'utf8')
    } catch {
      continue
    }
    const lines = []
    for (const line of String(raw).split(/\r?\n/)) {
      const match = /^\s*-\s+(.+)$/.exec(line)
      if (!match) continue
      const text = sanitizeReflectionText(match[1]).replace(/\s+/g, ' ').trim()
      if (text === '') continue
      const chars = Array.from(text)
      lines.push(chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : text)
      if (lines.length >= Math.max(1, Math.floor(Number(linesPerDay) || REFLECTION.readLinesPerDay))) break
    }
    if (lines.length > 0) groups.push({ date, lines })
  }
  return groups
}

/** 写入 userData/notes/reflection/YYYY-MM-DD.md。日期不合法直接拒绝。 */
export async function writeReflection({ fs, path, dir, date, markdown, now = Date.now(), append = true }) {
  if (!isRealDayKey(date)) {
    throw new Error('反思日期不合法')
  }
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `${date}.md`)
  const clean = sanitizeReflectionText(markdown)
  let next = clean
  if (append === true) {
    try {
      const existing = await fs.readFile(target, 'utf8')
      next = mergeSameDayReflection(existing, clean, now)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  // 先写临时文件再 rename：追加过程退出也不会留下半截文件。
  const tmp = path.join(dir, `.${date}.md.tmp`)
  await fs.writeFile(tmp, next, 'utf8')
  await fs.rename(tmp, target)
  return target
}
