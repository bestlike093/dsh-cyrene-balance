import { EXPRESSION_TAGS } from './expression.mjs'

/**
 * 表情图 id → 脸上情绪：贴纸出现时顺手把脸换成对得上的表情。
 *
 * 出处：遐蝶桌宠驱动 live2d-driver（2026-11-10 定版）web/driver.mjs 的
 * EMOJI_EXPRESSION 与 expressionMoods。驱动自述「代码本仓自写，
 * 形态参考鲸语 jingyu-live2d（MIT）」，映射表内容保留原样。
 *
 * 驱动里贴纸指向的表情名（013星星眼 等）是那具模型自带的 exp3 文件；
 * 我们的模型不一定有同名表情，所以这里多折一步：先照原表拿表情名，
 * 再折成 dsh-pet 的十情绪 tag，交给 expression 控制器走「自带表情优先、
 * 参数压脸兜底」的通道。驱动原表原样留在 DRIVER_EMOJI_EXPRESSION 里备查。
 */

/** 驱动原表：贴纸 id → 那具模型的表情名。 */
export const DRIVER_EMOJI_EXPRESSION = {
  'xd-happy': '013星星眼',
  'xd-proud': '008爱心眼',
  'xd-shy': '016脸红',
  'xd-gentle': '016脸红',
  'xd-sad': '015泪光',
  'xd-cry': '014流泪',
  'xd-angry': '009生气',
  'xd-thinking': '012O.O',
  'xd-surprised': '012O.O',
  'xd-sleepy': '019ZZZ',
  'xd-goodnight': '019ZZZ',
  'xd-sorry': '015泪光',
  hmph: '009生气',
  Madnow: '009生气',
  shyshort: '016脸红',
  sleepynow: '019ZZZ',
  goodnight: '019ZZZ',
  Thumbsup: '013星星眼',
  sogood: '013星星眼',
  sonice: '013星星眼',
  thinking: '012O.O',
}

/** 驱动原表：表情名 → 情绪。 */
export const DRIVER_EXPRESSION_MOODS = {
  '009生气': 'angry',
  '006黑脸': 'sad',
  '014流泪': 'sad',
  '015泪光': 'sad',
  '016脸红': 'shy',
}

/**
 * 驱动表情名里没有情绪记录的，按贴纸语义折算到我们的情绪 tag。
 * 只覆盖 EMOJI_EXPRESSION 表里实际出现的名字。
 */
const EXPRESSION_NAME_TO_EMOTION = {
  '013星星眼': 'excited',
  '008爱心眼': 'happy',
  '012O.O': 'thinking',
  '019ZZZ': 'tired',
}

/**
 * 贴纸 id → dsh-pet 情绪 tag。
 * 先查驱动原表；我们的素材表里贴纸 id 直接用情绪名（happy / shy …），
 * 是十情绪之一就照用；没有对应关系的返回 null，不动脸。
 */
export function emojiToEmotion(emojiId) {
  if (typeof emojiId !== 'string' || emojiId === '') return null
  const name = DRIVER_EMOJI_EXPRESSION[emojiId]
  if (name !== undefined) {
    return DRIVER_EXPRESSION_MOODS[name] ?? EXPRESSION_NAME_TO_EMOTION[name] ?? null
  }
  const tag = emojiId.trim().toLowerCase()
  return EXPRESSION_TAGS.includes(tag) ? tag : null
}
