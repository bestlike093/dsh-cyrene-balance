/**
 * 从会话里的用户发言挑出「值得记住的事」。
 *
 * 这里只做保守的规则抽取：明确的自述、偏好、近期事件和「记住……」。
 * 宁可少记，也不把代码、问句和随口一说塞进记忆，免得新会话被噪音淹没。
 * 纯函数，不依赖宿主与文件系统。
 *
 * 返回形状 { slot, text, kind }：slot 必须落在 memory-store 的 4 槽白名单
 * （identity / preference / event / relation）里，kind 是更细的分类标签。
 * 调用方（lib/index.js 的抽取入口）目前只消费 slot 与 text，多出的 kind 字段
 * 会被 memory-store 的 normalizeItem 忽略——等 13 槽白名单扩展后可直接启用。
 */

const CODE_HINTS = ['function', 'const ', 'let ', '=>', '#!/', 'http://', 'https://', '```']
const QUESTION_TAIL = /(吗|呢|么|嘛)[？?]?$/

/*
 * MEM-006：单条消息的候选上限从 3 提到 5（长叙述不再只留最早三条）。
 * 单轮上限在调用方 lib/index.js 的 candidates.slice(0, 4) 里，那是另一道闸，
 * 期望值是 8，需调用方同步放宽；常量先立在这里供引用。
 */
export const MAX_PER_MESSAGE = 5
export const PER_ROUND_LIMIT = 8

/* 显式记忆词：被点名要记的句子，配合具体信息兜底放行（MEM-005）。 */
const MEMORY_WORDS = /(记住|记着|别忘了|别忘|帮我记|记一下|记下来|记上|要记得|记得要)/
/*
 * 具体信息：数字、日期/星期词、常见地名后缀、拉丁字母串（人名/邮箱/密钥的原始形态）。
 * 纯中文的人名地名没有词典认不出来，这里只做保守覆盖，宁少放也不误放。
 */
const CONCRETE_HINT =
  /(\d|[A-Za-z]{2,}|(?:周|星期)[一二三四五六日天]?|(?:今|明|后|昨)天|(?:市|省|县|区|路|街|村|镇|公司|学校|医院|机场|车站))/

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，,、：:；;]+/, '')
    .replace(/[，,、：:；;]+$/, '')
}

function looksLikeCode(sentence) {
  return CODE_HINTS.some((hint) => sentence.includes(hint))
}

/*
 * 记忆会进人格提示词，先脱敏：本机路径与链接换成占位；手机号 / 邮箱 / 身份证 /
 * 密钥样式字符串也一律占位，不留原文。身份证（18 位连续数字）必须排在手机号之前，
 * 否则会被手机号规则先截走前 11 位；邮箱排在手机号之前，避免截掉邮箱里的数字段。
 */
function scrub(value) {
  return clean(value)
    .replace(/[A-Za-z]:\\[^\s，。！？]{1,200}/g, '<本地路径>')
    .replace(/https?:\/\/[^\s，。！？]{1,200}/g, '<链接>')
    .replace(/\b\d{17}[\dXx]\b/g, '[身份证]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]')
    .replace(/1[3-9]\d{9}(?!\d)/g, '[手机号]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{10,}|AKIA[A-Z0-9]{12,})\b/g, '[密钥]')
}

function sentencesOf(text) {
  return String(text ?? '')
    .slice(0, 400)
    .split(/[。！？!?\n]+/)
    .map(clean)
    .filter((sentence) => sentence.length >= 3 && sentence.length <= 120)
}

/**
 * @param {string} text 一条用户发言
 * @returns {Array<{ slot: 'identity'|'preference'|'event'|'relation', text: string, kind: string }>}
 */
export function extractMemoryCandidates(text) {
  const found = []
  const seen = new Set()

  function push(slot, value, kind = slot) {
    const line = scrub(value).slice(0, 80)
    if (line.length < 2 || seen.has(line) || QUESTION_TAIL.test(line)) return
    seen.add(line)
    found.push({ slot, text: line, kind })
  }

  for (const sentence of sentencesOf(text)) {
    if (looksLikeCode(sentence)) continue

    const name = sentence.match(/我(?:的名字)?叫\s*([^\s，。！？、]{1,20})/)
    if (name !== null && !['什么', '你', '他', '她'].includes(name[1])) {
      push('identity', `对方叫${name[1]}`, 'identity')
    }

    const like = sentence.match(/(?:我(?:很|挺|超|特别|最)?|(?:^|[，,、；;]))喜欢\s*([^，。！？]{1,40})/)
    if (like !== null) push('preference', `对方喜欢${like[1]}`, 'preference')

    const dislike = sentence.match(
      /(?:我(?:很|挺|超|特别|最)?|(?:^|[，,、；;]))(?:不喜欢|讨厌|受不了|害怕)\s*([^，。！？]{1,40})/,
    )
    if (dislike !== null) push('preference', `对方不喜欢${dislike[1]}`, 'preference')

    /*
     * MEM-024：habit / boundary / goal / ritual / knowledge / emotion 这六类空槽的写入口。
     * 13 槽白名单还没启用，这里只能映射回 4 槽：习惯与边界最接近「我不要什么」，
     * 目标 / 仪式 / 学到的知识 / 情绪属于发生或说出口的事；kind 字段先记下细分类，
     * 待 memory-store 的 SLOTS 扩展后无需改这里就能直接启用。
     * 习惯的捕获不认否定开头（「我每天不喝咖啡」不是习惯陈述，是例外）。
     */
    const habit = sentence.match(/我(?:的习惯是|习惯|总是|经常|每天|每周)\s*([^，。！？]{2,40})/)
    if (habit !== null && !habit[1].startsWith('不')) {
      push('preference', `对方习惯${habit[1]}`, 'habit')
    }

    if (/(?:我的(?:底线|边界|雷点)|别(?:再)?(?:叫|喊|碰|动|提)|不要(?:再)?(?:叫|喊|碰|动|提))/.test(sentence)) {
      push('preference', `对方的边界：${sentence}`, 'boundary')
    }

    const goal = sentence.match(/(?:我的目标是|我想达成|我打算|我计划|我要做到)\s*([^，。！？]{2,60})/)
    if (goal !== null) push('event', `对方的目标：${goal[1]}`, 'goal')

    if (/(?:每年的|每逢|仪式|纪念日)/.test(sentence)) {
      push('event', `对方的仪式：${sentence}`, 'ritual')
    }

    const learned = sentence.match(/(?:我(?:学会了|学到了|才知道|刚知道|第一次知道))\s*([^，。！？]{2,60})/)
    if (learned !== null) push('event', `对方学到：${learned[1]}`, 'knowledge')

    /*
     * MEM-025：显式记忆指令不再塞 relation（关系槽留给关系状态、称呼、亲疏）。
     * 4 槽里先落 preference，kind 标 promise；「记住下周三交报告」这类约定
     * 等 promise 槽启用后再归位。捕获前可空的「住」是给「记住」里的「住」让位，
     * 避免把「住下周三交报告」这种残字截进正文。
     */
    const remember = sentence.match(/(?:记住|别忘|帮我记|记一下)[：:，, ]*(?:住)?([^。！？]{2,80})/)
    // 剥掉语气词残片：「记住啊，周三开会」里的「啊」不该进正文；
    // 「帮我记下来」这类指令词会被捕获成「下来」，属于空话，交给下面的兜底类。
    const rememberBody =
      remember !== null
        ? remember[1].replace(/^[啊哦嗯呀哟]+[，,、：: ]*/, '').replace(/[，,、：: ]*[啊哦嗯呀哟]+$/, '')
        : ''
    const rememberValue =
      rememberBody.length >= 2 && !/^(下来|一下|着|上|了)$/.test(rememberBody) ? rememberBody : null
    if (rememberValue !== null) push('preference', `对方让你记住：${rememberValue}`, 'promise')

    const emotion = sentence.match(
      /我(?:很|好|太|特别|有点|真的)?(?:开心|高兴|难过|伤心|生气|焦虑|烦躁|烦|累|困|疲惫|兴奋|期待|委屈)/,
    )
    if (emotion !== null) {
      push('event', `对方说：${sentence}`, 'emotion')
    } else if (/(?:最近|今天|昨天|明天|这周|下周|这个月|下个月)/.test(sentence)) {
      push('event', `对方说：${sentence}`, 'event')
    } else {
      const doing = sentence.match(/我(?:正在|在|刚在|准备)\s*([^，。！？]{2,50})/)
      if (doing !== null) push('event', `对方在${doing[1]}`, 'event')
    }

    /*
     * MEM-005 兜底类「值得记的陈述」：六类句式之外，只要被点名要记
     * （显式记忆词）且带具体信息（数字/日期/地名/字母串），也放行——
     * 宁可信「帮我记下周三交报告」，也不让这类明确指令漏掉。
     * remember 规则抓到实词的句子不再重复记。
     */
    if (rememberValue === null && MEMORY_WORDS.test(sentence) && CONCRETE_HINT.test(sentence)) {
      push('event', `对方让记：${sentence}`, 'promise')
    }

    if (found.length >= MAX_PER_MESSAGE) break
  }

  return found.slice(0, MAX_PER_MESSAGE)
}
