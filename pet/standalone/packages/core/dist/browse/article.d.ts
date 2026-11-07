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
export interface Article {
    /** `<title>` 或第一个 `<h1>`，取到哪个算哪个。 */
    readonly title: string;
    /** 正文纯文本，段落之间空一行。 */
    readonly text: string;
    /** 正文字符数（不含空白）。 */
    readonly length: number;
    /** 页面声明的语言，没有就是 null。 */
    readonly lang: string | null;
}
export declare function extractArticle(html: string): Article;
/**
 * 正文是不是基本没取到。
 *
 * 单页应用常见：HTML 里只有 `<div id="app"></div>`，正文全靠脚本渲染。
 * 这种情况要明确告诉调用方「拿不到」，而不是返回一段空白当成功。
 */
export declare function isProbablyEmpty(article: Article, threshold?: number): boolean;
