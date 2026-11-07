/**
 * 反思模块：把当天的巡视结果压成三条「印象」，写成普通 Markdown。
 *
 * 约束：
 * - 只是背景记录，不逐轮注入对话，也不改人格提示词；
 * - 没配置模型时用规则模板，不假装做过语义分析；
 * - 写入前统一脱敏：不落 Key、不落绝对路径、不落平台用户名。
 */

const SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g
const WIN_PATH_PATTERN = /\b[A-Za-z]:\\[^\s"'，。；]+/g
const UNIX_HOME_PATTERN = /\/(?:home|Users)\/[^\s"'，。；/]+/g

/** 写入前的统一脱敏；返回文本而不是就地修改，便于测试。 */
export function sanitizeReflectionText(text) {
  if (typeof text !== 'string' || text === '') return ''
  return text
    .replace(SECRET_PATTERN, '[已隐藏密钥]')
    .replace(WIN_PATH_PATTERN, '[本地路径]')
    .replace(UNIX_HOME_PATTERN, '[本地路径]')
}

/**
 * 规则版印象：只根据真实字段生成，不编造事件。
 * review 结构来自 daily-review.buildDailyReview。
 */
export function buildReflection({ review, extra = [] }) {
  const impressions = []
  const rounds = Number(review?.rounds ?? 0)

  if (rounds === 0) {
    impressions.push('今天几乎没有对话，安静被完整地留了下来。')
  } else if (rounds >= 20) {
    impressions.push(`今天聊了 ${rounds} 轮，话题一直很密。`)
  } else {
    impressions.push(`今天聊了 ${rounds} 轮，节奏不快不慢。`)
  }

  const delta = review?.memoryDelta
  if (typeof delta === 'number' && delta > 0) {
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

  for (const line of Array.isArray(extra) ? extra.slice(0, 3) : []) {
    if (typeof line === 'string' && line.trim() !== '') impressions.push(line.trim())
  }

  return impressions.slice(0, 3)
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

/** 写入 userData/notes/reflection/YYYY-MM-DD.md。日期不合法直接拒绝。 */
export async function writeReflection({ fs, path, dir, date, markdown }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new Error('反思日期不合法')
  }
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `${date}.md`)
  await fs.writeFile(target, sanitizeReflectionText(markdown), 'utf8')
  return target
}
