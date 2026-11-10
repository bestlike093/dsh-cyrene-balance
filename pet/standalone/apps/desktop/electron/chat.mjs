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
import { buildSocialNote, buildPlayHint, detectLanguagePlay, matchWake } from './social.mjs'
import { fixMisattributedQuote, guardReply, shouldStaySilent } from './reply-guard.mjs'
import { cleanVoice } from './voice-guard.mjs'

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

/** 工具循环最多打几轮模型（一轮 = 一次请求 + 一次工具执行）。防止死循环。 */
const MAX_TOOL_ROUNDS = 4

/** 单次工具结果回填给模型的最大字符数。字幕全文等长结果在这里截断，避免撑爆上下文。 */
const TOOL_RESULT_CHAR_BUDGET = 6_000

/** 一整轮对话里工具结果回填的累计字符上限。多轮工具循环时逐轮累加，到顶后不再执行新工具。 */
const TOOL_ROUND_CHAR_BUDGET = 40_000

/**
 * 给模型的工具清单（OpenAI / DeepSeek 兼容的 function calling 格式）。
 *
 * 全部是「能力描述」：模型据此决定要不要调用、传什么参数。
 * 真正的执行在 main.mjs 的 runTool 里，本模块不碰网络 / 窗口 / 文件。
 * `bili_write` 刻意不暴露 confirmed 字段——危险动作的二次确认由主进程完成，模型伪造不了。
 */
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'bili_search',
      description:
        '在哔哩哔哩搜索视频，返回匹配的视频列表（含 bvid、标题、UP 主、时长、简介等）。对方想找某个主题的视频时使用。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词' }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bili_video_info',
      description:
        '读取某个 B 站视频的详情，返回简介和分 P 列表（含每 P 的 cid）。拿到 bvid 后、想读字幕前，先用它取 cid。',
      parameters: {
        type: 'object',
        properties: {
          bvid: { type: 'string', description: '视频的 bvid，形如 BV1xx411c7mD' }
        },
        required: ['bvid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bili_subtitle_list',
      description: '列出某个视频（bvid + cid）可用的字幕轨，返回每条字幕的下载地址。需要登录态才有 AI 字幕。',
      parameters: {
        type: 'object',
        properties: {
          bvid: { type: 'string', description: '视频 bvid' },
          cid: { type: 'string', description: '分 P 的 cid，来自 bili_video_info' }
        },
        required: ['bvid', 'cid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bili_transcript',
      description: '下载并拼出某条字幕的全文。subtitleUrl 来自 bili_subtitle_list。',
      parameters: {
        type: 'object',
        properties: {
          subtitleUrl: { type: 'string', description: '字幕下载地址，来自 bili_subtitle_list' }
        },
        required: ['subtitleUrl']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bili_article',
      description: '抓取一个网页的正文（专栏文章等），返回清洗后的正文文本。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整 http(s) 地址' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bili_write',
      description:
        '在 B 站执行一个互动动作：点赞(like)、评论(comment)、投币(coin)、转发(share)、收藏(favorite)。这些是写操作，默认关闭，且危险动作需要对方确认后才能执行；不确定对方是否同意时，先问对方，不要直接调用。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['like', 'comment', 'coin', 'share', 'favorite'],
            description: '要执行的互动动作'
          },
          bvid: { type: 'string', description: '目标视频的 bvid' },
          message: { type: 'string', description: '评论内容，仅 action=comment 时必填' },
          coinCount: { type: 'integer', description: '投币数量，仅 action=coin 时，1~2，默认 1' }
        },
        required: ['action', 'bvid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory_add_facts',
      description:
        '把学到的知识或判断教训写进长期记忆，下次能想起来。学到有价值的知识用 kind=knowledge；被对方纠正、或自己判断错了、或踩过的坑用 kind=lesson。只在确实值得长期记住时使用，别随手写。',
      parameters: {
        type: 'object',
        properties: {
          facts: {
            type: 'array',
            description: '要记住的条目',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['knowledge', 'lesson'], description: 'knowledge=学到的知识；lesson=纠正过/别重犯的教训' },
                text: { type: 'string', description: '一条完整的事实或教训' },
                source: { type: 'string', description: '来源，可选' },
                confidence: { type: 'number', description: '0~1 置信度，可选' }
              },
              required: ['kind', 'text']
            }
          }
        },
        required: ['facts']
      }
    }
  }
]

/**
 * 启用工具时追加到 system 的一段使用原则。只在真正挂上 runTool 时拼进去，
 * 纯文本模式不出现，避免模型对着不存在的工具空想。
 */
const TOOL_USAGE_NOTE = [
  '你可以调用工具查 B 站、读字幕、写记忆。原则：',
  '- 普通聊天不需要工具，别为了用而用。',
  '- 查资料、找视频、读内容时，用只读工具直接做。',
  '- 写操作（点赞 / 投币 / 评论 / 转发 / 收藏）默认关，危险动作要等对方确认；拿不准对方同不同意，先问，别擅自做。',
  '- 学到有价值的知识、被纠正过、或踩过坑，用 memory_add_facts 沉淀成记忆，下次能想起来。'
].join('\n')

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
  // 只认 group / private；拼错或缺失的 chatType 归 unknown，不跟真私聊混桶。
  const chatType =
    source.chatType === 'group' ? 'group' : source.chatType === 'private' ? 'private' : 'unknown'
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
  sticker: 300,
  // 这一句的谐音/黑话提示：当轮特有，字数很少。
  play: 160
}

/**
 * turn 槽的总预算。
 *
 * 单项预算只保证「一段别吃光」，总预算保证「全部加起来别吃光」。
 * 超了总预算时按 SHRINK_ORDER 从最不重要的段开始逐级收缩，
 * 每级砍到六成（下限 60 字）；memory / fact 是最后才动的。
 */
export const TOTAL_TURN_BUDGET = 2_400
const SHRINK_ORDER = ['play', 'sticker', 'proactive', 'intimacy', 'review', 'body', 'affinity', 'companion', 'fact', 'memory']

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
  intimacyNote = '',
  playHint = ''
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
  // 当轮的谐音/黑话提示不在这里，它单独走 turn 槽（play）。
  const social = clampSection(socialNote, SYSTEM_SECTION_BUDGETS.social)
  if (social !== '') {
    stable.push('', social)
  }

  // turn 各段的原始文本与预算；总预算超了按优先级从 play / sticker 开始收缩。
  const budgets = { ...SYSTEM_SECTION_BUDGETS }
  const raw = {
    memory: memoryText,
    fact: factNote,
    companion: companionNote,
    affinity: affinityNote,
    review: reviewNote,
    body:
      typeof bodyNote === 'string' && bodyNote.trim() !== ''
        ? `你此刻的身体感觉：${bodyNote.trim()}。`
        : '',
    intimacy: intimacyNote,
    proactive: proactiveNote,
    sticker: stickerHint,
    play: playHint
  }

  const fit = () => {
    const sections = {}
    for (const [key, text] of Object.entries(raw)) {
      const text2 = typeof text === 'string' ? text.trim() : ''
      if (text2 === '') continue
      const budget = budgets[key]
      const cut = clampSection(text2, budget)
      if (cut !== '') sections[key] = cut
    }
    const total = Object.values(sections).reduce((sum, item) => sum + Array.from(item).length, 0)
    return { sections, total }
  }

  let { sections, total } = fit()
  // 总预算兜底：超了先砍最不重要的段，每级缩到六成；砍到只剩 memory/fact 时停手。
  for (const key of SHRINK_ORDER) {
    if (total <= TOTAL_TURN_BUDGET) break
    if (sections[key] === undefined) continue
    const next = Math.max(60, Math.floor(budgets[key] * 0.6))
    if (next >= budgets[key]) continue
    budgets[key] = next
    ;({ sections, total } = fit())
  }

  const turn = []
  if (sections.memory !== undefined) {
    turn.push('下面是你记得的早前对话。只在和当前话题相关时自然用上，不要逐条复述：')
    turn.push(sections.memory)
  }
  // 结构化事实放在长期记忆之后：先有原文摘要，再有整理过的偏好/人物/项目/约定。
  if (sections.fact !== undefined) {
    turn.push('', '你还记得这些（不用逐条提，合适的时候自然用上）：', sections.fact)
  }
  if (sections.companion !== undefined) {
    turn.push('', sections.companion)
  }
  // 关系状态放在心情之后：越靠后越像「此刻」，但不抢人格的位置。
  if (sections.affinity !== undefined) {
    turn.push('', sections.affinity)
  }
  // 未结论的话头：告诉模型「这件事问过，别机械地再问一遍」。
  if (sections.review !== undefined) {
    turn.push('', sections.review)
  }
  // 身体感觉紧跟话头：它影响的是这一轮的语气与句子长短，不该被当成资料。
  if (sections.body !== undefined) {
    turn.push('', sections.body)
  }
  // 贴近时刻的分寸：只在开关打开、场景允许、并由上层判断「这一轮可以靠近」时才有内容。
  if (sections.intimacy !== undefined) {
    turn.push('', sections.intimacy)
  }
  // 主动开口的分寸放在最后：这一轮不是在回应她，别把话说满。
  if (sections.proactive !== undefined) {
    turn.push('', sections.proactive)
  }
  if (sections.sticker !== undefined) {
    turn.push('', sections.sticker)
  }
  // 这一句的谐音/黑话提示垫底：最短、最当轮。
  if (sections.play !== undefined) {
    turn.push('', sections.play)
  }
  return { stable: stable.join('\n'), turn: turn.join('\n').trim() }
}

/** 分开取两槽，由调用方决定怎么送。 */
export function composePromptSlots(input = {}) {
  return buildPromptSections(input)
}

/**
 * 历史裁剪：按轮保留，最近的在后面。role 只允许 user / assistant。
 * 每条 user 带上它原来的来源标记，重启后也不会把 QQ 的话当成桌面说的。
 *
 * 只保留完整的「user → assistant」对：缺回复的 user、开头的 assistant、
 * 乱序的单独条目都跳过，绝不把顺序颠倒的一轮塞给模型。
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
  for (let i = window.length - 1; i >= 1; i -= 1) {
    const item = window[i]
    if (item.role !== 'assistant') continue
    const user = window[i - 1]
    if (user.role !== 'user') continue
    const size = String(user.content ?? '').length + String(item.content ?? '').length
    if (kept.length > 0 && used + size > HISTORY_CHAR_BUDGET) break
    kept.unshift(user, item)
    used += size
    i -= 1
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
    log,
    // 工具执行器：可选注入。没注入时聊天按旧路径走，请求不带 tools，模型也不会调工具。
    // 签名：runTool(name, args, ctx) -> 结果对象；ctx 含 source / scope / confirmed。
    runTool = null,
    // 危险动作的二次确认：可选注入。runTool 返回 needsConfirm 时调用，等用户选择。
    // 签名：requestConfirm(info) -> Promise<{ allowed: boolean }>。
    requestConfirm = null
  } = options
  const fetchJson = fetchImpl ?? globalThis.fetch

  /**
   * 每个会话一份历史，key 是 scope。
   *
   * 之前所有来源共用一条数组，群里的对话会被下一轮桌面请求一起带进模型；
   * 现在读写都按同一把 key 走，桶与桶之间不共享任何一条 turn。
   */
  const buckets = new Map()
  // 同一时刻只允许一轮模型请求：陪伴层是单例，跨轮并行会互相污染心情与话头。
  // 检查和占位之间没有任何 await，原子成立；后来的请求排队等一小会儿而不是被直接丢掉。
  let busyScope = null
  // 上一次真正由用户开口的窗口；只在换窗口时通知一次，不在每次发消息都触发。
  let activeScope = null

  /** 排队等上一个请求让位，最长 20 秒；单线程里检查与占位之间无 await，天然互斥。 */
  async function acquireBusy(scope) {
    const deadline = Date.now() + 20_000
    while (busyScope !== null) {
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    busyScope = scope
    return true
  }

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
      // 已有内存会话的桶保持原样；只有空桶才从磁盘接回，
      // 一个先被写入的会话不再挡住其他会话恢复历史。
      if ((buckets.get(scope)?.length ?? 0) > 0) continue
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

  /** 把工具结果序列化成模型能读的文本，超长截断。 */
  function stringifyToolResult(value) {
    let text
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
    if (typeof text !== 'string') text = String(text)
    if (text.length > TOOL_RESULT_CHAR_BUDGET) {
      text = `${text.slice(0, TOOL_RESULT_CHAR_BUDGET)}…（结果过长已截断）`
    }
    return text
  }

  /**
   * 执行一次工具调用。
   *
   * 只读工具直接返回结果；写操作返回 needsConfirm 时，交给注入的 requestConfirm
   * 等用户拍板，允许后再带 confirmed 重跑一次。confirmed 只在这里由主进程设置，
   * 模型传不进 confirmed，伪造不了确认。
   */
  async function executeToolCall(toolCall, ctx) {
    const fn = toolCall?.function
    const name = typeof fn?.name === 'string' ? fn.name : ''
    let args = {}
    try {
      args = JSON.parse(typeof fn?.arguments === 'string' ? fn.arguments : '{}')
    } catch {
      args = {}
    }
    if (typeof runTool !== 'function') {
      return JSON.stringify({ ok: false, error: '工具不可用' })
    }
    try {
      const first = await runTool(name, args, ctx)
      if (first && first.needsConfirm === true) {
        if (typeof requestConfirm !== 'function') {
          return JSON.stringify({ ok: false, needsConfirm: true, message: '这个动作需要确认，但当前环境不支持' })
        }
        // 固定字段放在展开之后：确认信息里的 name/args 不能覆盖真实执行参数。
        const decision = await requestConfirm({ ...first, name, args })
        if (decision?.allowed !== true) {
          return JSON.stringify({ ok: false, rejected: true, message: '对方没有同意这个动作，不要擅自执行' })
        }
        const second = await runTool(name, args, { ...ctx, confirmed: true })
        // 确认后仍然要求再确认：不再循环，明确拒绝，避免被「还需要确认」拖进死循环。
        if (second && second.needsConfirm === true) {
          return JSON.stringify({ ok: false, needsConfirm: true, message: '动作仍需额外确认，本轮放弃执行' })
        }
        return stringifyToolResult(second)
      }
      return stringifyToolResult(first)
    } catch (error) {
      return JSON.stringify({ ok: false, error: error?.message ?? String(error) })
    }
  }

  async function send(payload) {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (text.length === 0) return { ok: false, reason: 'empty' }
    if (text.length > MAX_MESSAGE_CHARS) return { ok: false, reason: 'too-long' }

    // 来源是结构信息：桌面没有 source，QQ 网关会带上 chatType / openId。
    const source =
      payload?.source !== null && typeof payload?.source === 'object' ? payload.source : null

    // 主动开口：这一轮不是在回应她，而是一句「自己走进来」的话。
    // 结构由上层判定，这里只负责换一种说法方式，不放宽任何权限。
    const proactive =
      payload?.proactive !== null && typeof payload?.proactive === 'object' ? payload.proactive : null
    // 群主动开口的说话人：优先用上层给的 speaker；没给就从 source 里的发送者推一个稳定代号。
    const proactiveSpeaker =
      (
        typeof proactive?.speaker === 'string' && proactive.speaker.trim() !== ''
          ? proactive.speaker.trim()
          : typeof source?.senderOpenId === 'string' && source.senderOpenId.trim() !== ''
            ? `群友·${source.senderOpenId.replace(/[^0-9a-zA-Z]/g, '').slice(-4).toLowerCase()}`
            : '有人'
      ).slice(0, 24)
    // 未结论的话头：单独一段，不改变这一轮「是在回应对方」的语义。
    const reviewNote =
      typeof payload?.reviewNote === 'string' ? payload.reviewNote.trim() : ''

    const scope = scopeOf(source)
    // 这一轮只读自己这个会话的桶：别的群、别的私聊、桌面都不参与上下文。
    const historyTurns = bucketFor(scope)

    const config = chatConfig()
    if (!config.enabled) return { ok: false, reason: 'disabled' }
    // 只有 deepseek 有固定端点；其他值视为配置损坏，明确拒绝，不猜一个地址。
    if (config.provider !== SUPPORTED_PROVIDER) {
      return { ok: false, reason: 'unsupported-provider', message: config.provider }
    }
    // 排队等上一轮让位：检查与占位之间没有任何 await，互斥真正成立；
    // 实在等不到（上一轮异常长）才拒绝，不会再把后来的请求直接丢掉。
    if (!(await acquireBusy(scope))) {
      return { ok: false, reason: 'busy' }
    }
    try {

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
    // 和其余六项注入一样带超时兜底：BM25 / 向量检索卡住时不能把整轮悬挂在这里。
    const memoryText =
      typeof getMemoryDigest === 'function'
        ? String((await withTimeout(() => getMemoryDigest(text, scope), '')) ?? '')
        : ''

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
          () => (typeof getFactNote === 'function' ? getFactNote(spoken, scope, source) : ''),
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

    // 额外陪伴提示（日程打断、跨窗口承接、穿搭等）：内容由上层按 scope 过滤，
    // 拿不到或该场景不该给时上层返回空串；这里不再用 proactive 挡门。
    let extraCompanionNote = ''
    if (typeof getCompanionExtra === 'function') {
      extraCompanionNote = String(
        (await withTimeout(
          () => getCompanionExtra({ text: spoken, scope, source, proactive: proactive !== null }),
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
    // 社交语感：稳定前缀只放「这群人怎么说话」（scope + 群像 + 梗库），
    // 这一句的谐音/黑话提示单独进 turn 槽，稳定段不再随句变化。
    let socialNote = ''
    let playHint = ''
    try {
      socialNote = buildSocialNote({ scope: scopeKind })
      playHint = buildPlayHint(play)
      const extra = String(socialExtraRaw ?? '').trim()
      if (extra !== '') {
        socialNote = socialNote === '' ? extra : `${socialNote}\n${extra}`
      }
    } catch {
      socialNote = ''
      playHint = ''
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
      intimacyNote,
      playHint
    })
    const spokenLine =
      proactive === null
        ? wireContent(spoken, source)
        : `［群里 ${proactiveSpeaker} 说。这不是对你说的，你只是听见了］${spoken}`
    // 工具只在注入 runTool 时挂上：没注入就走纯文本旧路径，模型也不会调工具。
    const hasTools = typeof runTool === 'function'
    const roundMessages = [
      {
        role: 'system',
        content: hasTools ? `${slots.stable}\n\n${TOOL_USAGE_NOTE}` : slots.stable
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

    let timer = null

    try {
      const maxRounds = hasTools ? MAX_TOOL_ROUNDS : 1
      let body = null
      let reply = ''
      // 工具回填的累计字符上限：只限制单次结果 6000 字不够，多轮累加会把上下文撑爆。
      let toolChars = 0

      for (let round = 0; round < maxRounds; round++) {
        // 每轮一个独立 AbortController：一轮超时只作废这一轮，后面轮次还能继续发。
        const roundController = new AbortController()
        // abort 会让 fetch 抛 AbortError，统一转成 timeout。
        timer = setTimeout(() => roundController.abort(), CHAT_TIMEOUT_MS)
        let response
        try {
          response = await fetchJson(CHAT_ENDPOINT, {
            method: 'POST',
            signal: roundController.signal,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({
              model: config.model,
              messages: roundMessages,
              temperature: config.temperature,
              max_tokens: config.maxTokens,
              stream: false,
              ...(hasTools ? { tools: TOOL_DEFINITIONS } : {})
            })
          })
        } catch (error) {
          if (error?.name === 'AbortError' || error?.code === 'timeout') {
            throw Object.assign(new Error('chat timeout'), { code: 'timeout' })
          }
          throw error
        } finally {
          clearTimeout(timer)
        }

        if (!response.ok) {
          return await offlineFallback(mapStatus(response.status), { message: `HTTP ${response.status}` })
        }

        body = await response.json()
        const msg = body?.choices?.[0]?.message
        const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : []

        if (toolCalls.length > 0 && round < maxRounds - 1) {
          // 模型要调工具：把带 tool_calls 的 assistant 消息回填，再逐条执行工具、
          // 结果作为 role:tool 接在后面，进入下一轮请求。
          roundMessages.push({
            role: 'assistant',
            content: typeof msg?.content === 'string' ? msg.content : null,
            tool_calls: toolCalls
          })
          for (const toolCall of toolCalls) {
            if (toolChars > TOOL_ROUND_CHAR_BUDGET) {
              // 上下文预算已满：协议上必须为每个 tool_call 回一条结果，用最短的失败说明占位。
              roundMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ ok: false, error: '上下文预算已满，本轮工具不再执行' })
              })
              continue
            }
            const result = await executeToolCall(toolCall, { source, scope })
            toolChars += String(result ?? '').length
            roundMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
          }
          continue
        }

        // 最后一轮模型还坚持调工具：内容通常为空，记一笔再走兜底，不让请求静默消失。
        if (toolCalls.length > 0) {
          log?.(`工具轮次用尽（第 ${round + 1}/${maxRounds} 轮仍有 ${toolCalls.length} 次工具调用）`)
        }

        reply = typeof msg?.content === 'string' ? msg.content : ''
        break
      }

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
      // 腔调守卫：把「我记下了」「比之前重」这类记账式句子整句摘掉。
      // 整段都被摘空时不强发空消息，保留原句，只记一笔。
      const voiced = cleanVoice(answer)
      if (voiced.dropped > 0) {
        log?.(`腔调清理：${voiced.dropped} 句（${voiced.hits.join('、')}）`)
        if (voiced.text !== '') answer = voiced.text
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
            if (safe !== '') {
              answer = safe
            } else {
              // 红线命中却没有可替换的安全台词：宁可不发，也不把原文放出去。
              return { ok: false, reason: 'intimacy-redline' }
            }
          } else if (intimacyNote !== '') {
            intimacySpoken = true
          }
        } catch (error) {
          log?.('贴近过滤异常：', String(error?.message ?? error))
        }
      }
      const emojiId = parsed.emojiId
      const stickerLabel = stickerParsed.label

      // 历史与记忆都存模型真正收到的那一句（已剥唤醒词）：口径一致，
      // 下一轮上下文里不会重新出现唤醒词，回看界面也不需要猜模型看到的是什么。
      // assistant 没有 source，但同样要带 scope——否则重启后一轮问答会被拆到两个桶。
      const userTurn = { role: 'user', content: spoken, at, source, scope }
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
          onIntimacySpoken(scope)
        } catch (error) {
          log?.('贴近记账失败：', String(error?.message ?? error))
        }
      }

      // 两路落盘互不牵连：记忆供提示词用，历史供界面回看。
      // 记忆写入带超时地等待完成：互斥还占着，下一轮不会抢跑，
      // 这一轮记得的东西在下一轮开始前已经落进内存；卡住也只拖 3 秒。
      if (typeof onExchange === 'function') {
        await withTimeout(
          () => onExchange({ user: spoken, assistant: answer, at, scope, source }),
          null,
          3_000
        )
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
    }
    } finally {
      // 无论哪条路径离开，都把互斥让出来；排队中的下一轮才能进场。
      busyScope = null
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
      busy: busyScope !== null
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
