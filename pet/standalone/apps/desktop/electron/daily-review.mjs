/**
 * 每日终盘巡视：把当天发生过的事压成一份小结。
 *
 * 设计约束：
 * - 只读当天已有的数据，不推测、不补写不存在的事件；
 * - 没有数据就明确说「今天没怎么说话」，不用一句空话冒充总结；
 * - 报告只落在 userData/reports 下，文件名只接受 YYYY-MM-DD，避免路径穿越。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 当天内的 ISO 时间串才计入，跨天、非法值一律不算。 */
export function isSameLocalDay(at, date) {
  if (typeof at !== 'string' || at === '') return false
  if (!DATE_PATTERN.test(date)) return false
  const parsed = new Date(at)
  if (Number.isNaN(parsed.getTime())) return false
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}` === date
}

/** 本地日期串，不用 toISOString（那是 UTC，晚上会串到前一天）。 */
export function localDateKey(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 汇总当天数据。
 *
 * 入参全部来自主进程已有状态；缺什么就写 null，界面按 null 显示「未记录」，
 * 不用 0 冒充「今天完全没发生」。
 */
export function buildDailyReview(input) {
  const date = localDateKey(input?.now ?? new Date())
  const turns = Array.isArray(input?.turns) ? input.turns : []
  const todayTurns = turns.filter((turn) => isSameLocalDay(turn?.at, date))
  const rounds = todayTurns.filter((turn) => turn?.role === 'user').length

  const memoryBefore = toCount(input?.memoryBefore)
  const memoryAfter = toCount(input?.memoryAfter)
  const memoryDelta =
    memoryBefore === null || memoryAfter === null ? null : Math.max(memoryAfter - memoryBefore, 0)

  return {
    date,
    rounds,
    memoryDelta,
    memoryTotal: memoryAfter,
    balance: toBalance(input?.balance),
    todos: Array.isArray(input?.todos) ? input.todos.map(String).slice(0, 20) : []
  }
}

/** 生成一句能直接放进气泡的小结；不使用感叹式夸张。 */
export function renderSummary(review) {
  if (review.rounds === 0 && (review.memoryDelta === null || review.memoryDelta === 0)) {
    return '今天没怎么说话，人家把安静也记下来了。'
  }

  const parts = [`今天聊了 ${review.rounds} 轮`]
  if (review.memoryDelta !== null && review.memoryDelta > 0) {
    parts.push(`记住了 ${review.memoryDelta} 条新事`)
  }
  if (review.balance !== null) {
    parts.push(`余额还剩 ${review.balance} 元`)
  }
  if (review.todos.length > 0) {
    parts.push(`明天先做：${review.todos[0]}`)
  }
  return `${parts.join('，')}。`
}

/**
 * 写入报告。目录不存在就建，已存在则覆盖同一天。
 * 失败时抛出原始错误，由主进程决定怎么提示；不在这里吞掉。
 */
export async function writeDailyReview({ fs, path, dir, review }) {
  if (!DATE_PATTERN.test(review?.date ?? '')) {
    throw new Error('报告日期不合法')
  }
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `${review.date}.json`)
  const text = `${JSON.stringify({ ...review, summary: renderSummary(review) }, null, 2)}\n`
  await fs.writeFile(target, text, 'utf8')
  return target
}

function toCount(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function toBalance(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100) / 100
}
