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
/** 公历固定节日，任何年份都成立。 */
const GREGORIAN_FESTIVALS = {
    '01-01': '元旦',
    '02-14': '情人节',
    '05-01': '劳动节',
    '06-01': '儿童节',
    '10-01': '国庆节',
    '12-24': '平安夜',
    '12-25': '圣诞节'
};
/**
 * 农历节日显式日期表（2025–2035）。
 *
 * 由 lunar-javascript 一次性计算后写死；运行时不依赖任何农历库。
 * 2036 年起表里没有年份，农历节日自动返回空。
 */
const LUNAR_FESTIVALS = {
    2025: [
        { date: '2025-01-07', name: '腊八' },
        { date: '2025-01-28', name: '除夕' },
        { date: '2025-01-29', name: '春节' },
        { date: '2025-02-12', name: '元宵' },
        { date: '2025-05-31', name: '端午' },
        { date: '2025-10-06', name: '中秋' },
        { date: '2025-10-29', name: '重阳' }
    ],
    2026: [
        { date: '2026-01-26', name: '腊八' },
        { date: '2026-02-16', name: '除夕' },
        { date: '2026-02-17', name: '春节' },
        { date: '2026-03-03', name: '元宵' },
        { date: '2026-06-19', name: '端午' },
        { date: '2026-09-25', name: '中秋' },
        { date: '2026-10-18', name: '重阳' }
    ],
    2027: [
        { date: '2027-01-15', name: '腊八' },
        { date: '2027-02-05', name: '除夕' },
        { date: '2027-02-06', name: '春节' },
        { date: '2027-02-20', name: '元宵' },
        { date: '2027-06-09', name: '端午' },
        { date: '2027-09-15', name: '中秋' },
        { date: '2027-10-08', name: '重阳' }
    ],
    2028: [
        { date: '2028-01-04', name: '腊八' },
        { date: '2028-01-25', name: '除夕' },
        { date: '2028-01-26', name: '春节' },
        { date: '2028-02-09', name: '元宵' },
        { date: '2028-05-28', name: '端午' },
        { date: '2028-10-03', name: '中秋' },
        { date: '2028-10-26', name: '重阳' }
    ],
    2029: [
        { date: '2029-01-22', name: '腊八' },
        { date: '2029-02-12', name: '除夕' },
        { date: '2029-02-13', name: '春节' },
        { date: '2029-02-27', name: '元宵' },
        { date: '2029-06-16', name: '端午' },
        { date: '2029-09-22', name: '中秋' },
        { date: '2029-10-16', name: '重阳' }
    ],
    2030: [
        { date: '2030-01-11', name: '腊八' },
        { date: '2030-02-02', name: '除夕' },
        { date: '2030-02-03', name: '春节' },
        { date: '2030-02-17', name: '元宵' },
        { date: '2030-06-05', name: '端午' },
        { date: '2030-09-12', name: '中秋' },
        { date: '2030-10-05', name: '重阳' }
    ],
    2031: [
        { date: '2031-01-01', name: '腊八' },
        { date: '2031-01-22', name: '除夕' },
        { date: '2031-01-23', name: '春节' },
        { date: '2031-02-06', name: '元宵' },
        { date: '2031-06-24', name: '端午' },
        { date: '2031-10-01', name: '中秋' },
        { date: '2031-10-24', name: '重阳' }
    ],
    2032: [
        { date: '2032-01-20', name: '腊八' },
        { date: '2032-02-10', name: '除夕' },
        { date: '2032-02-11', name: '春节' },
        { date: '2032-02-25', name: '元宵' },
        { date: '2032-06-12', name: '端午' },
        { date: '2032-09-19', name: '中秋' },
        { date: '2032-10-12', name: '重阳' }
    ],
    2033: [
        { date: '2033-01-08', name: '腊八' },
        { date: '2033-01-30', name: '除夕' },
        { date: '2033-01-31', name: '春节' },
        { date: '2033-02-14', name: '元宵' },
        { date: '2033-06-01', name: '端午' },
        { date: '2033-09-08', name: '中秋' },
        { date: '2033-10-01', name: '重阳' }
    ],
    2034: [
        { date: '2034-01-27', name: '腊八' },
        { date: '2034-02-18', name: '除夕' },
        { date: '2034-02-19', name: '春节' },
        { date: '2034-03-05', name: '元宵' },
        { date: '2034-06-20', name: '端午' },
        { date: '2034-09-27', name: '中秋' },
        { date: '2034-10-20', name: '重阳' }
    ],
    2035: [
        { date: '2035-01-16', name: '腊八' },
        { date: '2035-02-07', name: '除夕' },
        { date: '2035-02-08', name: '春节' },
        { date: '2035-02-22', name: '元宵' },
        { date: '2035-06-10', name: '端午' },
        { date: '2035-09-16', name: '中秋' },
        { date: '2035-10-09', name: '重阳' }
    ]
};
/** 本地日期键，和节目单使用同一种写法。 */
export function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
export function isLunarTableYear(year) {
    return Object.prototype.hasOwnProperty.call(LUNAR_FESTIVALS, year);
}
/**
 * 今天是什么节日。
 * 农历优先于公历：春节和元旦撞在同一天时，说的是春节。
 * 表外的年份只返回公历固定节日；没有就返回 null。
 */
export function festivalOf(dateKey) {
    if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey))
        return null;
    const year = Number(dateKey.slice(0, 4));
    const table = LUNAR_FESTIVALS[year];
    if (Array.isArray(table)) {
        const hit = table.find((item) => item.date === dateKey);
        if (hit !== undefined)
            return { name: hit.name, kind: 'lunar' };
    }
    const gregorian = GREGORIAN_FESTIVALS[dateKey.slice(5)];
    return gregorian === undefined ? null : { name: gregorian, kind: 'gregorian' };
}
const OUTFIT_BANDS = [
    { key: 'freezing', max: 5, label: '很冷', tip: '厚外套、围巾，出门别把手露在外面' },
    { key: 'cold', max: 12, label: '偏冷', tip: '大衣加毛衣，风大的话再戴条围巾' },
    { key: 'cool', max: 20, label: '微凉', tip: '薄外套配长袖，早晚会差一点' },
    { key: 'mild', max: 27, label: '舒服', tip: '单衣加件轻外套，走起来刚刚好' },
    { key: 'hot', max: Number.POSITIVE_INFINITY, label: '热', tip: '短袖、遮阳，记得多喝水' }
];
/**
 * 她自己会穿的那几身，按档位分。
 * 只写衣服，不写天气建议——建议给旅人，穿着是她自己的事。
 */
const OUTFIT_WARDROBE = {
    freezing: [
        '奶油色厚羽绒服配深灰毛呢裤，围巾绕着脖子圈了两圈',
        '米白长大衣里套了奶黄色高领毛衣，手套塞在口袋里',
        '驼色棉服配格纹围巾，袖口收得紧紧的'
    ],
    cold: [
        '浅灰大衣配奶白毛衣，围巾松松搭在肩上',
        '藏青毛呢外套配浅色针织裙，底下加了厚打底',
        '豆沙色短外套配直筒长裤，脖子上绕了条细围巾'
    ],
    cool: [
        '奶咖色薄风衣配白衬衫，袖口卷了两折',
        '浅蓝牛仔外套配米白长袖，里面叠了件小背心',
        '燕麦色针织开衫配深色长裤，扣子只扣了中间一颗'
    ],
    mild: [
        '白色棉质衬衫配浅色长裤，袖子挽到小臂',
        '浅粉薄针织配直筒牛仔裤，外套随手搭在椅背上',
        '米色单衣外罩一件薄开衫，走路时会被风掀起来'
    ],
    hot: [
        '浅色短袖配薄纱长裙，头发整个束了起来',
        '白色棉麻短袖配阔腿裤，手腕上系了根细绳',
        '浅蓝薄衫配短裤，帽檐压得低低的'
    ]
};
/** 头发和手边的小东西。和穿着分开轮换，同一天同一档也能有别的样子。 */
const OUTFIT_LOOKS = [
    '头发松松扎在耳后，别了一枚小夹子',
    '头发编成一条松松的辫子搭在肩上',
    '头发散着，只用发带压了一下',
    '马尾扎得高了一点，发尾翘着',
    '头发拢成一束，用浅色发圈缠了两圈'
];
/** 由日期键得到一个稳定的数：同一天永远选同一套，换天才换。 */
function seedOf(dateKey) {
    let seed = 0;
    for (let index = 0; index < dateKey.length; index += 1) {
        const code = dateKey.charCodeAt(index);
        seed = (seed * 31 + code) % 100003;
    }
    return seed;
}
/**
 * 体感温度 → 穿搭档位，顺带定下她今天穿什么。
 * 没有有效温度就返回 null：宁可不说，也不凭空给一句「今天不冷」。
 * dateKey 省略时取第一套，保证老调用方行为稳定。
 */
export function outfitFor(feelsLike, dateKey = '') {
    if (typeof feelsLike !== 'number' || !Number.isFinite(feelsLike))
        return null;
    const band = OUTFIT_BANDS.find((item) => feelsLike <= item.max);
    if (band === undefined)
        return null;
    const wardrobe = OUTFIT_WARDROBE[band.key];
    const seed = seedOf(dateKey);
    return {
        key: band.key,
        label: band.label,
        tip: band.tip,
        wearing: wardrobe[seed % wardrobe.length] ?? wardrobe[0] ?? '',
        look: OUTFIT_LOOKS[(seed + band.key.length) % OUTFIT_LOOKS.length] ?? ''
    };
}
export function buildLifestyle(options) {
    const outfit = outfitFor(options.feelsLike, options.dateKey);
    return {
        date: options.dateKey,
        festival: festivalOf(options.dateKey),
        outfit,
        hasWeather: outfit !== null
    };
}
/**
 * 拼成一句可以直接进提示词的话。
 * 没有节日、也没有穿搭时返回空串，调用方据此不加这一段。
 */
export function describeLifestyle(snapshot) {
    const parts = [];
    if (snapshot.festival !== null)
        parts.push(`今天是${snapshot.festival.name}`);
    if (snapshot.outfit !== null) {
        parts.push(`外面${snapshot.outfit.label}，${snapshot.outfit.tip}`);
        // 她自己今天的样子：穿什么、头发怎么弄。只在有真实温度时出现，
        // 免得天气读不到就凭空描述一身衣服。
        if (snapshot.outfit.wearing !== '')
            parts.push(`你今天穿的是${snapshot.outfit.wearing}`);
        if (snapshot.outfit.look !== '')
            parts.push(snapshot.outfit.look);
    }
    return parts.join('；');
}
