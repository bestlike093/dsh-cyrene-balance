/**
 * 从会话里的用户发言挑出「值得记住的事」。
 *
 * 这里只做保守的规则抽取：明确的自述、偏好、近期事件和「记住……」。
 * 宁可少记，也不把代码、问句和随口一说塞进记忆，免得新会话被噪音淹没。
 * 纯函数，不依赖宿主与文件系统。
 */

const CODE_HINTS = ['function', 'const ', 'let ', '=>', '#!/', 'http://', 'https://', '```']
const QUESTION_TAIL = /(吗|呢|么|嘛)[？?]?$/

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

/* 记忆会进人格提示词，本机路径与链接先换成占位，不留原文 */
function scrub(value) {
  return clean(value)
    .replace(/[A-Za-z]:\\[^\s，。！？]{1,200}/g, '<本地路径>')
    .replace(/https?:\/\/[^\s，。！？]{1,200}/g, '<链接>')
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
 * @returns {Array<{ slot: 'identity'|'preference'|'event'|'relation', text: string }>}
 */
export function extractMemoryCandidates(text) {
  const found = []
  const seen = new Set()

  function push(slot, value) {
    const line = scrub(value).slice(0, 80)
    if (line.length < 2 || seen.has(line) || QUESTION_TAIL.test(line)) return
    seen.add(line)
    found.push({ slot, text: line })
  }

  for (const sentence of sentencesOf(text)) {
    if (looksLikeCode(sentence)) continue

    const name = sentence.match(/我(?:的名字)?叫\s*([^\s，。！？、]{1,20})/)
    if (name !== null && !['什么', '你', '他', '她'].includes(name[1])) {
      push('identity', `对方叫${name[1]}`)
    }

    const like = sentence.match(/(?:我(?:很|挺|超|特别|最)?|(?:^|[，,、；;]))喜欢\s*([^，。！？]{1,40})/)
    if (like !== null) push('preference', `对方喜欢${like[1]}`)

    const dislike = sentence.match(
      /(?:我(?:很|挺|超|特别|最)?|(?:^|[，,、；;]))(?:不喜欢|讨厌|受不了|害怕)\s*([^，。！？]{1,40})/,
    )
    if (dislike !== null) push('preference', `对方不喜欢${dislike[1]}`)

    const remember = sentence.match(/(?:记住|别忘|帮我记|记一下)[：:，, ]*([^。！？]{2,80})/)
    if (remember !== null) push('relation', `对方让你记住：${remember[1]}`)

    if (/(?:最近|今天|昨天|明天|这周|下周|这个月|下个月)/.test(sentence)) {
      push('event', `对方说：${sentence}`)
    } else {
      const doing = sentence.match(/我(?:正在|在|刚在|准备)\s*([^，。！？]{2,50})/)
      if (doing !== null) push('event', `对方在${doing[1]}`)
    }

    if (found.length >= 3) break
  }

  return found.slice(0, 3)
}
