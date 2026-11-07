/**
 * 每日节目单生成器。
 *
 * 一天只生成一次：开机后第一轮对话、或第一次主动说话之前，在后台问一次模型，
 * 「今天你打算怎么过」。生成结果交给陪伴层收下，之后每轮只读，不再重复请求。
 *
 * 三条约束，和 agenda.ts 的校验分工明确：
 * - 这里只管「问模型 + 转成分钟 + 解析 JSON」；
 * - 越界、重叠、空标题由 `buildPlan` 清洗，清洗后为空会自动退回内置一天；
 * - 失败不写任何东西，昨天的结构由 core 的 carryOver 兜住，不会出现空白的一天。
 */

import { buildPlan, dateKey } from '@pet/core/browser'

const PLAN_ENDPOINT = 'https://api.deepseek.com/chat/completions'
const PLAN_TIMEOUT_MS = 40_000
const SUPPORTED_PROVIDER = 'deepseek'

const SYSTEM_PROMPT = [
  '你在为一个桌面陪伴角色安排今天的生活。',
  '只输出一个 JSON 对象，不要解释，不要在 JSON 前后写任何话。',
  '格式：{"segments":[{"id":"morning","start":"07:00","end":"08:00","title":"起床","kind":"rest","memo":"可选的一句"}]}',
  '要求：',
  '- 从 00:00 到 24:00 完整覆盖，段与段首尾相接，不重叠、不留空；',
  '- 6 到 12 段，每段至少 30 分钟；',
  '- title 不超过 12 个字，写具体的生活动作，不要抽象词；',
  '- kind 只能是 sleep / meal / work / study / chore / leisure / rest / commute / other；',
  '- 睡觉用 sleep，吃饭用 meal，memo 可以留空。'
].join('\n')

/**
 * 节目单质量闸。
 *
 * buildPlan 只保证「结构合法」：不重叠、不留空、字段对得上。
 * 合法不等于合理——模型完全可以交出一份「全天工作十四小时、没有睡觉」的单子，
 * 结构检查会全过，读起来却不像一个人的一天。
 *
 * 这里在收下之前再问几个问题：有没有睡、种类是不是太单一、有没有一段长得离谱。
 * 任何一条不过就整份不用，沿用昨天的结构。宁可重复，也不要让她过一天假日子。
 */
export function auditPlan(plan) {
  const issues = []
  const segments = Array.isArray(plan?.segments) ? plan.segments : []

  if (segments.length < 6) issues.push('too-few-segments')
  if (segments.length > 14) issues.push('too-many-segments')

  const kinds = new Set(segments.map((item) => item.kind))
  // 没有睡觉的一天，不管别的排得多漂亮，都不该被收下。
  if (!kinds.has('sleep')) issues.push('no-sleep')
  if (kinds.size < 3) issues.push('monotonous')

  const titles = new Set(segments.map((item) => item.title))
  if (titles.size !== segments.length) issues.push('duplicate-title')

  const longest = segments.reduce(
    (max, item) => Math.max(max, item.endMinute - item.startMinute),
    0
  )
  if (longest > 8 * 60) issues.push('segment-too-long')

  const covered = segments.reduce((sum, item) => sum + (item.endMinute - item.startMinute), 0)
  if (covered !== 24 * 60) issues.push('not-full-day')

  return { ok: issues.length === 0, issues }
}

/** `HH:MM` 或纯分钟数，转成一天里的第几分钟；非法返回 null。 */
export function toMinute(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const minute = Math.round(value)
    return minute >= 0 && minute <= 24 * 60 ? minute : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (match === null) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null
  const total = hour * 60 + minute
  return total <= 24 * 60 ? total : null
}

/**
 * 从模型输出里取出 JSON。
 *
 * 模型偶尔会裹一层 ```json，或在前面写「好的，这是今天的安排」；也会带 BOM、
 * 行内注释、尾逗号、中文引号。这里只做最小限度的修复，仍然解析不了就返回 null。
 */
export function extractPlanJson(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (text === '') return null

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced === null ? text : fenced[1]
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  const slice = body.slice(start, end + 1)
  // 先原样解析；失败再做一次保守修复。修复只碰语法噪音，不改字段内容。
  for (const candidate of [slice, repairJsonText(slice)]) {
    try {
      const parsed = JSON.parse(candidate)
      return typeof parsed === 'object' && parsed !== null ? parsed : null
    } catch {
      // 继续试下一种
    }
  }
  return null
}

/** 只处理最常见的几种模型手误：注释、尾逗号、中文引号、非法控制字符。 */
export function repairJsonText(text) {
  if (typeof text !== 'string') return text
  return text
    // 中文引号成对时替换；单边出现时也一起换，JSON 里本来就不该有它们。
    .replace(/[“”]/g, '"')
    // 行注释：只在行首或空白后出现时删除，避免误伤 http:// 里的双斜杠。
    .replace(/(^|\s)\/\/[^\n\r]*/g, '$1')
    // 块注释
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // 尾逗号：}, 与 ], 的情况
    .replace(/,(\s*[}\]])/g, '$1')
    // 去掉 JSON 字符串里不允许的裸控制字符（保留换行、制表、回车）
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** 把模型给的时间字段转成 agenda 需要的 startMinute / endMinute。 */
export function normalizeRawSegments(segments) {
  if (!Array.isArray(segments)) return []
  const result = []
  for (const item of segments) {
    if (item === null || typeof item !== 'object') continue
    const start = toMinute(item.start ?? item.startMinute)
    const end = toMinute(item.end ?? item.endMinute)
    if (start === null || end === null) continue
    result.push({
      id: typeof item.id === 'string' ? item.id : `seg-${start}`,
      startMinute: start,
      endMinute: end,
      title: typeof item.title === 'string' ? item.title : '',
      kind: typeof item.kind === 'string' ? item.kind : 'other',
      ...(typeof item.memo === 'string' && item.memo.trim() !== '' ? { memo: item.memo.trim() } : {})
    })
  }
  return result
}

function readPlanConfig(settings) {
  const chat = settings?.companion?.chat ?? {}
  const maxTokens = Number(chat.maxTokens)
  const provider =
    typeof chat.provider === 'string' && chat.provider.trim() !== ''
      ? chat.provider.trim()
      : SUPPORTED_PROVIDER
  return {
    provider,
    model:
      typeof chat.model === 'string' && chat.model.trim() !== '' ? chat.model.trim() : 'deepseek-chat',
    // 节目单要具体但不需要太发散，温度固定低一点，不跟聊天共用。
    maxTokens: Number.isFinite(maxTokens) ? Math.min(Math.max(Math.floor(maxTokens), 200), 1_200) : 700
  }
}

/**
 * @param {object} options
 * @param {() => object} options.getSettings
 * @param {() => Promise<string|null>} options.getApiKey
 * @param {object} options.companion  陪伴服务
 * @param {() => number} [options.now]
 * @param {Function} [options.fetchImpl]
 * @param {(message:string, error?:unknown) => void} [options.log]
 */
export function createDailyPlanService(options = {}) {
  const {
    getSettings = () => ({}),
    getApiKey = async () => null,
    companion = null,
    now = Date.now,
    fetchImpl = globalThis.fetch,
    log = () => {}
  } = options

  // 每天只尝试一次。失败也记下来，避免每轮对话都打一次模型。
  let attemptedDate = ''
  let inflight = null

  function enabled() {
    const layer = getSettings()?.companion?.companionLayer
    return layer?.enabled !== false
  }

  async function run(today, force) {
    if (companion === null || typeof companion?.setAgenda !== 'function') {
      return { ok: false, reason: 'no-companion' }
    }

    // 已经有一份今天生成的单，直接复用；force 时跳过，用于「重新安排今天」。
    if (!force) {
      const existing =
        typeof companion.currentAgenda === 'function' ? await companion.currentAgenda() : null
      if (existing !== null && existing?.date === today && existing?.source === 'model') {
        return { ok: true, skipped: true, plan: existing }
      }
    }

    const config = readPlanConfig(getSettings())
    if (config.provider !== SUPPORTED_PROVIDER) {
      return { ok: false, reason: 'unsupported-provider', message: config.provider }
    }

    let apiKey = null
    try {
      apiKey = await getApiKey()
    } catch (error) {
      return { ok: false, reason: 'vault-unavailable', message: String(error?.message ?? error) }
    }
    if (apiKey === null || apiKey === '') return { ok: false, reason: 'no-key' }

    const controller = new AbortController()
    let timer = null
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(Object.assign(new Error('daily plan timeout'), { code: 'timeout' }))
      }, PLAN_TIMEOUT_MS)
      timer.unref?.()
    })

    /**
     * 单次请求 + 解析。temperature 与提示尾巴都留出重试的余地：
     * 第一次正常问；解析失败时用更低的温度、更硬的格式要求再问一次。
     */
    async function requestPlan(temperature, formatHint) {
      const response = await Promise.race([
        fetchImpl(PLAN_ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content:
                  `今天是 ${today}（星期${'日一二三四五六'[new Date(now()).getDay()]}）。` +
                  (formatHint === '' ? '' : `\n${formatHint}`)
              }
            ],
            temperature,
            max_tokens: config.maxTokens,
            stream: false
          })
        }),
        timeout
      ])

      if (!response.ok) {
        return { ok: false, reason: 'http', message: `HTTP ${response.status}` }
      }

      const body = await response.json()
      const reply = body?.choices?.[0]?.message?.content
      const parsed = extractPlanJson(reply)
      if (parsed === null) return { ok: false, reason: 'bad-json' }

      const rawSegments = normalizeRawSegments(parsed.segments)
      if (rawSegments.length === 0) return { ok: false, reason: 'empty-plan' }
      return { ok: true, rawSegments }
    }

    try {
      let result = await requestPlan(0.7, '')
      if (result.ok !== true && result.reason !== 'http') {
        const retry = await requestPlan(
          0.3,
          '这次只输出一个合法 JSON 对象：不要解释、不要代码块、不要注释、不要尾逗号，segments 数组必须非空。'
        )
        if (retry.ok === true) result = retry
      }
      if (result.ok !== true) return result

      // 清洗与兜底都在 core 里；这里只把结构交过去。
      const plan = buildPlan(result.rawSegments, { now: now(), source: 'model' })
      // 结构合法不代表像样：质量闸不过就整份不用，让 carryOver 接住。
      const audit = auditPlan(plan)
      if (!audit.ok) {
        log('节目单质量闸拦下：', audit.issues.join(','))
        return { ok: false, reason: 'low-quality', issues: audit.issues }
      }
      const accepted = await companion.setAgenda(plan)
      if (accepted) {
        log('节目单已生成：', JSON.stringify({ date: plan.date, segments: plan.segments.length }))
        return { ok: true, plan }
      }
      return { ok: false, reason: 'rejected' }
    } catch (error) {
      if (error?.code === 'timeout' || error?.name === 'AbortError') {
        return { ok: false, reason: 'timeout' }
      }
      log('节目单生成失败', error)
      return { ok: false, reason: 'request-failed', message: String(error?.message ?? error) }
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  /**
   * 确保今天有一份节目单。
   *
   * 幂等：同一天重复调用只会真的跑一次；并发调用共用同一个 Promise。
   * force=true 用于设置页「重新安排今天」。
   */
  async function ensure(force = false) {
    if (!enabled()) return { ok: false, reason: 'disabled' }
    const today = dateKey(now())
    if (!force && attemptedDate === today) return { ok: true, skipped: true }
    if (inflight !== null) return inflight

    inflight = run(today, force)
      .then((result) => {
        if (result.ok === false) log('节目单未更新：', result.reason)
        return result
      })
      .catch((error) => {
        log('节目单生成异常', error)
        return { ok: false, reason: 'unexpected', message: String(error?.message ?? error) }
      })
      .finally(() => {
        inflight = null
        // 成功、失败、force 都记成「今天已经试过」，避免同一天反复打模型。
        attemptedDate = today
      })
    return inflight
  }

  function reset() {
    attemptedDate = ''
  }

  return { ensure, reset, enabled }
}
