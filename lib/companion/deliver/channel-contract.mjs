/**
 * 聊天通道统一契约：QQ / 微信 / 未来的聊天平台都实现同一套适配器接口，
 * 上层（回复管线、主动开口、语音、贴纸）只跟这份契约打交道。
 *
 * 参考 AstrBot 的平台适配器思路：平台差异全部关在适配器里；
 * 本模块只负责「接口长什么样」与「入站归一化」，不实现任何平台的网络细节。
 *
 * 设计约束（与铁律一致）：
 * - 契约只描述形状，不持有状态；
 * - 各平台的文本上限在这里集中声明，别再散落到平台文件里；
 * - 适配器缺可选能力时（发不了图/发不了语音）要能如实回答，不许假装成功。
 */

/** 已登记的平台。新增平台（微信之后的下一个）先在这里登记。 */
export const CHANNEL_PLATFORMS = Object.freeze(['qq', 'wechat'])

/** 单条文本消息的上限（码点）。QQ 官方机器人 2000 字；企业微信 2048 字节。 */
export const CHANNEL_TEXT_LIMITS = Object.freeze({
  qq: 2000,
  wechat: 2048,
})

/** 适配器必备方法。 */
const REQUIRED_METHODS = Object.freeze(['start', 'stop', 'describe', 'sendText'])
/** 可选能力：拿不到就如实报告，上层据此降级（不附图、不补语音）。 */
const OPTIONAL_METHODS = Object.freeze(['sendVoice', 'sendImage', 'sendSticker', 'pushApproval', 'configure', 'restart'])

/**
 * 开发期自检：适配器缺了什么、多了什么一眼看清。
 * 返回 { ok, missing, extra }；missing 非空时必须补上才能上线。
 */
export function assertChannelAdapter(adapter, label = 'adapter') {
  if (adapter === null || typeof adapter !== 'object') {
    return { ok: false, label, missing: [...REQUIRED_METHODS], extra: [] }
  }
  const missing = REQUIRED_METHODS.filter((name) => typeof adapter[name] !== 'function')
  const extra = Object.keys(adapter).filter(
    (name) => !REQUIRED_METHODS.includes(name) && !OPTIONAL_METHODS.includes(name),
  )
  return { ok: missing.length === 0, label, missing, extra }
}

/**
 * 按码点切长文本，尽量在句子边界断。
 * 平台上限由 CHANNEL_TEXT_LIMITS 提供；未知平台回落保守值 1000。
 * 返回至少一段（原文比上限短就原样返回）。
 */
export function splitForChannel(text, platform, limit = null) {
  const source = typeof text === 'string' ? text : ''
  if (source === '') return ['']
  const cap = Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : CHANNEL_TEXT_LIMITS[platform] ?? 1000
  const chars = Array.from(source)
  if (chars.length <= cap) return [source]

  const parts = []
  let rest = chars
  while (rest.length > 0) {
    if (rest.length <= cap) {
      parts.push(rest.join(''))
      break
    }
    // 在 cap 内找最后一个句末标点断开，找不到就硬切（码点安全）。
    const windowChars = rest.slice(0, cap)
    let cut = -1
    for (let i = windowChars.length - 1; i >= 0; i -= 1) {
      if (/[。！？!?\n…]/.test(windowChars[i])) {
        cut = i + 1
        break
      }
    }
    if (cut <= 0) cut = cap
    parts.push(windowChars.slice(0, cut).join(''))
    rest = rest.slice(cut)
  }
  return parts
}

/**
 * 入站消息归一化：任何平台把原始入站翻成这一个形状，
 * 上层（记忆、分寸、回复管线）就不再认识平台字段。
 *
 * kind:   private / group / unknown
 * at:     事件时刻（ms，时间戳）
 * mentioned: 是否明确呼叫了她（@ / 点名）
 */
export function normalizeInbound(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const kind = source.kind === 'group' ? 'group' : source.kind === 'private' ? 'private' : 'unknown'
  const text = typeof source.text === 'string' ? source.text : ''
  return {
    platform: typeof source.platform === 'string' ? source.platform : 'unknown',
    kind,
    senderId: typeof source.senderId === 'string' ? source.senderId : '',
    targetId: typeof source.targetId === 'string' ? source.targetId : '',
    text,
    mentioned: source.mentioned === true,
    images: Array.isArray(source.images) ? source.images : [],
    msgId: typeof source.msgId === 'string' ? source.msgId : '',
    at: Number.isFinite(Number(source.at)) ? Number(source.at) : Date.now(),
  }
}

/** 出站统一形状：适配器各自把 replyText/replyImage 翻成平台的调用。 */
export function normalizeOutbound(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    kind: source.kind === 'group' ? 'group' : source.kind === 'private' ? 'private' : 'unknown',
    targetId: typeof source.targetId === 'string' ? source.targetId : '',
    text: typeof source.text === 'string' ? source.text : '',
    /** 本地文件绝对路径或 bytes；发不了图的适配器如实回 false。 */
    image: source.image ?? null,
    voice: source.voice ?? null,
    sticker: source.sticker ?? null,
  }
}
