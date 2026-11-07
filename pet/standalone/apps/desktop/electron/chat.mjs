/**
 * 聊天服务：把「设置 + 密钥 + 历史」拼成一次对话请求。
 *
 * 这里只管协议与状态，不碰窗口、不碰渲染层：
 * - 密钥由调用方从加密仓库取，本模块不写日志
 * - 端点写死在这里，渲染侧无法指定别的地址
 * - 历史落盘通过注入的 persistTurn / persistClear，本模块不碰文件系统
 * - 失败一律回结构化 reason，界面据此写清楚原因，不假装成功
 */

import { buildCompanionNote, parseEmojiTag } from './companion.mjs'
import { buildSocialNote, detectLanguagePlay, matchWake } from './social.mjs'
import { fixMisattributedQuote, guardReply, shouldStaySilent } from './reply-guard.mjs'

/**
 * 摘出 [[表情:标签]]，只取第一个。
 * 标签交给调用方去表情库匹配，聊天层不碰文件系统。
 */
function parseStickerTag(text) {
  const source = typeof text === 'string' ? text : ''
  // 模型有时会把 [[表情:x]] 写成全角 ［［表情:x］］ 或 【表情：x】，几种都认。
  const match =
    source.match(/[\[［]{2}\s*表情\s*[:：]\s*([^\]］\n]{1,24})\s*[\]］]{2}/) ??
    source.match(/【\s*表情\s*[:：]\s*([^】\n]{1,24})\s*】/)
  if (match === null) return { text: source, label: null }
  return {
    text: source.replace(match[0], '').replace(/[ \t]{2,}/g, ' ').trim(),
    label: match[1].trim()
  }
}

const CHAT_ENDPOINT = 'https://api.deepseek.com/chat/completions'
const CHAT_TIMEOUT_MS = 45_000

/** 单条消息长度上限：防止一次粘贴把上下文撑爆。 */
const MAX_MESSAGE_CHARS = 4_000

/** 从磁盘恢复时最多接回多少条，避免一次开机把旧历史全塞进内存。 */
const MAX_RESTORED_TURNS = 200

/**
 * 送进模型的历史总字符上限。
 *
 * 只按轮数裁不够：一轮里如果粘了长文，10 轮就能把上下文推到几万字符。
 * 从最近往回按整轮累加，超预算就停；最近一轮无论多长都保留，避免只剩半句话。
 */
const HISTORY_CHAR_BUDGET = 12_000

/** 目前唯一支持的服务商。自定义端点不开放，避免把 Key 发到任意地址。 */
const SUPPORTED_PROVIDER = 'deepseek'

/**
 * 外部渠道的人话标签。
 *
 * 网关只把纯文本送进来，模型看不到发送者是谁；只靠上下文里「QQ」两个字，
 * 它很容易把群里的人当成坐在电脑前的人。所以在每条外部消息前钉一个来源标记，
 * 让「是谁在说话」成为结构信息，而不是需要模型自己猜的线索。
 * 桌面窗口本身不加前缀。
 */
function sourceLabel(source) {
  if (source === null || typeof source !== 'object') return ''
  if (source.channel !== 'qq') return ''
  return source.chatType === 'group' ? 'QQ 群聊' : 'QQ 私聊'
}

/**
 * 记忆作用域：桌面一份，QQ 每个会话一份。
 * 群聊和私聊分开，不同的人也不共用好感与事实。
 */
function scopeOf(source) {
  if (source === null || typeof source !== 'object') return 'desktop'
  if (typeof source.channel !== 'string' || source.channel === '') return 'desktop'
  if (source.channel !== 'qq') return 'desktop'
  const chatType = source.chatType === 'group' ? 'group' : 'private'
  const openId = typeof source.openId === 'string' ? source.openId.trim() : ''
  return openId === '' ? `qq:${chatType}` : `qq:${chatType}:${openId}`
}

/**
 * 群聊里的说话人代号。
 *
 * QQ 网关只给 openid，没有昵称。这里用 openid 末尾四位生成一个稳定代号：
 * 同一个人每次都得到同一个标记，模型才有条件分清「谁说的」。
 * 主人单独标出来——主人和群友说话的分量不一样。
 */
export function describeSpeaker(source) {
  if (source === null || typeof source !== 'object') return ''
  if (source.channel !== 'qq' || source.chatType !== 'group') return ''
  if (source.isOwner === true) return '主人'
  const raw = typeof source.senderOpenId === 'string' ? source.senderOpenId : ''
  const clean = raw.replace(/[^0-9a-zA-Z]/g, '')
  if (clean === '') return '群友'
  return `群友·${clean.slice(-4).toLowerCase()}`
}

/** 这条消息真正送进模型的形态：来源 + 说话人 + 原文。 */
export function wireContent(text, source) {
  const label = sourceLabel(source)
  if (label === '') return text
  const who = describeSpeaker(source)
  return who === '' ? `［${label}］${text}` : `［${label}｜${who}］${text}`
}

/** 给模型的「此刻在哪里说话」说明。桌面窗口不需要。 */
function sourceNote(source) {
  const label = sourceLabel(source)
  if (label === '') return ''
  const lines = [
    `这条消息来自 ${label}，不是屏幕前的人直接说的。你的回复会原样转回 ${label}：`,
    '- 保持简短，一两句就够，别写成文章；',
    '- 不要提桌面上的操作、文件、窗口，也不要假设你能看到对方的屏幕；',
    '- 不要把 QQ 上的人当成此刻坐在电脑前的人。'
  ]
  if (source?.chatType === 'group') {
    lines.push(
      '- 每条消息前的方括号写明是谁说的：主人，或群友·xxxx。不同代号就是不同的人，同一代号才是同一个人。',
      '- 「你」只指当前这条消息的发送者。不要把别人说过的话安到他头上，也不要把他的话当成全群的共识。',
      '- 要复述别人的观点时，说清是哪一位说的；不确定是谁说的，就别用「你刚才说」这种断言。',
      '- 群友之间互相 @ 的内容是他们的对话，不要当成在叫你；只有单独叫你的名字才算找你。'
    )
  }
  return lines.join('\n')
}

/**
 * 拼 system 文本。人格由 persona 模块提供，记忆片段由存储层提供，
 * 陪伴层片段由 companion 提供，这里只负责把它们按固定顺序接起来，不自己编内容。
 *
 * 顺序固定：人格 → 长期记忆 → 这一轮的心情/相关记忆/话头/表情候选。
 * 越靠后越像「此刻正在发生」的事，模型也更容易把它当成当下的语气，而不是资料。
 */
/**
 * system 各段的字符预算。
 *
 * 人格段不设上限：它决定她是谁，截断会直接改人格。
 * 其余片段都是「这一轮的上下文」，超了说明上游本该收敛；
 * 这里按字符数兜底，避免一份长记忆把整轮预算吃光。
 */
export const SYSTEM_SECTION_BUDGETS = {
  memory: 600,
  fact: 400,
  companion: 500,
  affinity: 200,
  source: 200,
  social: 300,
  proactive: 200,
  review: 200,
  body: 200,
  // 贴近时刻的分寸：比身体感觉长一点，但只在这一轮真的允许靠近时才出现。
  intimacy: 420,
  sticker: 300
}

/** 按 Unicode 码点裁，避免把表情或代理对劈成半个字符。 */
export function clampSection(text, budget) {
  if (typeof text !== 'string') return ''
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const chars = Array.from(trimmed)
  if (chars.length <= budget) return trimmed
  return `${chars.slice(0, budget).join('')}…`
}

/** 注入项单项兜底时间：任何一项卡住，都不能把整轮回复拖死。 */
const INJECTION_TIMEOUT_MS = 3_000

/**
 * 单项注入的超时兜底。
 *
 * 任务先接住 rejection，避免超时后原 Promise 继续跑、最后冒出一个没人处理的错误。
 */
export function withTimeout(task, fallback, timeoutMs = INJECTION_TIMEOUT_MS) {
  const guarded = Promise.resolve()
    .then(task)
    .catch(() => fallback)
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs)
  })
  return Promise.race([guarded, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer)
  })
}

/**
 * 把提示词拆成两个槽。
 *
 * stable：人格、从哪儿来、这群人怎么说话。一轮之内不会变，固定放在最前面，
 *         这样连续对话时前缀能命中缓存，不必每次都重新读一遍人格。
 * turn：这一轮的记忆、心情、话头、体感。每次都可能不同，单独随本轮输入送进去，
 *       不写进历史，也不会把「此刻」凝固成以后还要遵守的资料。
 */
function buildPromptSections({
  personaText,
  memoryText,
  companionNote = '',
  stickerHint = '',
  affinityNote = '',
  factNote = '',
  sourceNoteText = '',
  socialNote = '',
  proactiveNote = '',
  reviewNote = '',
  bodyNote = '',
  intimacyNote = ''
}) {
  const persona =
    typeof personaText === 'string' && personaText.trim() !== ''
      ? personaText.trim()
      : '做一个简洁、友好的桌面对话伙伴。'
  const stable = [persona]

  // 来源说明紧跟人格：先知道「在哪儿说」，后面所有资料才不会被放到错的场合里。
  const source = clampSection(sourceNoteText, SYSTEM_SECTION_BUDGETS.source)
  if (source !== '') {
    stable.push('', source)
  }
  // 社交语感也属于稳定前缀：这群人怎么说话，不会因为这一句而改变。
  const social = clampSection(socialNote, SYSTEM_SECTION_BUDGETS.social)
  if (social !== '') {
    stable.push('', social)
  }

  const turn = []
  const memory = clampSection(memoryText, SYSTEM_SECTION_BUDGETS.memory)
  if (memory !== '') {
    turn.push('下面是你记得的早前对话。只在和当前话题相关时自然用上，不要逐条复述：')
    turn.push(memory)
  }
  // 结构化事实放在长期记忆之后：先有原文摘要，再有整理过的偏好/人物/项目/约定。
  const fact = clampSection(factNote, SYSTEM_SECTION_BUDGETS.fact)
  if (fact !== '') {
    turn.push('', '你还记得这些（不用逐条提，合适的时候自然用上）：', fact)
  }
  const companion = clampSection(companionNote, SYSTEM_SECTION_BUDGETS.companion)
  if (companion !== '') {
    turn.push('', companion)
  }
  // 关系状态放在心情之后：越靠后越像「此刻」，但不抢人格的位置。
  const affinity = clampSection(affinityNote, SYSTEM_SECTION_BUDGETS.affinity)
  if (affinity !== '') {
    turn.push('', affinity)
  }
  // 未结论的话头：告诉模型「这件事问过，别机械地再问一遍」。
  const review = clampSection(reviewNote, SYSTEM_SECTION_BUDGETS.review)
  if (review !== '') {
    turn.push('', review)
  }
  // 身体感觉紧跟话头：它影响的是这一轮的语气与句子长短，不该被当成资料。
  const body = clampSection(
    typeof bodyNote === 'string' && bodyNote.trim() !== '' ? `你此刻的身体感觉：${bodyNote.trim()}。` : '',
    SYSTEM_SECTION_BUDGETS.body
  )
  if (body !== '') {
    turn.push('', body)
  }
  // 贴近时刻的分寸：只在开关打开、场景允许、并由上层判断「这一轮可以靠近」时才有内容。
  const intimacy = clampSection(intimacyNote, SYSTEM_SECTION_BUDGETS.intimacy)
  if (intimacy !== '') {
    turn.push('', intimacy)
  }
  // 主动开口的分寸放在最后：这一轮不是在回应她，别把话说满。
  const proactive = clampSection(proactiveNote, SYSTEM_SECTION_BUDGETS.proactive)
  if (proactive !== '') {
    turn.push('', proactive)
  }
  const sticker = clampSection(stickerHint, SYSTEM_SECTION_BUDGETS.sticker)
  if (sticker !== '') {
    turn.push('', sticker)
  }
  return { stable: stable.join('\n'), turn: turn.join('\n').trim() }
}

/** 分开取两槽，由调用方决定怎么送。 */
export function composePromptSlots(input = {}) {
  return buildPromptSections(input)
}

/** 兼容旧调用：拼成一份完整的 system 文本。 */
export function composeSystemPrompt(
  personaText,
  memoryText,
  companionNote = '',
  stickerHint = '',
  affinityNote = '',
  factNote = '',
  sourceNoteText = '',
  socialNote = '',
  proactiveNote = '',
  reviewNote = '',
  bodyNote = ''
) {
  const { stable, turn } = buildPromptSections({
    personaText,
    memoryText,
    companionNote,
    stickerHint,
    affinityNote,
    factNote,
    sourceNoteText,
    socialNote,
    proactiveNote,
    reviewNote,
    bodyNote
  })
  return turn === '' ? stable : `${stable}\n\n${turn}`
}

/**
 * 历史裁剪：按轮保留，最近的在后面。role 只允许 user / assistant。
 * 每条 user 带上它原来的来源标记，重启后也不会把 QQ 的话当成桌面说的。
 */
function trimTurns(turns, maxTurns) {
  const limit = Number.isFinite(maxTurns) && maxTurns > 0 ? Math.floor(maxTurns) : 10
  const window = turns.slice(-limit * 2).map((turn) =>
    turn.role === 'user'
      ? { role: 'user', content: wireContent(turn.content, turn.source) }
      : { role: 'assistant', content: turn.content }
  )

  // 从最近往回按「一问一答」整轮累加，超预算就停。
  const kept = []
  let used = 0
  for (let i = window.length - 1; i >= 0; i -= 2) {
    const pair = window.slice(Math.max(0, i - 1), i + 1)
    const size = pair.reduce((sum, item) => sum + String(item.content ?? '').length, 0)
    if (kept.length > 0 && used + size > HISTORY_CHAR_BUDGET) break
    kept.unshift(...pair)
    used += size
  }
  return kept
}

export function createChatService(options) {
  const {
    getSettings,
    getApiKey,
    getPersonaText,
    getMemoryDigest,
    // 陪伴层：可选注入。没注入时聊天完全按旧路径走，不会因为缺这一层而报错。
    getCompanion = null,
    // 表情清单：可选注入。只回一段提示词，模型据此决定要不要写 [[表情:xxx]]。
    getStickerHint = null,
    // 好感度：只回一句关系状态，读不到就不加。
    getAffinityNote = null,
    // 结构化事实：偏好 / 人物 / 项目 / 约定，读不到就不加。
    getFactNote = null,
    // 社交语感：群聊画像与梗库需要历史，由上层补；拿不到就只用本地判断。
    getSocialNote = null,
    // 身体层：可选。只回一句体感，读不到就不加。
    getBodyNote = null,
    // 贴近时刻：可选。只在「这一轮真的可以靠近」时回一段分寸，其余时候回空串。
    getIntimacyNote = null,
    // 贴近时刻的红线过滤：命中就换成安全台词，整句不重试。
    filterIntimacy = null,
    // 贴近时刻真正说出口之后记一次账：只记次数与时间，不记内容。
    onIntimacySpoken = null,
    // 用户真的开口了（主动开口不算）。只用于本地状态，不阻塞回复。
    onUserMessage = null,
    // 从一个窗口换到另一个窗口时通知一次：上层可把上一段没说完的话带过去。
    onScopeSwitch = null,
    // 这一轮的额外陪伴提示：日程刚被打断、节日穿搭等。拿不到就不加。
    getCompanionExtra = null,
    // 发送前的顺手动作（例如确保今天的节目单已生成）。不等待、不影响回复。
    beforeSend = null,
    // 每日 token 额度：可选。没注入或没开额度时，一切照旧。
    getDailyBudget = null,
    // 请求守门：可选。没注入时不做频率限制。
    getRequestGate = null,
    // 离线兜底：可选。模型失败时用本地规则回一句，不写历史。
    getOfflineReply = null,
    onExchange,
    persistTurn,
    persistClear,
    fetchImpl,
    log
  } = options
  const fetchJson = fetchImpl ?? globalThis.fetch

  /**
   * 每个会话一份历史，key 是 scope。
   *
   * 之前所有来源共用一条数组，群里的对话会被下一轮桌面请求一起带进模型；
   * 现在读写都按同一把 key 走，桶与桶之间不共享任何一条 turn。
   */
  const buckets = new Map()
  let busy = false
  // 上一次真正由用户开口的窗口；只在换窗口时通知一次，不在每次发消息都触发。
  let activeScope = null

  function bucketFor(scope) {
    const key = typeof scope === 'string' && scope !== '' ? scope : 'desktop'
    let list = buckets.get(key)
    if (list === undefined) {
      list = []
      buckets.set(key, list)
    }
    return list
  }

  function totalTurns() {
    let total = 0
    for (const list of buckets.values()) total += list.length
    return total
  }

  /**
   * 从磁盘接回历史。只在当前内存为空时生效，避免覆盖正在进行的会话。
   * 兼容两种字段名：content（渲染侧）与 text（存储层）。
   *
   * 磁盘记录自带 source，接回时就地按 scope 分桶；没有 source 的旧数据
   * 归到桌面。旧文件不需要单独的迁移步骤，重启一次就完成分流。
   */
  function hydrate(list) {
    if (!Array.isArray(list) || list.length === 0) return 0
    if (totalTurns() > 0) return 0
    // 与运行时窗口同一口径：重启后看到的历史长度不会突然缩水。
    const keep = Math.max(chatConfig().historyLimit * 2, 10)
    const restored = new Map()
    for (const item of list) {
      if (item === null || typeof item !== 'object') continue
      if (item.role !== 'user' && item.role !== 'assistant') continue
      const raw = typeof item.content === 'string' ? item.content : item.text
      const content = typeof raw === 'string' ? raw.trim() : ''
      if (content === '') continue
      const source =
        item.source !== null && typeof item.source === 'object' ? item.source : null
      // 优先用记录自带的 scope：assistant 没有 source，但落盘时带了 scope。
      const scope =
        typeof item.scope === 'string' && item.scope !== '' ? item.scope : scopeOf(source)
      let bucket = restored.get(scope)
      if (bucket === undefined) {
        bucket = []
        restored.set(scope, bucket)
      }
      bucket.push({
        role: item.role,
        content,
        at: typeof item.at === 'string' ? item.at : '',
        source
      })
    }

    let count = 0
    for (const [scope, bucket] of restored) {
      // 每个会话各自保留最近若干条；一个群刷屏不会把桌面的历史挤掉。
      const capped = bucket.slice(-Math.min(MAX_RESTORED_TURNS, keep))
      if (capped.length > 0) buckets.set(scope, capped)
      count += capped.length
    }
    return count
  }

  function readSettings() {
    return getSettings() ?? {}
  }

  function chatConfig() {
    const chat = readSettings().companion?.chat ?? {}
    const maxTokens = Number(chat.maxTokens)
    const temperature = Number(chat.temperature)
    const historyLimit = Number(chat.historyLimit)
    return {
      enabled: chat.enabled === true,
      // 设置层只存服务商名；不存端点，端点永远由这里决定。
      provider:
        typeof chat.provider === 'string' && chat.provider.trim() !== ''
          ? chat.provider.trim()
          : SUPPORTED_PROVIDER,
      model: typeof chat.model === 'string' && chat.model.trim() !== '' ? chat.model.trim() : 'deepseek-chat',
      maxTokens: Number.isFinite(maxTokens) ? Math.min(Math.max(Math.floor(maxTokens), 16), 4_000) : 800,
      temperature: Number.isFinite(temperature) ? Math.min(Math.max(temperature, 0), 2) : 0.8,
      historyLimit: Number.isFinite(historyLimit)
        ? Math.min(Math.max(Math.floor(historyLimit), 0), 50)
        : 10
    }
  }

  async function send(payload) {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (text.length === 0) return { ok: false, reason: 'empty' }
    if (text.length > MAX_MESSAGE_CHARS) return { ok: false, reason: 'too-long' }

    // 主动开口：这一轮不是在回应她，而是一句「自己走进来」的话。
    // 结构由上层判定，这里只负责换一种说法方式，不放宽任何权限。
    const proactive =
      payload?.proactive !== null && typeof payload?.proactive === 'object' ? payload.proactive : null
    const proactiveSpeaker =
      typeof proactive?.speaker === 'string' && proactive.speaker.trim() !== ''
        ? proactive.speaker.trim().slice(0, 24)
        : '有人'
    // 未结论的话头：单独一段，不改变这一轮「是在回应对方」的语义。
    const reviewNote =
      typeof payload?.reviewNote === 'string' ? payload.reviewNote.trim() : ''

    // 来源是结构信息：桌面没有 source，QQ 网关会带上 chatType / openId。
    const source =
      payload?.source !== null && typeof payload?.source === 'object' ? payload.source : null
    const scope = scopeOf(source)
    // 这一轮只读自己这个会话的桶：别的群、别的私聊、桌面都不参与上下文。
    const historyTurns = bucketFor(scope)

    const config = chatConfig()
    if (!config.enabled) return { ok: false, reason: 'disabled' }
    // 只有 deepseek 有固定端点；其他值视为配置损坏，明确拒绝，不猜一个地址。
    if (config.provider !== SUPPORTED_PROVIDER) {
      return { ok: false, reason: 'unsupported-provider', message: config.provider }
    }
    if (busy) return { ok: false, reason: 'busy' }

    // 频率守门：短时间内被反复触发时不再打出去，避免 429 与重复花钱。
    // 放在其他副作用之前：这一轮根本没发出去，不该先动额度或节目单。
    const gate = typeof getRequestGate === 'function' ? getRequestGate() : null
    if (gate !== null) {
      const verdict = gate.allow()
      if (verdict?.allowed !== true) {
        log?.('请求过于频繁，这一轮先不发')
        return { ok: false, reason: 'rate-limited', waitMs: verdict?.waitMs ?? 0 }
      }
    }

    // 顺手触发，不 await：节目单生成要几秒，不能把回复卡在这里。
    // 失败也不影响聊天，下一轮会继续沿用昨天的结构。
    if (typeof beforeSend === 'function') {
      try {
        beforeSend()
      } catch (error) {
        log?.('发送前动作失败：', String(error?.message ?? error))
      }
    }

    let apiKey = null
    try {
      apiKey = await getApiKey()
    } catch (error) {
      return { ok: false, reason: 'vault-unavailable', message: String(error?.message ?? error) }
    }
    // 没配钥匙是正常状态：窗内写「未配置」，不弹错误框。
    if (apiKey === null || apiKey === '') return { ok: false, reason: 'no-key' }

    // 额度预检放在真正发请求之前：用完就不再花钱，也不留半截请求。
    const budget = typeof getDailyBudget === 'function' ? getDailyBudget() : null
    if (budget !== null) {
      const verdict = budget.canSpend(0)
      if (verdict?.allowed !== true) {
        log?.('今日额度已用完，这一轮不发起请求')
        return {
          ok: false,
          reason: 'budget-exhausted',
          used: verdict?.used ?? 0,
          limit: verdict?.limit ?? 0
        }
      }
    }

    // 换窗口只说一次：把上一段最近的几轮交给上层，由它压成一句承接摘要。
    // 失败不拖回复，最多少一次跨窗口提醒。
    if (
      proactive === null &&
      activeScope !== null &&
      activeScope !== scope &&
      typeof onScopeSwitch === 'function'
    ) {
      await withTimeout(
        () =>
          onScopeSwitch({
            from: activeScope,
            to: scope,
            history: bucketFor(activeScope)
              .slice(-4)
              .map((turn) => ({ role: turn.role, content: turn.content }))
          }),
        null,
        800
      )
    }
    if (proactive === null) activeScope = scope

    const settings = readSettings()
    const personaText = typeof getPersonaText === 'function' ? getPersonaText(settings) : ''
    // 记忆摘要也按 scope 取：群里听来的事不该出现在桌面的提示词里。
    // 允许注入方做异步检索（向量重排）；同步实现 await 一样成立。
    const memoryText =
      typeof getMemoryDigest === 'function' ? await getMemoryDigest(text, scope) : ''

    // 收尾沉默：上一轮已经道过晚安，这一轮对方也只是道别，就不再追一句。
    // 只在 QQ 上生效——桌面窗口收到空回复会留下一个空气泡。
    if (source?.channel === 'qq' && proactive === null) {
      const lastAssistant = [...historyTurns].reverse().find((item) => item.role === 'assistant')
      if (shouldStaySilent({ userText: text, lastAssistantText: lastAssistant?.content })) {
        log?.('收尾沉默：对方已经在道别，这一轮不再追话')
        return { ok: true, reply: '', silent: 'farewell' }
      }
    }

    // 唤醒词在本地剥掉：群里叫一声才接，喂给模型的正文里不该留着名字。
    // 只有一个名字、没有别的内容时保留原文，避免把「在吗」变成空消息。
    const wake = matchWake(text, { words: settings?.wakeWords })
    const spoken = proactive !== null ? text : wake.woken && wake.text !== '' ? wake.text : text
    const scopeKind = scope === 'qq:group' || scope.startsWith('qq:group:') ? 'group' : scope === 'desktop' ? 'desktop' : 'private'

    // 只有用户真的开口才算「被打断」；主动开口是她在说话，不该暂停自己的日程。
    // 本地状态更新通常很快，给 500ms 兜底，卡住也不拖整轮回复。
    if (proactive === null && typeof onUserMessage === 'function') {
      await withTimeout(
        () => onUserMessage({ text: spoken, scope, source }),
        null,
        500
      )
    }

    // 陪伴层在这一轮先吃一遍用户的话：更新心情、抽取断言、排过期话头。
    // 取不到就返回 null，下面按旧路径拼，不给模型半份状态。
    //
    // 五个注入项之间没有依赖，串行 await 只是在逐项等；改成并行后，
    // 单项卡住最多损失自己那一段，不会把整轮回复一起拖住。
    const companion = typeof getCompanion === 'function' ? getCompanion() : null
    let play = null
    try {
      play = detectLanguagePlay(spoken)
    } catch {
      play = null
    }

    const [turn, stickerRaw, affinityRaw, factRaw, socialExtraRaw, bodyRaw, intimacyRaw] =
      await Promise.all([
        withTimeout(
          () => (typeof companion?.beginTurn === 'function' ? companion.beginTurn(spoken) : null),
          null
        ),
        withTimeout(() => (typeof getStickerHint === 'function' ? getStickerHint() : ''), ''),
        withTimeout(
          () => (typeof getAffinityNote === 'function' ? getAffinityNote(scope) : ''),
          ''
        ),
        withTimeout(
          () => (typeof getFactNote === 'function' ? getFactNote(spoken, scope) : ''),
          ''
        ),
        withTimeout(
          () => (typeof getSocialNote === 'function' ? getSocialNote({ text: spoken, scope, play }) : ''),
          ''
        ),
        withTimeout(
          // 把这一句带过去：身体层要按「真的有人说话」结算社交力气，
          // 也要知道这句话是不是把她从睡梦里叫醒的。
          () =>
            typeof getBodyNote === 'function'
              ? getBodyNote({ text: spoken, scope, source })
              : '',
          ''
        ),
        // 贴近时刻由上层判断：开关、场景、次数、由头都在那里，拿不到就不加。
        withTimeout(
          () =>
            typeof getIntimacyNote === 'function'
              ? getIntimacyNote({ text: spoken, scope, source })
              : '',
          ''
        )
      ])

    // 额外陪伴提示只给用户主动开口的这一轮：主动搭话有自己的气泡路径，
    // 不该在群里说「本来在做什么，现在陪你」。
    let extraCompanionNote = ''
    if (proactive === null && typeof getCompanionExtra === 'function') {
      extraCompanionNote = String(
        (await withTimeout(
          () => getCompanionExtra({ text: spoken, scope, source }),
          '',
          500
        )) ?? ''
      ).trim()
    }
    const companionNote = [buildCompanionNote(turn), extraCompanionNote]
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item !== '')
      .join('\n\n')
    const stickerHint = String(stickerRaw ?? '')
    const affinityNote = String(affinityRaw ?? '')
    const factNote = String(factRaw ?? '')
    const bodyNote = String(bodyRaw ?? '')
    const intimacyNote = String(intimacyRaw ?? '')
    // 社交语感：本地先判断这句话有没有谐音/黑话/梗，再让上层补群聊画像与梗库。
    // 任何一步失败都不影响回复，宁可少一段提示。
    let socialNote = ''
    try {
      socialNote = buildSocialNote({ scope: scopeKind, play })
      const extra = String(socialExtraRaw ?? '').trim()
      if (extra !== '') {
        socialNote = socialNote === '' ? extra : `${socialNote}\n${extra}`
      }
    } catch {
      socialNote = ''
    }
    const sourceHint = sourceNote(source)
    const emojiCandidates = Array.isArray(turn?.emoji)
      ? turn.emoji.map((item) => item?.entry?.id).filter((id) => typeof id === 'string')
      : []

    /**
     * 模型没回上来时，用本地规则垫一句。
     *
     * 群里不兜底：模型挂掉还机械插话，比安静更打扰。
     * 这句不落历史、不进记忆，下一轮上下文里不会出现它。
     */
    async function offlineFallback(reason, extra = {}) {
      if (source?.chatType === 'group') return { ok: false, reason, ...extra }
      // 鉴权与余额问题必须让用户看见：用一句温柔话盖过去，配置永远修不好。
      if (reason === 'auth-failed' || reason === 'insufficient-balance') {
        return { ok: false, reason, ...extra }
      }

      const offline = typeof getOfflineReply === 'function' ? getOfflineReply() : null
      if (offline === null) return { ok: false, reason, ...extra }

      try {
        const line = await offline.replyTo(spoken)
        if (line === null) return { ok: false, reason, ...extra }

        log?.(`模型未回复，用本地句兜底：${reason}`)
        return {
          ok: true,
          reply: line.text,
          offline: true,
          offlineSource: line.source,
          reason
        }
      } catch (error) {
        log?.('离线兜底异常', error)
        return { ok: false, reason, ...extra }
      }
    }

    // 稳定段留在 system，当轮背景随这条 user 消息一起进去，不写进历史。
    const slots = composePromptSlots({
      personaText,
      memoryText,
      companionNote,
      stickerHint,
      affinityNote,
      factNote,
      sourceNoteText: sourceHint,
      socialNote,
      proactiveNote: typeof proactive?.note === 'string' ? proactive.note : '',
      reviewNote,
      bodyNote,
      intimacyNote
    })
    const spokenLine =
      proactive === null
        ? wireContent(spoken, source)
        : `［群里 ${proactiveSpeaker} 说。这不是对你说的，你只是听见了］${spoken}`
    const messages = [
      {
        role: 'system',
        content: slots.stable
      },
      ...trimTurns(historyTurns, config.historyLimit),
      {
        role: 'user',
        content:
          slots.turn === ''
            ? spokenLine
            : `［这一轮的背景，不是新发言］\n${slots.turn}\n\n${spokenLine}`
      }
    ]

    const controller = new AbortController()
    let timer = null
    busy = true

    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(Object.assign(new Error('chat timeout'), { code: 'timeout' }))
        }, CHAT_TIMEOUT_MS)
      })

      const response = await Promise.race([
        fetchJson(CHAT_ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature: config.temperature,
            max_tokens: config.maxTokens,
            stream: false
          })
        }),
        timeout
      ])

      if (!response.ok) {
        return await offlineFallback(mapStatus(response.status), { message: `HTTP ${response.status}` })
      }

      const body = await response.json()
      const reply = body?.choices?.[0]?.message?.content
      if (typeof reply !== 'string' || reply.trim() === '') {
        return await offlineFallback('bad-response')
      }

      const usage = body?.usage
      // 按真实用量结算：拿不到 usage 就不记，宁可少算也不凭空造消费。
      if (budget !== null && usage !== null && typeof usage === 'object') {
        const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
        const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0)
        const total = Number.isFinite(input + output) ? input + output : 0
        if (total > 0) budget.record(total)
      }
      const at = new Date().toISOString()
      // 先摘表情标记再清洗：句末的 [图:id] 被保留在正文里会漏到界面，
      // 而 cleanBubbleLine 那一套只保留第一句，标记必须在它之前取出来。
      const rawAnswer = reply.trim()
      const parsed = parseEmojiTag(rawAnswer, emojiCandidates)
      const afterEmoji = parsed.text.trim() === '' ? rawAnswer : parsed.text
      // 再把 [[表情:标签]] 摘出来：正文干净地进界面，标签单独交给调用方去决定能不能发。
      const stickerParsed = parseStickerTag(afterEmoji)
      // 发送前最后一道清理：漏出的控制标签、整段复读，在这里收掉。
      const guarded = guardReply(stickerParsed.text.trim() === '' ? afterEmoji : stickerParsed.text)
      let answer = guarded.text
      if (guarded.notes.length > 0) {
        log?.(`发送前清理：${guarded.notes.map((item) => item.detail).join('、')}`)
      }
      // 群聊里再查一次引用归属：引错了人，改成「刚才某某说」。
      if (source?.chatType === 'group') {
        const attribution = fixMisattributedQuote(answer, {
          speaker: describeSpeaker(source),
          history: [
            ...historyTurns
              .filter((item) => item.role === 'user')
              .slice(-8)
              .map((item) => ({ text: item.content, speaker: describeSpeaker(item.source) })),
            { text: spoken, speaker: describeSpeaker(source) }
          ]
        })
        if (attribution.fixed.length > 0) {
          log?.(`引用纠正：${attribution.fixed.map((item) => item.quote).join('、')}`)
          answer = attribution.text
        }
      }
      // 贴近时刻的红线：命中就整句换成安全台词，不重试、不修补。
      // 被退回的这一轮不算「贴近过」，所以记账放在过滤之后。
      let intimacySpoken = false
      if (typeof filterIntimacy === 'function') {
        try {
          const filtered = await filterIntimacy(answer, { text: spoken, scope, source })
          if (filtered !== null && typeof filtered === 'object' && filtered.ok === false) {
            const safe = String(filtered.text ?? '').trim()
            log?.(`贴近红线：退回普通台词（${String(filtered.reason ?? 'redline')}）`)
            if (safe !== '') answer = safe
          } else if (intimacyNote !== '') {
            intimacySpoken = true
          }
        } catch (error) {
          log?.('贴近过滤异常：', String(error?.message ?? error))
        }
      }
      const emojiId = parsed.emojiId
      const stickerLabel = stickerParsed.label

      // 存原文，不存带前缀的版本：界面回看和记忆摘要都该是干净的话。
      // assistant 没有 source，但同样要带 scope——否则重启后一轮问答会被拆到两个桶。
      const userTurn = { role: 'user', content: text, at, source, scope }
      const assistantTurn = { role: 'assistant', content: answer, at, scope }
      historyTurns.push(userTurn)
      historyTurns.push(assistantTurn)

      // 收尾：把这一轮写进话头池，并记住刚用过的表情（下次降权）。
      if (companion !== null && typeof companion?.endTurn === 'function') {
        try {
          companion.endTurn(answer, emojiId)
        } catch (error) {
          log?.('陪伴层收尾失败：', String(error?.message ?? error))
        }
      }

      // 真说出口才记账：只记「今天有过一次」，不记说了什么。
      if (intimacySpoken && typeof onIntimacySpoken === 'function') {
        try {
          onIntimacySpoken()
        } catch (error) {
          log?.('贴近记账失败：', String(error?.message ?? error))
        }
      }

      // 两路落盘互不牵连：记忆供提示词用，历史供界面回看。
      // 任何一路失败都只记日志，不影响这次回复。
      if (typeof onExchange === 'function') {
        try {
          onExchange({ user: text, assistant: answer, at, scope, source })
        } catch (error) {
          log?.('记忆写入回调失败：', String(error?.message ?? error))
        }
      }
      if (typeof persistTurn === 'function') {
        for (const turn of [userTurn, assistantTurn]) {
          try {
            persistTurn(turn)
          } catch (error) {
            log?.('聊天历史落盘失败：', String(error?.message ?? error))
          }
        }
      }

      // 内存里多留一点供界面回看，但送进模型的上下文严格按 historyLimit 裁。
      // 下限 10 条：就算把上下文设成 0，窗口里也不会只剩最后一句。
      const keep = Math.max(config.historyLimit * 2, 10)
      while (historyTurns.length > keep) historyTurns.shift()

      return {
        ok: true,
        reply: answer,
        // 主动开口的回合会在上层单独记账，普通回复不动这里。
        proactive: proactive !== null,
        // 这一轮真的用上了贴近时刻的分寸（上层已记过一次账）。
        intimacy: intimacySpoken,
        // 渲染层拿到 id 后换成素材地址，贴在气泡里；null 表示这句不配图。
        emojiId,
        // 模型想发的表情标签；调用方决定能不能真的发出去。
        stickerLabel,
        model: typeof body?.model === 'string' ? body.model : config.model,
        usage:
          usage === undefined
            ? null
            : {
                inputTokens: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null,
                outputTokens: Number.isFinite(Number(usage.completion_tokens))
                  ? Number(usage.completion_tokens)
                  : null
              },
        at
      }
    } catch (error) {
      if (error?.code === 'timeout' || error?.name === 'AbortError') {
        return await offlineFallback('timeout')
      }
      log?.('聊天请求失败：', error instanceof Error ? error.message : String(error))
      return await offlineFallback('request-failed', { message: String(error?.message ?? error) })
    } finally {
      if (timer !== null) clearTimeout(timer)
      busy = false
    }
  }

  /**
   * 渲染侧默认看桌面这一份；给了 scope 就只看那个会话。
   * 默认值写成 desktop，旧调用方不用改也能拿到和以前一样的内容。
   */
  function history(scope = 'desktop') {
    return bucketFor(scope).map((turn) => ({
      role: turn.role,
      content: turn.content,
      at: turn.at,
      ...(turn.source ? { source: turn.source } : {})
    }))
  }

  async function clear() {
    // 清空也要落到磁盘：否则下次开机旧历史会被重新接回来。
    // 顺序固定：先等空记录落盘，成功后才清内存；失败时所有会话的历史一字不动。
    if (typeof persistClear === 'function') {
      try {
        const result = await persistClear()
        if (result && result.ok === false) {
          return { ok: false, reason: String(result.reason ?? 'persist-failed') }
        }
      } catch (error) {
        log?.('聊天历史清空失败：', String(error?.message ?? error))
        return { ok: false, reason: 'persist-failed' }
      }
    }
    buckets.clear()
    return { ok: true }
  }

  function status() {
    const config = chatConfig()
    return {
      enabled: config.enabled,
      provider: config.provider,
      model: config.model,
      historyCount: totalTurns(),
      busy
    }
  }

  /**
   * 连接自检：用真实 Key 发一次最小请求，只看通不通。
   *
   * 不回密钥、不回完整响应；不写历史、不占 busy、不产生对话。
   * 12 秒还没回就当超时，避免设置页一直转。
   */
  async function test() {
    const config = chatConfig()
    let apiKey = null
    try {
      apiKey = await getApiKey()
    } catch {
      return { ok: false, reason: 'secret-store-unavailable' }
    }
    if (apiKey === null || apiKey === '') return { ok: false, reason: 'no-key' }

    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const response = await fetchJson(CHAT_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        })
      })
      const elapsedMs = Date.now() - startedAt
      if (!response.ok) {
        return { ok: false, reason: mapStatus(response.status), status: response.status, elapsedMs }
      }
      return { ok: true, model: config.model, status: response.status, elapsedMs }
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || error?.code === 'timeout'
      return { ok: false, reason: timedOut ? 'timeout' : 'network-error' }
    } finally {
      clearTimeout(timer)
    }
  }

  return { send, hydrate, history, clear, status, test }
}

/** HTTP 状态映射到界面能直接说清楚的原因。 */
function mapStatus(status) {
  if (status === 401 || status === 403) return 'auth-failed'
  if (status === 402) return 'insufficient-balance'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server-error'
  return 'request-failed'
}
