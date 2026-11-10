/**
 * 桌宠主动说话的情境层。
 *
 * 台词原来由渲染层一个静态数组轮播，跟此刻在发生什么没有关系。
 * 这里把「此刻」整理成可用的事实，再交给模型写成一句话：
 *
 *   时间  —— 几点、星期几、是不是深夜
 *   天气  —— open-meteo 免密钥接口，按设置里的城市取，30 分钟缓存
 *   陪伴  —— 这次开机陪了多久、上次被点是什么时候
 *   心情  —— 由时间与陪伴推导的轻量状态，不是独立的心情系统
 *   记忆  —— 注入 getMemoryDigest()，只取摘要，不读原始记录
 *
 * 任何一环失败都不抛错：天气拿不到就少写天气，模型调不通就退回本地短句。
 * 台词只有一句，宁可朴素，也不能让气泡空着或者报错。
 */

const CHAT_ENDPOINT = 'https://api.deepseek.com/chat/completions'
const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

import { createPresenceGate } from './presence-gate.mjs'
import { parseEmojiTag } from './companion.mjs'
import { pickWeatherAlert, describeWeatherAlert } from './weather-alert.mjs'
import { CITY_COORDS, resolveCity } from './city-coords.mjs'
import {
  buildLifestyle,
  describeLifestyle,
  localDateKey
} from '../../../packages/core/dist/browser.js'

/** 说的这一句最长多少字。气泡窄，超过就要换行了。 */
export const MAX_LINE_CHARS = 40

/** 天气缓存多久。15 分钟对一个桌面宠物来说足够新，也省得频繁打外部接口。 */
const WEATHER_TTL_MS = 15 * 60 * 1000

/**
 * 城市坐标来自 city-coords.mjs：全国地级行政区 342 个，带名称归一化与治所别名。
 * 认不出就回落 DEFAULT_CITY，但返回体保留 requested，
 * 设置页据此如实说明「你填的没生效，实际用的是哪座城」。
 */
const DEFAULT_CITY = '重庆'

/** WMO 天气代码 → 说话能用的中文。用不到的组合一律给「天气不明」。 */
const WEATHER_TEXT = {
  0: '晴',
  1: '大致晴',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '有雾',
  51: '毛毛雨',
  53: '毛毛雨',
  55: '毛毛雨',
  56: '冻雨',
  57: '冻雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '阵雪',
  86: '阵雪',
  95: '雷阵雨',
  96: '雷暴',
  99: '雷暴'
}

/**
 * 把时间翻成「人怎么感知此刻」。
 * 只做本机时区计算，不推断所在地。
 */
export function timeContext(now = new Date()) {
  const hour = now.getHours()
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  const period =
    hour < 5 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 23 ? '晚上' : '深夜'
  const hourLabel =
    hour < 5 ? '凌晨' : hour < 6 ? '天快亮' : hour < 9 ? '早上' : hour < 12 ? '上午' : hour < 14 ? '午后' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜'
  return {
    hour,
    weekday,
    period,
    hourLabel,
    dateLabel: `${now.getMonth() + 1}月${now.getDate()}日`,
    clock: `${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }
}

/**
 * 轻量心情推断。
 *
 * 这不是一个完整的心情系统，只是把「此刻更可能是什么状态」算出来，
 * 让台词有依据。每条规则都能用一句话解释，不做黑箱打分。
 */
/** 落盘里读回来的时间戳；格式不对就当没有。 */
function toDateOrNull(value) {
  if (typeof value !== 'string' || value === '') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time) : null
}

export function moodSnapshot(options) {
  const { now = new Date(), sessionStartedAt = null, lastContactAt = null, balanceLow = false } = options ?? {}
  const hour = now.getHours()
  const reasons = []

  let level = 'calm'
  let label = '安静陪着'

  if (sessionStartedAt !== null && now.getTime() - sessionStartedAt >= 3 * 60 * 60 * 1000) {
    level = 'clingy'
    label = '陪得有点久了'
    reasons.push('连续陪伴超过 3 小时')
  }
  if (lastContactAt !== null && now.getTime() - lastContactAt <= 10 * 60 * 1000) {
    level = 'bright'
    label = '刚被注意到'
    reasons.push('10 分钟内被点过')
  }
  if (balanceLow) {
    reasons.push('余额偏低')
  }
  if (hour >= 23 || hour < 5) {
    level = 'sleepy'
    label = '有点担心你还没睡'
    reasons.push('现在是深夜')
  }

  return { level, label, reasons }
}

/** 天气代码转中文；认识的给具体天气，不认识的说「天气不明」，不猜。 */
export function weatherCodeToText(code) {
  return WEATHER_TEXT[code] ?? '天气不明'
}

/** 把接口字段读成有限数；null / 空串 / 缺失一律按 null，绝不把「没拿到」当 0。 */
function asFiniteNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * 取当前天气。失败返回 { ok: false, reason }，调用方据此少写一句天气。
 */
export async function fetchWeather(options) {
  const { city = DEFAULT_CITY, fetchImpl = globalThis.fetch, timeoutMs = 4000, now = null } = options ?? {}
  const name = String(city ?? '').trim() || DEFAULT_CITY
  // resolveCity 负责归一化：「重庆市」「湖南益阳」「红河哈尼族彝族自治州」「延吉」都认。
  // 认不出才回落默认城，resolved 与 requested 的差值就是给设置页看的证据。
  const hit = resolveCity(name)
  const coords = hit ?? CITY_COORDS[DEFAULT_CITY]
  const resolved = hit ? hit.city : DEFAULT_CITY

  const url =
    `${WEATHER_ENDPOINT}?latitude=${coords.latitude}&longitude=${coords.longitude}` +
    '&current=temperature_2m,apparent_temperature,weather_code&timezone=Asia%2FShanghai' +
    '&hourly=precipitation,weather_code,wind_speed_10m,temperature_2m,snowfall&forecast_days=2'

  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, controller === null ? {} : { signal: controller.signal })
    if (!response.ok) return { ok: false, reason: `http-${response.status}` }
    const body = await response.json()
    const current = body?.current ?? {}
    const temp = asFiniteNumber(current.temperature_2m)
    if (temp === null) return { ok: false, reason: 'bad-payload' }
    // 体感温度缺失时退回实际温度；字段为 null 时也退回，而不是把 null 读成 0℃。
    const feels = asFiniteNumber(current.apparent_temperature)
    const code = asFiniteNumber(current.weather_code)
    // 提醒只从逐小时预报里算，缺 hourly 就只是没有提醒，不影响当前天气。
    const anchor = now instanceof Date ? now : new Date()
    const alert = pickWeatherAlert(body?.hourly, { now: anchor })
    return {
      ok: true,
      city: resolved,
      requested: name,
      temperature: Math.round(temp),
      feelsLike: Math.round(feels ?? temp),
      // 天气代码缺失时不猜「晴」，如实说天气不明。
      text: code === null ? '天气不明' : weatherCodeToText(code),
      code,
      alert,
      alertNote: alert === null ? '' : describeWeatherAlert(alert, anchor)
    }
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * 拼给模型的指令。
 *
 * 约束写得硬一点：模型很容易写成客服腔或者解释自己，
 * 这里明确「一句话、不用引号、不解释、不列举」。
 */
export function buildBubblePrompt(context) {
  const {
    nickname = '',
    personaText = '',
    timeCtx,
    weather = null,
    weatherAlertNote = '',
    mood = null,
    memoryDigest = '',
    recentLines = [],
    motions = null,
    companionNote = '',
    emojiCandidates = [],
    focusText = '',
    bodyNote = '',
    lifestyleNote = '',
    environmentNote = '',
    anniversaryNote = '',
    screenNote = ''
  } = context ?? {}
  const cleanNickname = typeof nickname === 'string' ? nickname.trim() : ''
  const who = cleanNickname === '' ? '对方' : cleanNickname
  // 记忆摘要与最近台词做类型守卫：显式传 null / 非数组不会抛 TypeError。
  const digest = typeof memoryDigest === 'string' ? memoryDigest.trim() : ''
  const lines = Array.isArray(recentLines)
    ? recentLines.filter((item) => typeof item === 'string' && item.trim() !== '')
    : []

  const facts = [
    `现在是${timeCtx.dateLabel} ${timeCtx.weekday} ${timeCtx.clock}，${timeCtx.hourLabel}。`
  ]
  if (weather !== null && weather.ok === true) {
    facts.push(`外面${weather.city}${weather.text}，${weather.temperature}℃。`)
  } else if (weather !== null) {
    // 请求失败（非用户主动关天气）时，明确告诉模型别自己编一套天气出来。
    facts.push('天气数据暂时没拿到，不要编造天气。')
  }
  // 预警只报一条，而且是「预报里看着像」的口气，不冒充气象台。
  const alertNote = typeof weatherAlertNote === 'string' ? weatherAlertNote.trim() : ''
  if (alertNote !== '') {
    facts.push(`预报里提到：${alertNote.endsWith('。') ? alertNote : `${alertNote}。`}可以说一句提醒，但别念成播报。`)
  }
  // 节日与穿搭来自 core 的纯逻辑；没有温度就没有穿搭，没有节日就没有节日句。
  const lifestyle = typeof lifestyleNote === 'string' ? lifestyleNote.trim() : ''
  if (lifestyle !== '') {
    facts.push(lifestyle.endsWith('。') ? lifestyle : `${lifestyle}。`)
  }
  if (mood !== null) {
    facts.push(`你此刻的状态：${mood.label}。`)
  }
  if (digest !== '') {
    facts.push(`你记得的事：${digest}`)
  }
  if (lines.length > 0) {
    facts.push(`最近说过的话，别重复：${lines.join(' / ')}`)
  }
  // 有话头到点时，只把这一条递到眼前；其他没聊完的事仍然留在陪伴层里。
  const focus = typeof focusText === 'string' ? focusText.trim() : ''
  if (focus !== '') {
    facts.push(`上次有件事还没说完：${focus}。可以顺着它轻轻问一句，别追问。`)
  }
  // 陪伴层带来的是「此刻的自己」：真实心情与还没聊完的事。
  // 它是多行的，单独成段，避免和其他单句事实混在一起读成一条。
  const companion = typeof companionNote === 'string' ? companionNote.trim() : ''
  if (companion !== '') facts.push(companion)
  // 身体感觉只给一句，不报数值；累的时候说话自然短一点。
  const body = typeof bodyNote === 'string' ? bodyNote.trim() : ''
  if (body !== '') facts.push(`你此刻的身体感觉：${body}。`)
  // 余额与电脑状态：只在她真的注意到时才提，不每句都念。
  const environment = typeof environmentNote === 'string' ? environmentNote.trim() : ''
  if (environment !== '') facts.push(`你顺手看到的事：${environment}`)
  // 纪念日只在临近时出现，而且必须有原话作证。
  const anniversary = typeof anniversaryNote === 'string' ? anniversaryNote.trim() : ''
  if (anniversary !== '') facts.push(`你记得的日子：${anniversary}`)
  // 识屏只给读到的字；说到哪算哪，不要假装看见了画面。
  const screen = typeof screenNote === 'string' ? screenNote.trim() : ''
  if (screen !== '') {
    facts.push(`你刚瞥了一眼屏幕，上面有这些字：${screen}。只是瞥见，别逐条念，也别猜图里有什么。`)
  }
  // 动作清单来自渲染层真实探测：探测不到能力就不给清单，模型也就无从瞎点。
  const motionList = describeMotions(motions)
  if (motionList !== '') {
    facts.push(`你此刻能做的动作：${motionList}。`)
  }

  const system = [
    typeof personaText === 'string' && personaText.trim() !== ''
      ? personaText.trim()
      : '你是一个安静、温柔的桌面伙伴。',
    '',
    '现在你要主动说一句很短的话，像坐在旁边随口说的，不是回答问题。',
    `要求：只输出一句话，不超过 ${MAX_LINE_CHARS} 个字；不要引号、不要括号、不要直接打 emoji 字符；`,
    '不要解释你在做什么，不要列点，不要问候模板，不要提到「根据时间」「根据天气」这类分析口吻。',
    '如果没什么可说的，就写一句安静的陪伴感，不要硬凑信息。',
    ...(motionList === ''
      ? []
      : [
          '',
          '你可以在句子最后单独加一个动作标记来控制自己的身体，格式必须是 [动作:名称]，',
          '名称只能从上面「你此刻能做的动作」里挑一个；这句话配不上动作就什么标记都不要加。',
          '标记不算进字数，也不要写在引号里，不要解释它。'
        ]),
    ...(Array.isArray(emojiCandidates) && emojiCandidates.length > 0
      ? [
          '',
          '也可以配一张小表情，在整句最后单独写 [图:id]。id 只能从这些里面挑：',
          emojiCandidates.join('、'),
          '配不上就不写，不要用别的写法，也不要解释这个标记。'
        ]
      : [])
  ].join('\n')

  const user = [`对方叫${who}。`, ...facts].join('\n')
  return { system, user }
}

/**
 * 把渲染层探测到的动作能力写成一句人话。
 * 只列真的能播的（actions 是渲染层按通道筛过的），标签用中文，模型更好挑。
 */
export function describeMotions(motions) {
  if (motions === null || typeof motions !== 'object') return ''
  const actions = Array.isArray(motions.actions) ? motions.actions : []
  if (actions.length === 0) return ''
  const labels = motions.labels ?? {}
  return actions
    .map((key) => (typeof labels[key] === 'string' && labels[key] !== '' ? `${labels[key]}(${key})` : String(key)))
    .join('、')
}

/** 动作标记：带捕获组，用于取出动作名。 */
const MOTION_TAG_PATTERN = /[[【(（]\s*动作\s*[:：]\s*([^\]】)）\n]{1,24})\s*[\]】)）]/
/** 同上但不捕获、全局，用于清洗时把标记整段抹掉。 */
const MOTION_TAG_GLOBAL = /[[【(（]\s*动作\s*[:：]\s*[^\]】)）\n]{1,24}\s*[\]】)）]/g

/**
 * 从模型输出里摘出动作标记。
 *
 * 要在 cleanBubbleLine 之前调用：清洗会只保留第一个句号前的内容，
 * 句末的标记会被一起砍掉。cleanBubbleLine 里也留了一道剥标记的兜底，
 * 万一顺序被人改动，气泡里也不会漏出 `sleepyNod]` 这种残骸。
 * 认 `[动作:x]`、`【动作：x】`、`(动作: x)` 三种写法，只取第一个，其余原样留着。
 *
 * @returns {{text:string, motion:string|null}}
 */
export function parseMotionTag(raw) {
  if (typeof raw !== 'string') return { text: '', motion: null }
  const hit = raw.match(MOTION_TAG_PATTERN)
  if (hit === null) return { text: raw, motion: null }
  const motion = hit[1].trim()
  return {
    text: raw.replace(hit[0], '').trim(),
    motion: motion === '' ? null : motion
  }
}

/**
 * 清洗模型输出。
 *
 * 模型常见的越界：包引号、加「昔涟：」、换行写解释、一句话写成两句、
 * 混进动作标记。这里只保留第一句有效内容，超长直接截断，
 * 空内容返回 null 让调用方回落。
 */
export function cleanBubbleLine(raw) {
  if (typeof raw !== 'string') return null
  let text = raw.trim()
  if (text === '') return null

  // 先抹掉动作标记，否则「只取第一句」会把标记切成半截留在气泡里。
  text = text.replace(MOTION_TAG_GLOBAL, '').trim()
  if (text === '') return null
  // 去掉整段包裹的引号 / 括号。
  text = text.replace(/^["'“”‘’「『（(]+/, '').replace(/["'“”‘’」』）)]+$/, '')
  // 去掉「昔涟：」「她：」这类说话人前缀；
  // 排除「12:30 的时候」这类时间开头：数字冒号不是说话人。
  text = text.replace(/^(?!\d{1,2}[:：])[^：:\n]{1,8}[：:]\s*/, '')
  // 只取第一行，再取第一个句号/问号/感叹号之前的部分。
  text = text.split(/\r?\n/)[0]
  const firstSentence = text.match(/^[^。！？!?]*[。！？!?]?/)
  if (firstSentence !== null && firstSentence[0].trim() !== '') text = firstSentence[0]
  text = text.replace(/\s+/g, ' ').trim()

  if (text === '') return null
  if ([...text].length > MAX_LINE_CHARS) {
    text = [...text].slice(0, MAX_LINE_CHARS).join('').trim()
  }
  return text === '' ? null : text
}

/**
 * 没有模型时说的话。
 *
 * 这些句子也读时间，所以不会出现「凌晨三点说早安」。
 * 只在这一层兜底，不在模型可用时使用。
 */
export function fallbackLine(timeCtx, mood) {
  const byHour = timeCtx.hour
  const pool =
    byHour < 5
      ? ['这个点还醒着呀……要不要先喝口水？', '夜里很安静，人家就在这儿陪你。', '再不睡，明天会困的哦。']
      : byHour < 9
        ? ['早上好，今天也慢慢来就好。', '窗外的光刚亮起来呢。', '先伸个懒腰再开始吧。']
        : byHour < 12
          ? ['上午好呀，别一直坐着。', '手边有水吗？记得喝一口。', '忙归忙，也要喘口气。']
          : byHour < 14
            ? ['中午了，吃点东西吧。', '午后的风有点软呢。', '歇一会儿再继续，好不好？']
            : byHour < 18
              ? ['下午了，眼睛也该歇一歇。', '要不要站起来走两步？', '人家在这儿，不吵你。']
              : byHour < 23
                ? ['晚上好呀，今天辛苦了。', '灯光暗一点，眼睛会舒服些。', '忙完了就早点休息吧。']
                : ['夜深了，把今天放下吧。', '睡不着的话，人家陪你数星星。', '明天的事，明天再说。']

  if (mood !== null && mood.level === 'clingy') {
    pool.push('今天陪了你很久呢，有点开心。')
  }
  if (mood !== null && mood.level === 'bright') {
    pool.push('刚才那一下，人家记住啦。')
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * 调一次模型。返回 { ok, line } 或 { ok: false, reason }，不抛错。
 *
 * 空的 content 在两种情况下都会出现：推理模型把预算烧在 reasoning_content 上，
 * 或者模型只回了一个动作/表情标记。80 tokens 对前者太紧，`empty` 会反复刷日志，
 * 所以这里给足预算，并在空结果时换低一点的温度再问一次。
 */
async function requestLine(options) {
  const {
    apiKey,
    model = 'deepseek-chat',
    prompt,
    // 这一轮允许的图 id；不在列表里的标记会被丢掉，避免模型编一个不存在的文件。
    allowedEmoji = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000
  } = options

  async function requestOnce(temperature, extraHint, maxTokens) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: extraHint === '' ? prompt.user : `${prompt.user}\n${extraHint}` }
          ],
          // 推理模型的 reasoning 也占预算：deepseek-reasoner 给足额度，
          // 普通模型维持 320 挡住「只回一个标记」。
          max_tokens: maxTokens,
          temperature
        }),
        ...(controller === null ? {} : { signal: controller.signal })
      })
      if (!response.ok) return { ok: false, reason: `http-${response.status}` }
      const body = await response.json()
      const message = body?.choices?.[0]?.message ?? {}
      const content = typeof message.content === 'string' ? message.content : ''
      // 先摘表情标记，再摘动作标记，最后清洗：两个标记都可能在句末，
      // 而 cleanBubbleLine 只保留第一句话，晚一步就再也取不到了。
      const pictured = parseEmojiTag(content, allowedEmoji)
      const tagged = parseMotionTag(pictured.text)
      const line = cleanBubbleLine(tagged.text)
      if (line === null) {
        return {
          ok: false,
          reason: 'empty',
          // 诊断用：只记长度与结束原因，不把模型原文写进日志。
          detail: `len=${content.length} finish=${String(body?.choices?.[0]?.finish_reason ?? '')}`
        }
      }
      return { ok: true, line, motion: tagged.motion, emojiId: pictured.emojiId }
    } catch (error) {
      return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'network' }
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  const isReasoner = String(model ?? '').includes('reasoner')
  const first = await requestOnce(1.05, '', isReasoner ? 800 : 320)
  if (first.ok === true) return first
  // 网络/超时/HTTP 错误重试没有意义；只对「模型回了个空」再给一次机会。
  if (first.reason !== 'empty') return first
  const second = await requestOnce(0.85, '直接说一句 40 字以内的话，不要只写动作或表情标记。', 800)
  if (second.ok === true) return second
  return { ...second, detail: second.detail ?? first.detail }
}

/**
 * 情境服务。
 *
 * 依赖全部注入，主进程只负责提供设置、密钥和记忆摘要；
 * 这个模块不碰窗口，也不写文件，方便单测。
 */
export function createPresenceService(options) {
  const {
    getSettings,
    getApiKey,
    getMemoryDigest,
    getPersonaText,
    // 渲染层上报的动作能力；主进程不传就等于「没有动作可点」，提示词里也不会出现清单。
    getMotionCatalog = null,
    // 陪伴层：可选。没注入时主动说话仍按时间与陪伴推导的轻量心情走。
    getCompanion = null,
    // 情绪决策：可选。注入后状态栏会把「余波 + 表情实验」的结果一起带出去。
    // 不注入时退回按心情档位映射，行为与旧版一致。
    decideEmotion = null,
    // 身体层：可选。只给一句体感，不传就少一段，不影响这句话本身。
    getBodyNote = null,
    // 余额 / 电脑状态：可选。拿不到或采样过期就当作没看见。
    getEnvironmentNote = null,
    // 纪念日：可选。只从有原话作证、且就在这几天的记录里来。
    getAnniversaryNote = null,
    // 识屏：可选。没打开或读不到就当作没看见。
    getScreenNote = null,
    // 余额是否真的低于阈值：可选。由上层读余额监控的真实状态，
    // 「设了提醒阈值」不等于「余额真的低」。
    getBalanceLow = null,
    fetchImpl = globalThis.fetch,
    log = () => {},
    now = () => new Date(),
    // 主动开口的账跨重启：调用方给读写回调，模块本身仍然不碰文件。
    loadState = null,
    saveState = null
  } = options

  const restored = readPersistedState()
  // 这次开机陪了多久也跨重启：连着陪了三个小时，重启不该清零。
  let sessionStartedAt = toDateOrNull(restored?.sessionStartedAt) ?? now()
  let lastContactAt = toDateOrNull(restored?.lastContactAt)
  let weatherCache = null
  const recentLines = []
  // 主动开口前的三道闸：安静时段、每日上限、连续没回应。
  const gate = createPresenceGate({ now, initial: restored?.gate ?? null })

  function readPersistedState() {
    if (typeof loadState !== 'function') return null
    try {
      const value = loadState()
      return value !== null && typeof value === 'object' ? value : null
    } catch (error) {
      log('[presence] 上次的开口账没读出来', String(error?.message ?? error))
      return null
    }
  }

  function persistPresence() {
    if (typeof saveState !== 'function') return
    try {
      saveState({
        lastContactAt: lastContactAt === null ? null : lastContactAt.toISOString(),
        sessionStartedAt: sessionStartedAt.toISOString(),
        gate: gate.snapshot()
      })
    } catch (error) {
      log('[presence] 这次的开口账没存住', String(error?.message ?? error))
    }
  }

  function readSettings() {
    return getSettings() ?? {}
  }

  function balanceLowNow() {
    try {
      return typeof getBalanceLow === 'function' && getBalanceLow() === true
    } catch {
      return false
    }
  }

  async function currentWeather() {
    const stamp = now().getTime()
    if (weatherCache !== null && stamp - weatherCache.at < WEATHER_TTL_MS) return weatherCache.value
    const city = readSettings()?.presence?.city
    // 超时放宽到 6 秒，网络偶发抖动时重试一次，减少「天气拿不到就少写天气」的概率。
    let value = await fetchWeather({ city, fetchImpl, timeoutMs: 6000 })
    if (value.ok !== true) {
      value = await fetchWeather({ city, fetchImpl, timeoutMs: 6000 })
    }
    if (value.ok !== true) {
      log('[presence] 天气获取失败', value?.reason ?? 'unknown', '城市:', String(city ?? ''))
      // 失败结果不缓存：一次网络抖动不该让接下来 15 分钟都拿不到天气。
      return value
    }
    weatherCache = { at: stamp, value }
    return value
  }

  /**
   * 今天是什么日子、外面该穿什么。
   *
   * 节日不依赖天气；天气拿不到时只缺穿搭，不会把节日一起吞掉。
   * 关掉天气开关时同样保留节日。prefetched 给 nextLine 复用同一份天气，
   * 避免「判断一次开关、又按开关再取一次」的双重判断散在两处。
   */
  async function currentLifestyle(prefetched = undefined) {
    const settings = readSettings()
    const weather =
      prefetched !== undefined
        ? prefetched
        : settings?.presence?.useWeather === false
          ? null
          : await currentWeather()
    const feelsLike =
      weather !== null && weather.ok === true
        ? typeof weather.feelsLike === 'number'
          ? weather.feelsLike
          : weather.temperature
        : null
    return buildLifestyle({ dateKey: localDateKey(now()), feelsLike })
  }

  async function currentLifestyleNote() {
    return describeLifestyle(await currentLifestyle())
  }

  /** 记录一次互动，供心情与「别重复」使用。 */
  function noteContact(at = now()) {
    lastContactAt = at
    persistPresence()
  }

  function noteSpoken(line, reason = 'auto') {
    if (typeof line !== 'string' || line.trim() === '') return
    recentLines.push(line.trim())
    while (recentLines.length > 5) recentLines.shift()
    // 手动 / 试一句 / 兜底句不占「主动开口」的每日额度；自动开口的额度在
    // nextLine 开头已经用 claim 原子占好，这里只记台词与账本。
    persistPresence()
  }

  /**
   * 生成下一句。
   *
   * reason：auto 定时开口 / manual 被点 / wake 窗口重新出现。
   * 无论哪条路径，返回的都是可以直接塞进气泡的一句话。
   */
  async function nextLine(reason = 'auto', focusText = '') {
    const settings = readSettings()
    const timeCtx = timeContext(now())

    // 检查与占位在同一个同步调用里完成：三条入口并发时也不可能同时通过额度。
    const claimResult = gate.claim({ settings, reason, lastContactAt })
    if (claimResult.ok === false) {
      return {
        ok: false,
        reason: claimResult.reason,
        detail: claimResult.detail,
        line: '',
        source: 'gate',
        blocked: true,
        timeCtx,
        mood: null,
        weather: null
      }
    }
    const mood = moodSnapshot({
      now: now(),
      sessionStartedAt,
      lastContactAt,
      balanceLow: balanceLowNow()
    })

    // 天气只取一次：下一句的穿搭也复用这一份，不在两个函数里各判一次开关。
    const weather = settings?.presence?.useWeather === false ? null : await currentWeather()
    const lifestyle = await currentLifestyle(weather)

    // 陪伴层给的是「跨对话一直在的自己」：真实心情、没聊完的话头、能配哪几张图。
    // 任何一项拿不到都只是少一段，不影响这句话本身。
    const companion = typeof getCompanion === 'function' ? getCompanion() : null
    const companionNote =
      companion !== null && typeof companion?.presenceNote === 'function'
        ? (await companion.presenceNote()) ?? ''
        : ''
    const emojiCandidates =
      companion !== null && typeof companion?.emojiCandidates === 'function'
        ? ((await companion.emojiCandidates(3)) ?? [])
        : []

    const prompt = buildBubblePrompt({
      nickname: settings?.nickname ?? '',
      personaText: typeof getPersonaText === 'function' ? getPersonaText(settings) : '',
      timeCtx,
      weather,
      weatherAlertNote: weather?.alertNote ?? '',
      mood,
      memoryDigest: typeof getMemoryDigest === 'function' ? getMemoryDigest() ?? '' : '',
      recentLines,
      // 渲染层探测到的真实动作能力；探测不到就是 null，模型那边不会出现动作清单。
      motions: typeof getMotionCatalog === 'function' ? getMotionCatalog() ?? null : null,
      companionNote,
      emojiCandidates,
      focusText,
      bodyNote: typeof getBodyNote === 'function' ? (await getBodyNote()) ?? '' : '',
      lifestyleNote: describeLifestyle(lifestyle),
      environmentNote:
        typeof getEnvironmentNote === 'function' ? (await getEnvironmentNote()) ?? '' : '',
      anniversaryNote:
        typeof getAnniversaryNote === 'function' ? (await getAnniversaryNote()) ?? '' : '',
      screenNote: typeof getScreenNote === 'function' ? (await getScreenNote()) ?? '' : ''
    })

    let apiKey = ''
    try {
      apiKey = (await getApiKey()) ?? ''
    } catch (error) {
      log('[presence] 取密钥失败', String(error?.message ?? error))
    }

    if (apiKey === '') {
      // 兜底句不占额度：已经占位的名额退回去，别让一次配置问题烧掉一天的开口。
      if (claimResult.claimed === true) gate.release()
      const line = fallbackLine(timeCtx, mood)
      noteSpoken(line, reason)
      return { ok: false, reason: 'no-key', line, source: 'fallback', timeCtx, mood, weather }
    }

    const result = await requestLine({
      apiKey,
      model: settings?.companion?.chat?.model ?? 'deepseek-chat',
      prompt,
      allowedEmoji: emojiCandidates,
      fetchImpl
    })
    if (result.ok === false) {
      log('[presence] 生成失败', result.reason)
      // 模型失败退的本地句同样不烧额度：连续失败不该把今天的主动开口全用光。
      if (claimResult.claimed === true) gate.release()
      const line = fallbackLine(timeCtx, mood)
      noteSpoken(line, reason)
      return { ok: false, reason: result.reason, line, source: 'fallback', timeCtx, mood, weather }
    }

    noteSpoken(result.line, reason)
    return {
      ok: true,
      line: result.line,
      // AI 自己挑的动作；没挑就是 null，渲染层退回按心情驱动。
      motion: typeof result.motion === 'string' && result.motion !== '' ? result.motion : null,
      // AI 自己挑的表情 id；渲染层换成素材地址贴在气泡里，null 表示这句不配图。
      emojiId: typeof result.emojiId === 'string' && result.emojiId !== '' ? result.emojiId : null,
      source: 'model',
      timeCtx,
      mood,
      weather
    }
  }

  /**
   * 状态栏用：只算心情，不取天气、不动网络。
   * 规则与 nextLine 里那份完全一致，避免状态栏和台词各说各的。
   */
  /**
   * 心情档位 → 表情情绪。
   *
   * 和渲染层 expression.mjs 的 MOOD_LEVEL_EMOTION 保持一致。
   * 四档心情只够选四张脸；等余波接进来以后，这里换成
   * emotionRuntime.decideExpression() 的 tag 就行，通道协议不用再改。
   */
  const MOOD_EMOTION = {
    calm: 'gentle',
    bright: 'happy',
    clingy: 'shy',
    sleepy: 'tired'
  }

  function currentMood() {
    const settings = readSettings()
    const mood = moodSnapshot({
      now: now(),
      sessionStartedAt,
      lastContactAt,
      balanceLow: balanceLowNow()
    })
    // emotion 给渲染层选表情用；mood 本身的 label / level 保持原样，不改变旧调用方。
    const baseEmotion = MOOD_EMOTION[mood?.level] ?? 'neutral'
    let emotion = baseEmotion
    if (typeof decideEmotion === 'function') {
      try {
        // 传 'neutral' 表示「这一轮没有新的明确情绪」，让余波有机会接管。
        // 直接拿心情档位去问的话，余波永远进不来：它只在 base 为 neutral 时才被读取。
        const afterglow = decideEmotion('neutral')
        // 只认 changed === true：关闭、对照组、内部出错都会返回 changed=false，
        // 这时候 tag 不可信，必须守住心情档位。
        if (
          afterglow !== null &&
          afterglow.changed === true &&
          typeof afterglow.tag === 'string' &&
          afterglow.tag !== ''
        ) {
          emotion = afterglow.tag
        }
      } catch (error) {
        // 表情决策坏了不能让状态栏跟着坏；退回档位映射就够了。
        log('[presence] 情绪决策失败', String(error?.message ?? error))
      }
    }
    return { ...mood, emotion }
  }

  /** 设置页诊断用：此刻会给模型看什么。不含密钥。 */
  async function peekContext() {
    const settings = readSettings()
    const timeCtx = timeContext(now())
    // 与 nextLine / currentMood 同一份心情口径：余额偏低也传进去。
    const mood = moodSnapshot({
      now: now(),
      sessionStartedAt,
      lastContactAt,
      balanceLow: balanceLowNow()
    })
    const weather = settings?.presence?.useWeather === false ? null : await currentWeather()
    return {
      time: timeCtx,
      mood,
      weather,
      lifestyle: await currentLifestyle(weather),
      sessionMinutes: Math.max(0, Math.round((now().getTime() - sessionStartedAt.getTime()) / 60000)),
      recentLines: [...recentLines]
    }
  }

  return {
    nextLine,
    noteContact,
    noteSpoken,
    peekContext,
    currentMood,
    currentLifestyle,
    currentLifestyleNote
  }
}
