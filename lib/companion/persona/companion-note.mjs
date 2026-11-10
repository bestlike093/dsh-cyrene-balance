/**
 * 陪伴片段：把一轮上下文整理成可以拼进 system 的文本。
 *
 * 只做格式化，不持有状态、不读文件、不发请求。
 * 心情、日程、话头的来源由调用方决定；这里只负责「有内容才写那一段」，
 * 免得模型为了填满格式去编一件根本没发生的事。
 */

/** 话头最多提几条。提醒太多会让每句话都变成追问。 */
const MAX_LOOPS = 3

/**
 * 表情 id 的中文提示。只用于让模型更快判断「这张配不配」，
 * 不在表里就只给 id，不编造含义。
 */
const EMOJI_HINTS = {
  airkiss: '轻轻一吻',
  allset: '准备好了',
  awesome: '厉害',
  awkward: '有点尴尬',
  blushhard: '脸红',
  copythat: '收到',
  deadtired: '累瘫',
  dream: '困困的',
  eating: '在吃东西',
  fighting: '加油',
  foryou: '为你',
  free: '自由了',
  gigglelots: '偷笑',
  giveup: '放弃',
  goodmorning: '早安',
  goodnight: '晚安',
  hello: '你好',
  hellyeah: '太好了',
  hi: '打招呼',
  hmph: '哼',
  hugtight: '抱紧',
  hurtcry: '委屈',
  madnow: '生气',
  midmeh: '一般般',
  missme: '想你',
  ok: '好',
  outfast: '先走了',
  paniccrying: '慌哭',
  please: '拜托',
  poorwallet: '钱包空空',
  putmd: '摆烂',
  shyshort: '害羞',
  sleepynow: '困了',
  sobbinghard: '哭得很凶',
  sogood: '好吃',
  sonice: '真好',
  sotired: '好累',
  teatime: '喝茶时间',
  thanks: '谢谢',
  thinking: '在想',
  thumbsup: '赞',
  vacayover: '假期结束',
  weeploud: '大哭',
  whatswrong: '怎么了'
}

/**
 * 把一轮上下文拼成提示词片段。
 *
 * 段落顺序：心情 → 日程 → 相关记忆 → 未聊完的话头 → 表情候选。
 * 越靠后越像「此刻正在发生」，模型也更容易把它当成当下的语气。
 *
 * 总长度兜底：超预算时按「先丢可再生的，再丢此刻的」整块丢弃——
 * 表情候选每轮重新生成、丢得起；话头和心情是连续性的根，最后才动。
 */
export function buildCompanionNote(turn, options = {}) {
  if (turn === null || typeof turn !== 'object') return ''
  const maxLoops = Number.isFinite(options.maxLoops) ? Math.max(0, Math.floor(options.maxLoops)) : MAX_LOOPS
  const maxChars = Number.isFinite(options.maxChars) ? Math.max(120, Math.floor(options.maxChars)) : 500
  const blocks = []

  if (typeof turn.moodNote === 'string' && turn.moodNote.trim() !== '') {
    blocks.push({ key: 'mood', text: `你此刻的心情：${turn.moodNote.trim()}。` })
  }

  // 日程只给「此刻在做什么」和「接下来是什么」。
  // 铺开整张表会让每句话都变成日程播报。
  if (typeof turn.agendaNote === 'string' && turn.agendaNote.trim() !== '') {
    blocks.push({ key: 'agenda', text: ['你现在正在过的这一天：', turn.agendaNote.trim()].join('\n') })
  }

  const memory = typeof turn.memoryNote === 'string' ? turn.memoryNote.trim() : ''
  if (memory !== '') {
    blocks.push({
      key: 'memory',
      text: [
        '下面是你记得的、和这句话有关的事。用得上的时候自然带一句，不要逐条复述，也不要说成「记录里写着」：',
        memory
      ].join('\n')
    })
  }

  const loops = Array.isArray(turn.openLoops)
    ? turn.openLoops.filter((item) => item !== null && typeof item?.text === 'string' && item.text.trim() !== '')
    : []
  if (loops.length > 0 && maxLoops > 0) {
    blocks.push({
      key: 'loops',
      text: ['还有几件没聊完的事。想接就轻轻接一句，不必每条都提，也不要追问：']
        .concat(loops.slice(-maxLoops).map((loop) => `- ${loop.text.trim()}`))
        .join('\n')
    })
  }

  const emoji = Array.isArray(turn.emoji) ? turn.emoji.filter((item) => typeof item?.entry?.id === 'string') : []
  if (emoji.length > 0) {
    // 只列前 3 张候选：清单越长越容易被预算截掉，反而一张都用不上。
    const names = emoji
      .slice(0, 3)
      .map((item) => {
        const hint = EMOJI_HINTS[item.entry.id]
        return hint === undefined ? item.entry.id : `${item.entry.id}（${hint}）`
      })
      .join('、')
    blocks.push({
      key: 'emoji',
      text: [
        `这一轮可以配一张小表情。想配就在整句末尾单独写 [图:id]，id 只能从这些里面挑：${names}。`,
        '配不上就不写，不要为了配图硬凑，也不要用别的写法。'
      ].join('\n')
    })
  }

  let text = blocks.map((block) => block.text).join('\n\n')
  if (blocks.length > 0 && Array.from(text).length > maxChars) {
    // 整块丢弃的顺序：记忆残段 → 表情候选 → 日程 → 话头；心情永不整块丢。
    for (const key of ['memory', 'emoji', 'agenda', 'loops']) {
      if (Array.from(text).length <= maxChars) break
      const index = blocks.findIndex((block) => block.key === key)
      if (index < 0) continue
      blocks.splice(index, 1)
      text = blocks.map((block) => block.text).join('\n\n')
    }
    if (Array.from(text).length > maxChars) {
      text = `${Array.from(text).slice(0, maxChars).join('')}…`
    }
  }

  return text
}
