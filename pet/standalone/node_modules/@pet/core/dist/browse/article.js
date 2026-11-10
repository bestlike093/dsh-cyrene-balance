/**
 * 从 HTML 里取出正文。
 *
 * 只做一件事：把页面里给人读的那部分留下，导航、侧栏、脚注、脚本全扔掉。
 *
 * 为什么不引 DOM 解析库：桌宠的 core 要保持纯函数、无运行时依赖，
 * 这一层只做「够用的正文提取」。需要更精确的正文判定时（比如整页只剩一句
 * 「请开启 JavaScript」），上层再换实现，接口不变。
 *
 * 这条能力对应注册表里的 `browse.read`。
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
];
/** 自己丢、但里面的文字要留下（只去壳）。 */
const UNWRAP = ['header', 'main', 'article', 'section', 'div', 'span', 'body'];
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
];
export function extractArticle(html) {
    const source = String(html ?? '');
    const lang = matchAttr(source, 'html', 'lang');
    let work = stripComments(source);
    // 1. 连内容一起丢掉的标签
    for (const tag of DROP_WITH_CONTENT) {
        work = removeTag(work, tag);
    }
    const title = decodeEntities(firstMatch(work, 'title') ?? firstMatch(work, 'h1') ?? '').trim();
    // 2. 块级元素前后插换行，段落才能分开
    for (const tag of BLOCK) {
        work = work.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '\n');
    }
    // 3. 其余标签直接去壳，文字留下
    for (const tag of UNWRAP) {
        work = work.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '\n');
    }
    work = work.replace(/<[^>]+>/g, '');
    const text = normalize(decodeEntities(work));
    return {
        title,
        text,
        length: text.replace(/\s/g, '').length,
        lang
    };
}
/**
 * 正文是不是基本没取到。
 *
 * 单页应用常见：HTML 里只有 `<div id="app"></div>`，正文全靠脚本渲染。
 * 这种情况要明确告诉调用方「拿不到」，而不是返回一段空白当成功。
 */
export function isProbablyEmpty(article, threshold = 80) {
    return article.length < threshold;
}
function stripComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '');
}
function removeTag(html, tag) {
    return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
}
function firstMatch(html, tag) {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
    return m?.[1] ?? null;
}
function matchAttr(html, tag, attr) {
    const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']?([^"'\\s>]+)`, 'i').exec(html);
    return m?.[1] ?? null;
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
        .trim();
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
};
/**
 * 只解最常见的命名实体与数字实体。
 *
 * 没有全表：正文提取不需要完整的 HTML5 实体集，
 * 遇到不认识的保持原样，比猜错更安全。
 */
function decodeEntities(text) {
    return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
        if (body.startsWith('#')) {
            const hex = body[1] === 'x' || body[1] === 'X';
            const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
            if (!Number.isFinite(code) || code < 0 || code > 0x10ffff)
                return whole;
            try {
                return String.fromCodePoint(code);
            }
            catch {
                return whole;
            }
        }
        const named = ENTITIES[body.toLowerCase()];
        return named ?? whole;
    });
}
