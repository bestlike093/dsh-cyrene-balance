/**
 * 表情兜底：模型忘了写 [[表情:标签]] 时，按回复和用户这句话的情绪补一张。
 *
 * 从独立版主进程搬过来，原本贴在 QQ 回复链路上。
 * 这里只做「给哪个标签」，真正的挑图和发送由调用方决定，
 * 所以不碰磁盘、不碰网络，冷却用注入的时钟。
 */

/** 情绪 → 标签。顺序有意义：先命中的先用，晚安排在最前。 */
export const STICKER_FALLBACK_RULES = [
  { pattern: /(晚安|去睡|睡觉啦|睡咯)/, label: '晚安' },
  { pattern: /(早安|早上好)/, label: '早安' },
  { pattern: /(哈哈|笑死|嘿嘿|好耶|太棒|厉害|开心)/, label: '好耶' },
  { pattern: /(抱抱|抱一下|贴贴)/, label: '抱抱' },
  { pattern: /(想你|想我|念你)/, label: '想我' },
  { pattern: /(呜呜|委屈|难过|不开心|心疼)/, label: '委屈' },
  { pattern: /(加油|可以的|没问题|别怕)/, label: '加油' },
  { pattern: /(谢谢|多谢|太好了)/, label: '谢谢' },
  { pattern: /(害羞|脸红)/, label: '害羞' },
  { pattern: /(晚安啦|困了|累了|好累)/, label: '困了' }
]

/** 每个会话 10 分钟内最多自动补一张，免得把被动回复额度刷光。 */
export const STICKER_FALLBACK_GAP_MS = 10 * 60 * 1000

/**
 * 纯函数版：给回复与用户原话，返回该补的标签；空串表示这次不补。
 * lastAt 是同一会话上一次补表情的时间戳；没有就传 null，0 也会被当成真实时间戳。
 */
export function pickFallbackStickerLabel(input = {}) {
  const reply = String(input.reply ?? '')
  const userText = String(input.userText ?? '')
  const now = Number(input.now ?? Date.now())
  const hasLast = input.lastAt !== undefined && input.lastAt !== null && input.lastAt !== ''
  const lastAt = hasLast ? Number(input.lastAt) : 0
  const gapMs = Number(input.gapMs ?? STICKER_FALLBACK_GAP_MS)
  if (hasLast && Number.isFinite(lastAt) && now - lastAt < gapMs) return ''
  const text = `${reply}\n${userText}`
  for (const rule of STICKER_FALLBACK_RULES) {
    if (rule.pattern.test(text)) return rule.label
  }
  return ''
}

/**
 * 会记冷却的版本：调用方每次真的发出表情后调 markSent(key)。
 * 记住的只是时间，不记聊天内容。
 */
export function createStickerFallback(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const gapMs = Number(options.gapMs ?? STICKER_FALLBACK_GAP_MS)
  const lastAt = new Map()

  function labelFor(reply, userText, key = '') {
    const scope = String(key ?? '')
    return pickFallbackStickerLabel({
      reply,
      userText,
      now: now(),
      lastAt: lastAt.has(scope) ? lastAt.get(scope) : null,
      gapMs
    })
  }

  function markSent(key = '') {
    lastAt.set(String(key ?? ''), now())
  }

  function reset() {
    lastAt.clear()
  }

  return { labelFor, markSent, reset }
}
