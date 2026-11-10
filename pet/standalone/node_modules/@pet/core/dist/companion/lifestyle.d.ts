/**
 * 生活细节：今天是什么日子，外面该穿什么。
 *
 * 两条边界：
 * - 节日只认表里的日期。农历表覆盖 2025–2035；表外年份只保留公历固定节日，
 *   农历节日返回空，由调用方整段省略。宁可不说，也不编。
 * - 穿搭只看体感温度。温度缺失时返回 null，不猜一个「大概不冷」。
 *
 * 这里不生成图片。穿着只是按日期定下的一组文字，供台词描述她自己今天的样子；
 * 具体长什么样仍由 Live2D 决定，两者不互相改。
 */
export type FestivalKind = 'gregorian' | 'lunar';
export interface Festival {
    name: string;
    kind: FestivalKind;
}
export interface OutfitBand {
    key: 'freezing' | 'cold' | 'cool' | 'mild' | 'hot';
    label: string;
    tip: string;
    /** 她自己当天穿的那一身。按日期轮换，同一天不会变。 */
    wearing: string;
    /** 头发和小物。和穿着分开挑，免得每天都像同一套。 */
    look: string;
}
export interface LifestyleSnapshot {
    date: string;
    festival: Festival | null;
    outfit: OutfitBand | null;
    /** 穿搭有没有真实温度来源。false 时 outfit 必为 null。 */
    hasWeather: boolean;
}
/** 本地日期键，和节目单使用同一种写法。 */
export declare function localDateKey(date: Date): string;
export declare function isLunarTableYear(year: number): boolean;
/**
 * 今天是什么节日。
 * 农历优先于公历：春节和元旦撞在同一天时，说的是春节。
 * 表外的年份只返回公历固定节日；没有就返回 null。
 */
export declare function festivalOf(dateKey: string): Festival | null;
/**
 * 体感温度 → 穿搭档位，顺带定下她今天穿什么。
 * 没有有效温度就返回 null：宁可不说，也不凭空给一句「今天不冷」。
 * dateKey 省略时取第一套，保证老调用方行为稳定。
 */
export declare function outfitFor(feelsLike: number | null | undefined, dateKey?: string): OutfitBand | null;
export interface BuildLifestyleOptions {
    dateKey: string;
    /** 体感温度（摄氏度）。缺失或非数字时整段穿搭省略。 */
    feelsLike?: number | null;
}
export declare function buildLifestyle(options: BuildLifestyleOptions): LifestyleSnapshot;
/**
 * 拼成一句可以直接进提示词的话。
 * 没有节日、也没有穿搭时返回空串，调用方据此不加这一段。
 */
export declare function describeLifestyle(snapshot: LifestyleSnapshot): string;
