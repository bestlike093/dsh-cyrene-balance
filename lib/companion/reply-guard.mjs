/**
 * 发送前的最后一道路口。
 *
 * 借鉴 AstrBot 陪伴插件的「发送前清理」：
 * - 模型偶尔会把内部控制标签漏进正文；
 * - 偶尔会把同一句原样复读两遍；
 * - 用户只是道晚安时，不该再被一句「晚安」追着回。
 *
 * 这里只做确定、可解释的机械处理，不改写语气，也不替模型润色。
 */

/** 内部标签：成对、转义、截断、孤立都清掉。 */
const CONTROL_TAG_PATTERN = /<\/?\s*(pc_[a-z0-9_]+|cyrene_[a-z0-9_]+|memory_[a-z0-9_]+)\s*\/?>/gi
/** 成对标签连同里面的协议值一起删：`<pc_mood>soft</pc_mood>` 不该留下 soft。 */
const CONTROL_BLOCK_PATTERN =
  /<\s*(pc_[a-z0-9_]+|cyrene_[a-z0-9_]+|memory_[a-z0-9_]+)\s*>[\s\S]*?<\/\s*\1\s*>/gi

/** 只保留第一句时，这些开头不算「内容」。 */
const FAREWELL_PATTERN =
  /^(晚安|晚安啦|早点睡|去睡吧|睡觉啦|睡吧|好梦|明天见|回头见|拜拜|再见|先这样|不聊了|我睡了|困了|谢谢|谢谢啦|谢啦|多谢|感谢|收到|知道啦|好|嗯|哦)[。.!！?？~～…\s]*$/i

/**
 * 清掉模型漏出来的内部控制标签。
 * 标签里的内容属于协议，不属于要对用户说的话。
 */
export function stripControlTags(text) {
  return String(text ?? '')
    .replace(CONTROL_BLOCK_PATTERN, '')
    .replace(CONTROL_TAG_PATTERN, '')
}

/**
 * 合并完全相同的整段复读。
 *
 * 只处理「整段一模一样」，叠词、语气重复、代码块都不动：
 * 「哈哈」和「哈哈哈」是两句话，「好耶\n\n好耶」才是复读。
 */
export function collapseDuplicateParagraphs(text) {
  const source = String(text ?? '')
  if (source.trim() === '') return ''
  const paragraphs = source.split(/\n{2,}/)
  const kept = []
  const seen = new Set()
  for (const paragraph of paragraphs) {
    const key = paragraph.trim()
    if (key === '') continue
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(paragraph.trim())
  }
  return kept.join('\n\n')
}

/**
 * 发送前清理。
 *
 * 返回 text 与 notes：notes 只用于日志和设置页解释「改了什么」，
 * 不进入正文，也不改变模型原本的意思。
 */
export function guardReply(text) {
  const notes = []
  let next = String(text ?? '')

  const stripped = stripControlTags(next)
  if (stripped !== next) {
    notes.push({ type: 'control_tag', detail: '清掉内部控制标签' })
    next = stripped
  }

  const collapsed = collapseDuplicateParagraphs(next)
  if (collapsed !== next) {
    notes.push({ type: 'duplicate_paragraph', detail: '合并重复段落' })
    next = collapsed
  }

  next = next.trim()
  return { text: next, notes }
}

/** 这句话是不是纯粹的收尾（晚安、道别、感谢、应声）。 */
export function isFarewell(text) {
  const source = String(text ?? '').trim()
  if (source === '') return false
  return FAREWELL_PATTERN.test(source.replace(/[♪～~]+/g, '').trim())
}

/**
 * 该不该保持沉默。
 *
 * 只在「上一轮已经收过尾，这一轮用户也只是收尾」时成立；
 * 带问题、带新话题、带图片的消息照常回复。
 */
export function shouldStaySilent(options = {}) {
  const userText = String(options.userText ?? '')
  const lastAssistantText = String(options.lastAssistantText ?? '')
  if (!isFarewell(userText)) return false
  if (lastAssistantText.trim() === '') return false
  return isFarewell(lastAssistantText) || /(晚安|好梦|明天见|早点睡|去睡吧)/.test(lastAssistantText)
}

/** 带引号的直接引语：只认这一种，避免把普通描述误判成引用。 */
const QUOTE_CLAIM_PATTERN =
  /你(?:刚才|刚刚|之前|前面|上一条|上一句|上次)?说(?:过|了)?[：:，,]?\s*[「“"]([^」”"]{2,60})[」”"]/g

/**
 * 纠正「把别人说的话安到当前这个人头上」。
 *
 * 群聊里模型常常看见一句印象深的话，就写成「你刚才说……」，
 * 可那句话其实是另一位群友说的。这里只处理带引号的直接引语：
 * 先在最近几条消息里找回原话属于谁，归错了就改成「刚才某某说」，
 * 找不到出处就退成「刚才群里有人说」。
 *
 * 没有引号的转述无法可靠归因，交给提示词约束，不在这里猜。
 */
export function fixMisattributedQuote(text, options = {}) {
  const source = String(text ?? '')
  const speaker = typeof options.speaker === 'string' ? options.speaker.trim() : ''
  const history = Array.isArray(options.history) ? options.history : []
  if (source === '' || speaker === '' || history.length === 0) {
    return { text: source, fixed: [] }
  }

  const ownerOf = (quote) => {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const item = history[index]
      const content = typeof item?.text === 'string' ? item.text : ''
      const who = typeof item?.speaker === 'string' ? item.speaker.trim() : ''
      if (content === '' || who === '') continue
      if (content.includes(quote)) return who
    }
    return null
  }

  const fixed = []
  const next = source.replace(QUOTE_CLAIM_PATTERN, (whole, quote) => {
    const owner = ownerOf(quote)
    if (owner === null) {
      fixed.push({ type: 'quote_unknown', quote })
      return `刚才群里有人说「${quote}」`
    }
    if (owner === speaker) return whole
    fixed.push({ type: 'quote_other_speaker', quote, owner })
    return `刚才${owner}说「${quote}」`
  })

  return { text: next, fixed }
}
