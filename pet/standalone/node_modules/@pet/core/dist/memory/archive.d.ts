/**
 * 记忆归档。
 *
 * 来自 Coopanion / dsh-world 的做法：记忆不切碎、不进向量库，
 * 原文按天留着，需要时再回捞。理由很朴素——一个人的生活，量没有那么大。
 *
 * 这里只做文本层的渲染与解析，不碰文件系统。
 * 落盘与版本保留交给宿主（Windows 版可以直接用 git 管理这份 md）。
 */
export type MemoryKind = 'talk' | 'event' | 'note';
export declare const MEMORY_KINDS: readonly MemoryKind[];
export interface MemoryEntry {
    /** 毫秒时间戳。 */
    readonly at: number;
    readonly kind: MemoryKind;
    /** 原文，可以是多行。 */
    readonly text: string;
}
/** 取本地日期键 `YYYY-MM-DD`。offsetMinutes 为相对 UTC 的偏移，默认用运行环境。 */
export declare function dayKey(at: number, offsetMinutes?: number): string;
/** 按天分组，天与天、天内的条目都按时间升序。 */
export declare function groupByDay(entries: readonly MemoryEntry[], offsetMinutes?: number): Map<string, MemoryEntry[]>;
/**
 * 渲染成 Markdown。
 *
 * 天用 `##`，条目用 `###`，正文一律走引用块 `>`。
 * 正文加前缀是为了让解析器只认「裸的 `###`」为标题——否则正文里
 * 随手写一句 `### 小标题` 就会把归档切坏，而且坏得悄无声息。
 */
export declare function renderArchive(entries: readonly MemoryEntry[], offsetMinutes?: number): string;
export interface ParseOptions {
    /** 缺省时把解析结果挂到「今天」；给定时按天还原时间戳。 */
    readonly offsetMinutes?: number;
    /** 解析时用的日历日，仅当条目只有时分、没有日期时使用。 */
    readonly now?: number;
}
/**
 * 从 Markdown 还原条目。
 *
 * 容错优先：任何 `### ` 开头的行都结束当前条目。认得出时分与类型就开新条目，
 * 认不出就只当分隔符——宁可丢一条坏标题之后的零散正文，也不让它把
 * 后续正常条目全吞进去。
 */
export declare function parseArchive(markdown: string, options?: ParseOptions): MemoryEntry[];
