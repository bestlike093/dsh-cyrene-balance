// 记忆摘要（从 electron/main.mjs 迁出，存储与历史由调用方注入）。
//
// 只把「内存里已经没有了」的更早片段送进提示词。
// 当前会话的历史本来就跟着请求走，重复塞一遍只会白占预算。
import { STOP_BIGRAMS } from '@pet/shared';
const DEFAULT_LIMIT = 8;
const MAX_QUERY_LENGTH = 200;
/** 参与再排序的候选上限：200 条 × 平均百字，成本可控，又能捞到更早的旧片段。 */
const CANDIDATE_LIMIT = 200;
const MEANINGFUL = /[\p{L}\p{N}]/u;
function bigrams(text) {
    const chars = [...text.replace(/\s+/g, '')];
    const grams = new Set();
    for (let i = 0; i < chars.length - 1; i += 1) {
        const head = chars[i];
        const tail = chars[i + 1];
        if (head === undefined || tail === undefined)
            continue;
        const gram = head + tail;
        // 常见口头语不做检索词：它们几乎每条记忆都有，命中只说明「都是中文」。
        if (STOP_BIGRAMS.has(gram))
            continue;
        if (!MEANINGFUL.test(gram))
            continue;
        grams.add(gram);
    }
    return grams;
}
/** idf = log((N + 1) / (df + 1)) + 1：df 越高，这个词越不区分主题。 */
function idfOf(docGrams, gram) {
    const total = docGrams.length;
    if (total === 0)
        return 1;
    let df = 0;
    for (const grams of docGrams) {
        if (grams.has(gram))
            df += 1;
    }
    return Math.log((total + 1) / (df + 1)) + 1;
}
/**
 * 先挑和当前话题有词面重合的；不够再用最近的补足，避免只剩一两条碎记忆。
 *
 * 排序分 = 命中率（按 IDF 加权后的命中权重 / query 词数）+ 0.5 的新近度。
 * 用命中率而不是命中次数，长 query 不会因为「命中的常见词更多」而霸榜。
 */
function pickRelevant(items, query, limit) {
    const sample = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (sample === '')
        return items;
    const queryGrams = bigrams(sample);
    // 整句都是「今天/这个/可以」这类词：没有可检索的主题，只按新近取。
    if (queryGrams.size === 0)
        return items.slice(-limit);
    const start = Math.max(0, items.length - CANDIDATE_LIMIT);
    const candidates = items.slice(start);
    if (candidates.length === 0)
        return items;
    const docGrams = candidates.map((item) => bigrams(item.text));
    const weights = new Map();
    for (const gram of queryGrams)
        weights.set(gram, idfOf(docGrams, gram));
    const ranked = candidates
        .map((item, offset) => {
        const grams = docGrams[offset];
        let matched = 0;
        for (const gram of queryGrams) {
            if (grams !== undefined && grams.has(gram))
                matched += weights.get(gram) ?? 1;
        }
        const hitRate = matched / queryGrams.size;
        if (hitRate === 0)
            return { item, index: start + offset, score: 0 };
        const recency = offset / Math.max(1, candidates.length - 1);
        return { item, index: start + offset, score: hitRate + recency * 0.5 };
    })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.index - a.index);
    const picked = ranked.slice(0, limit);
    if (picked.length < limit) {
        const chosen = new Set(picked.map((entry) => entry.index));
        for (let offset = candidates.length - 1; offset >= 0 && picked.length < limit; offset -= 1) {
            const index = start + offset;
            if (!chosen.has(index)) {
                picked.push({ item: candidates[offset], index, score: 0 });
                chosen.add(index);
            }
        }
    }
    // 输出仍按原来的时间顺序，读起来像一段对话，而不是检索结果列表。
    return picked.sort((a, b) => a.index - b.index).map((entry) => entry.item);
}
export function buildMemoryDigest(input) {
    if (!input.enabled)
        return '';
    if (!input.available || input.count === 0)
        return '';
    const items = input.items;
    const overlap = Math.min(input.historyLength, items.length);
    const older = items.slice(0, items.length - overlap);
    if (older.length === 0)
        return '';
    const requested = input.limit ?? DEFAULT_LIMIT;
    const limit = Number.isInteger(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_LIMIT;
    const picked = typeof input.query === 'string' ? pickRelevant(older, input.query, limit) : older;
    return picked
        .map((item) => {
        // 记得「前天」比记得「11 月 5 日」更像人。没有时间的旧记录不加前缀。
        const when = typeof item.when === 'string' && item.when !== '' ? `${item.when} ` : '';
        return `${when}${item.role === 'user' ? '用户' : '你'}：${item.text}`;
    })
        .join('\n');
}
