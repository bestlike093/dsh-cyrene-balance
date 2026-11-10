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
/** 每轮只剥「中间不含 <」的最内层成对标签。 */
const INNERMOST_CONTROL_BLOCK =
  /<\s*(pc_[a-z0-9_]+|cyrene_[a-z0-9_]+|memory_[a-z0-9_]+)\s*>([^<]*?)<\/\s*\1\s*>/gi

/**
 * 迭代式剥除成对控制块。
 *
 * 为什么不用一条非贪婪正则直接删：嵌套同名标签
 * （`<pc_x>a<pc_x>b</pc_x>c</pc_x>`）会被非贪婪匹配截在第一个闭标签上，
 * 留下 `c</pc_x>` 这种孤儿。这里每轮只删最内层成对标签，反复剥到剥不动为止；
 * 剩下的孤立标签交给 CONTROL_TAG_PATTERN。
 */
function stripControlBlocks(text) {
  let next = text
  for (let round = 0; round < 32; round += 1) {
    const pass = next.replace(INNERMOST_CONTROL_BLOCK, '')
    if (pass === next) break
    next = pass
  }
  return next
}

/**
 * 清掉模型漏出来的内部控制标签。
 * 标签里的内容属于协议，不属于要对用户说的话。
 */
export function stripControlTags(text) {
  return stripControlBlocks(String(text ?? '')).replace(CONTROL_TAG_PATTERN, '')
}

/** 只保留第一句时，这些开头不算「内容」。 */
const FAREWELL_PATTERN =
  /^(晚安|晚安啦|早点睡|去睡吧|睡觉啦|睡吧|好梦|明天见|回头见|拜拜|再见|先这样|不聊了|我睡了|困了|谢谢|谢谢啦|谢啦|多谢|感谢|收到|知道啦|好|嗯|哦)[。.!！?？~～…\s]*$/i

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
  // 代码块里的段落不去重：围栏之间的内容整段保留，
  // 两段相同的代码示例各有各的意义，不能当复读删掉。
  // 围栏成对切换；没闭合的围栏会把后面的段落都当代码，宁可少删也不误删。
  let inFence = false
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (trimmed === '') continue
    const startsFence = trimmed.startsWith('```')
    // 单段自闭合的代码块（起止围栏在同一段里，如 ```\ncode\n```）不切换状态，整段保留；
    // 围栏状态只在围栏单独成段时成对切换。
    if (startsFence && trimmed.endsWith('```') && trimmed.length > 3) {
      kept.push(trimmed)
      continue
    }
    if (startsFence) {
      inFence = !inFence
      kept.push(trimmed)
      continue
    }
    if (inFence) {
      kept.push(trimmed)
      continue
    }
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    kept.push(trimmed)
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
  const last = lastAssistantText.trim()
  if (last === '') return false
  // 只有上一条是「纯收尾句」才沉默：剥掉收尾词后正文为空（或只剩称呼）才算，
  // 像「晚安，明天也记得交报告哦」这种带内容的晚安句不算，避免把用户的「谢谢」也吞掉。
  return isPureFarewell(last)
}

/**
 * 是不是「纯收尾」：剥掉收尾词、标点、语气词后，正文为空或只剩称呼。
 * 「晚安，好梦」算；「晚安，明天记得交报告」不算。
 */
function isPureFarewell(text) {
  const left = String(text ?? '')
    .replace(/[♪～~]+/g, '')
    .replace(FAREWELL_WORDS, '')
    .replace(/[。.!！?？~～…，,、：:；;\s啦呀啊嘛哦哟]+/g, '')
  if (left === '') return true
  // 只剩常见称呼也按收尾算（「晚安，主人」）；称呼表按需再扩。
  return /^(主人|主银|老板|前辈|宝贝|亲爱的|哥哥|姐姐)$/.test(left)
}

/** 收尾词：剥掉后剩下的才算「有内容」。长的排前面，避免被短词先吃掉。 */
const FAREWELL_WORDS =
  /(晚安啦|晚安|早点睡|去睡吧|睡觉啦|睡吧|好梦|明天见|回头见|拜拜|再见|先这样|不聊了|我睡了|困了|谢谢啦|谢啦|多谢|感谢|谢谢|收到|知道啦|知道了|好的|好|嗯+|哦+)/g

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
    // 优先找「内容就是引文本身」的发言（去掉引号后完全相等）：
    // 多人说过同一句话时，按最近一条逐字吻合的发言归人，而不是归给「包含」它的第一人。
    const exact = [...history]
      .reverse()
      .find((item) => {
        const content = typeof item?.text === 'string' ? item.text.trim() : ''
        const who = typeof item?.speaker === 'string' ? item.speaker.trim() : ''
        if (content === '' || who === '') return false
        return content.replace(/[「」“”"'`]/g, '').trim() === quote
      })
    if (exact !== undefined) return exact.speaker.trim()
    // 退回包含匹配：找不到逐字吻合的原话时，才找最近一条包含引文的发言。
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
