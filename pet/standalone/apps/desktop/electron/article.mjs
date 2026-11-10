/**
 * 从 HTML 里取出正文。
 *
 * 只做一件事：把页面里给人读的那部分留下，导航、侧栏、脚注、脚本全扔掉。
 *
 * 为什么不引 DOM 解析库：桌宠的 core 要保持纯函数、无运行时依赖，
 * 这一层只做「够用的正文提取」。需要更精确的正文判定时（比如整页只剩一句
 * 「请开启 JavaScript」），上层再换实现，接口不变。
 */

/** 整段丢掉、连内容都不要的标签。 */
const DROP_WITH_CONTENT = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'svg',
  'canvas',
  'form',
  'nav',
  'footer',
  'aside'
]

/** 自己丢、但里面的文字要留下（只去壳）。 */
const UNWRAP = ['header', 'main', 'article', 'section', 'div', 'span', 'body']

/** 这些块级元素前后应当断行。 */
const BLOCK = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'tr',
  'br',
  'title',
  'figcaption'
]

export function extractArticle(html) {
  const source = String(html ?? '')
  const lang = matchAttr(source, 'html', 'lang')

  let work = stripComments(source)

  // 1. 连内容一起丢掉的标签
  for (const tag of DROP_WITH_CONTENT) {
    work = removeTag(work, tag)
  }

  const title = decodeEntities(
    firstMatch(work, 'title') ?? firstMatch(work, 'h1') ?? ''
  ).trim()

  // 2. 块级元素前后插换行，段落才能分开
  for (const tag of BLOCK) {
    work = work.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '\n')
  }

  // 3. 其余标签直接去壳，文字留下
  for (const tag of UNWRAP) {
    work = work.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '\n')
  }

  work = work.replace(/<[^>]+>/g, '')

  const text = normalize(decodeEntities(work))

  return {
    title,
    text,
    length: text.replace(/\s/g, '').length,
    lang
  }
}

/**
 * 正文是不是基本没取到。
 *
 * 单页应用常见：HTML 里只有 `<div id="app"></div>`，正文全靠脚本渲染。
 * 这种情况要明确告诉调用方「拿不到」，而不是返回一段空白当成功。
 */
export function isProbablyEmpty(article, threshold = 80) {
  return article.length < threshold
}

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** 正则特殊字符转义：下面用 RegExp 做大小写不敏感的 indexOf。 */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 大小写不敏感地找 needle 在 html 中 from 之后的位置，找不到返回 -1。 */
function indexOfIgnoreCase(html, needle, from) {
  const re = new RegExp(escapeRegex(needle), 'gi')
  re.lastIndex = from
  const match = re.exec(html)
  return match === null ? -1 : match.index
}

/** tag 名后面跟字母数字（<scripture>）就不算这个标签。 */
function isWordChar(char) {
  return char !== undefined && /[A-Za-z0-9_]/.test(char)
}

/** 开标签里可能带被引号包住的 '>'（<script data-x="a>b">），找真正的 '>'。 */
function findTagEnd(html, from) {
  let quote = null
  for (let i = from; i < html.length; i += 1) {
    const char = html[i]
    if (quote === null) {
      if (char === '"' || char === "'") quote = char
      else if (char === '>') return i
    } else if (char === quote) {
      quote = null
    }
  }
  return -1
}

/** 引号有没有成对闭合：JS 字符串里可以拼出 '</script>'，那种不能当真正的闭合。 */
function hasUnclosedQuote(text) {
  let state = null // null | `'` | `"` | `` ` ``
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (state === null) {
      if (char === "'" || char === '"' || char === '`') state = char
      continue
    }
    if (state === '`') {
      if (char === '`') state = null
      continue
    }
    if (char === '\\') {
      i += 1
      continue
    }
    if (char === state) state = null
  }
  return state !== null
}

/**
 * 连内容一起删掉一对标签。
 *
 * 不能简单用非贪婪正则：脚本里可以拼出 '</script>'（比如 `'</scr'+'ipt>'`），
 * 非贪婪匹配会停在那个假闭合上，把后半段脚本漏进正文。这里用 indexOf 循环：
 * 找到开标签后逐个找闭合，闭合前的引号没配对就继续找下一个真闭合。
 */
function removeTag(html, tag) {
  const openMarker = `<${tag.toLowerCase()}`
  const closeMarker = `</${tag.toLowerCase()}>`
  const out = []
  let cursor = 0
  let searchFrom = 0

  while (true) {
    const openAt = indexOfIgnoreCase(html, openMarker, searchFrom)
    if (openAt < 0) break
    if (isWordChar(html[openAt + openMarker.length])) {
      searchFrom = openAt + openMarker.length
      continue
    }
    const openEnd = findTagEnd(html, openAt)
    if (openEnd < 0) break

    let closeAt = indexOfIgnoreCase(html, closeMarker, openEnd + 1)
    while (closeAt !== -1 && hasUnclosedQuote(html.slice(openEnd + 1, closeAt))) {
      closeAt = indexOfIgnoreCase(html, closeMarker, closeAt + closeMarker.length)
    }
    if (closeAt === -1) break // 没有真闭合：剩余部分原样保留，和旧实现一致。

    out.push(html.slice(cursor, openAt))
    cursor = closeAt + closeMarker.length
    searchFrom = cursor
  }

  out.push(html.slice(cursor))
  return out.join('')
}

function firstMatch(html, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html)
  return m?.[1] ?? null
}

function matchAttr(html, tag, attr) {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']?([^"'\\s>]+)`, 'i').exec(html)
  return m?.[1] ?? null
}

/**
 * 折叠空白：行内连续空白变单空格，连续空行压成一个空行。
 */
function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·'
}

/**
 * 只解最常见的命名实体与数字实体。
 *
 * 没有全表：正文提取不需要完整的 HTML5 实体集，
 * 遇到不认识的保持原样，比猜错更安全。
 */
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }

    const named = ENTITIES[body.toLowerCase()]
    return named ?? whole
  })
}
