/**
 * 腔调守卫。
 *
 * 有一批句式，单个看没什么，密度一高就不像人在说话了：
 * 「我记下了」「比之前的都重」「这句话稳」「你自己掂量」。
 * 它们把聊天变成了记账、打分和点评，对方会觉得在跟一个评审对话。
 *
 * 处理策略：先切句，命中就整句丢掉，剩下的原样保留。
 * 不做同义词替换——换了词，那种盖戳的语气还在。
 *
 * 用法：
 *   const { text, hits, dropped } = cleanVoice(reply)
 *   if (dropped > 0 && text.trim() === '') → 这句不值得说，直接不发
 */

/** 命中就整句删除的句式。顺序不影响结果。 */
const PATTERNS = [
  // 记账：把对方的话当成一笔要入账的东西。
  // 只认「我记下了」这一种盖戳写法；「我记着」「我记住了」是正常说话，不能误伤。
  /(?:这话|这句话|这个账)?我(?:都|也)?记下了/,
  /我记得了/,
  /(?:这话|这句话)我(?:留着|收下)/,
  /他记得这事/,
  /这个账我记/,

  // 比较：给每句话称重
  /比(?:之前|刚才|刚才那句|刚才说的|上一句)(?:的)?都?(?:重|轻|强|稳|沉|平)/,
  /比(?:之前|刚才)(?:的)?都/,
  /比[^，。！？\n]{0,6}(?:重|轻|沉|稳)/,
  /(?:说的)?比谁都(?:响|重|轻|沉|稳)/,
  // 「很平/很直」本身是正常形容词，只有贴着声音/语气/说话语境才是点评腔。
  /(?:声音|语气|说话|这话|这句|声线|语调)[^，。！？\n]{0,4}(?:很平|很直)/,

  // 守候：把自己摆成一座望夫石
  /睡吧[，,]?\s*我守着/,
  /你去[，,]?\s*我跟/,
  /我不拦/,
  /我不催/,
  // 只认「你回去睡吧/睡觉」这种守候腔；「我回去睡了」是正常陈述，不删。
  /你回去睡(?:吧|觉)/,

  // 点评：像裁判给动作打分
  /这句话(?:接[得的地]?漂亮|我不接|稳)/,
  /没接(?:你|你那句)/,
  /什么心思都(?:写|挂|刻)/,
  /问别人还是问自己/,
  /还是你自己想明白的/,
  /是ta告诉你的/,
  /这句话我不接/,

  // 认领：仿佛在签收一份判决
  /我认(?:了|下来)/,
  /认下来/,
  /认这个/,
  /认得实/,
  /就是认了/,
  /^认得/,
  /^(?:行[，,]\s*)?认你$/,

  // 掂量：把选择权推回去，还带着居高临下
  /你自己掂量/,
  /你掂量/,
  /收不回去/,

  // 单句只剩一个态度词，本身没有内容
  /^稳[。.！!…]?$/,
  /^很稳[。.！!…]?$/,
  /^我跟[。.]?$/,
  /^不催[。.]?$/,
  /^行[，,]\s*\S{0,6}$/,
  /^认[。.]?$/
]

/** 按句末标点切句，保留标点。省略号不断句，避免「嗯……然后」被切两段。 */
function splitSentences(text) {
  const parts = String(text ?? '')
    .split(/(?<=[。！？!?\n])/)
    .filter((part) => part.trim() !== '')
  // 以 … 开头的碎片并回前一句：省略号是话没说完，不是句子边界。
  const merged = []
  for (const part of parts) {
    if (merged.length > 0 && /^…+/.test(part)) {
      merged[merged.length - 1] += part
    } else {
      merged.push(part)
    }
  }
  return merged
}

/** 单句扫描。返回命中的原文片段。 */
export function scanVoice(text) {
  const hits = []
  for (const pattern of PATTERNS) {
    const found = String(text ?? '').match(pattern)
    if (found !== null) hits.push(found[0])
  }
  return hits
}

/**
 * 删掉带腔调的句子。
 * 全部删空时返回空串，调用方据此决定不发这条。
 */
export function cleanVoice(text) {
  const sentences = splitSentences(text)
  const kept = []
  const hits = []
  let dropped = 0

  for (const sentence of sentences) {
    const found = scanVoice(sentence)
    if (found.length > 0) {
      hits.push(...found)
      dropped += 1
      continue
    }
    kept.push(sentence)
  }

  return {
    text: kept.join('').replace(/\n{3,}/g, '\n\n').trim(),
    hits,
    dropped
  }
}

/**
 * 一句话该不该重新生成。
 * 命中两句以上，说明整段的语气已经跑偏，删句救不回来。
 */
export function shouldRegenerate(text) {
  return scanVoice(text).length >= 2
}

/** 给提示词用的一句话约束，避免模型再往这个方向写。 */
export const VOICE_NOTE = [
  '说话像人，不像评审。不要给对话称重、打分、记账。',
  '不要说「我记下了」「比之前重」「这句话稳」「你掂量」这类话。',
  '想表达听懂了，就直接接内容，或者用一句平常的话应一声。'
].join('\n')
