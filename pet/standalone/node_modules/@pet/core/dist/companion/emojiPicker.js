/**
 * 表情包选择。
 *
 * 规则优先于随机：同一个情绪下，她应该挑「这张最像此刻」，而不是每次抽签。
 * 四路打分加权，再加一条重复惩罚：
 *
 *   0.55 × 情绪匹配
 *   0.20 × 语域（此刻合不合适）
 *   0.15 × 新鲜度（多久没用了）
 *   0.10 × 场景
 *   − 重复惩罚
 *
 * 素材只按文件名索引，不读文件内容；真正的像素由宿主侧 `readAsset` 负责。
 */
/** 与 `assets/cyrene/emoji` 下的文件名一一对应。新增素材时只需在这里加一行。 */
export const DEFAULT_EMOJI_CATALOG = [
    { id: 'airkiss', file: 'Airkiss.png', emotions: ['shy', 'gentle'], scenes: ['comfort', 'farewell'] },
    { id: 'allset', file: 'Allset.png', emotions: ['happy', 'excited'], scenes: ['morning', 'work'] },
    { id: 'awesome', file: 'awesome.png', emotions: ['happy', 'excited'], scenes: ['praise'] },
    { id: 'awkward', file: 'awkward.png', emotions: ['shy', 'neutral'], scenes: ['tease'] },
    { id: 'blushhard', file: 'blushhard.png', emotions: ['shy'], scenes: ['praise'] },
    { id: 'copythat', file: 'copythat.png', emotions: ['neutral', 'happy'], scenes: ['work'] },
    { id: 'deadtired', file: 'deadtired.png', emotions: ['tired'], scenes: ['night', 'work'] },
    { id: 'dream', file: 'Dreak.png', emotions: ['tired', 'gentle'], scenes: ['night'] },
    { id: 'eating', file: 'eating.png', emotions: ['happy'], scenes: ['meal', 'noon'] },
    { id: 'fighting', file: 'fighting.png', emotions: ['excited', 'happy'], scenes: ['work', 'morning'] },
    { id: 'foryou', file: 'foryou.png', emotions: ['gentle'], scenes: ['comfort'] },
    { id: 'free', file: 'Free.png', emotions: ['happy'], scenes: ['evening', 'farewell'] },
    { id: 'gigglelots', file: 'Gigglelots.png', emotions: ['happy', 'excited'], scenes: ['tease'] },
    { id: 'giveup', file: 'giveup.png', emotions: ['sad', 'tired'], scenes: ['work'] },
    { id: 'goodmorning', file: 'goodmoring1.png', emotions: ['happy', 'gentle'], scenes: ['morning', 'greeting'] },
    { id: 'goodnight', file: 'goodnight.png', emotions: ['gentle', 'tired'], scenes: ['night', 'farewell'] },
    { id: 'hello', file: 'hello.png', emotions: ['happy'], scenes: ['greeting'] },
    { id: 'hellyeah', file: 'hellyeah.png', emotions: ['excited'], scenes: ['praise'] },
    { id: 'hi', file: 'HI.png', emotions: ['happy'], scenes: ['greeting'] },
    { id: 'hmph', file: 'hmph.png', emotions: ['angry', 'shy'], scenes: ['tease'], weight: 0.45 },
    { id: 'hugtight', file: 'hugtight.png', emotions: ['gentle'], scenes: ['comfort'] },
    { id: 'hurtcry', file: 'Hurtcry.png', emotions: ['sad'], scenes: ['comfort'], weight: 0.5 },
    { id: 'madnow', file: 'Madnow.png', emotions: ['angry'], scenes: ['tease'], weight: 0.4 },
    { id: 'midmeh', file: 'midmeh.png', emotions: ['neutral'], scenes: ['lazy'], weight: 0.5 },
    { id: 'missme', file: 'missme.png', emotions: ['shy', 'gentle'], scenes: ['comfort'] },
    { id: 'ok', file: 'OK.png', emotions: ['neutral', 'happy'], scenes: ['work'] },
    { id: 'outfast', file: 'outfast.png', emotions: ['happy'], scenes: ['farewell'] },
    { id: 'paniccrying', file: 'PanincCrying.png', emotions: ['surprised', 'sad'], scenes: ['work'] },
    { id: 'please', file: 'please.png', emotions: ['shy', 'gentle'], scenes: ['comfort'] },
    { id: 'poorwallet', file: 'poorwallet.png', emotions: ['sad'], scenes: ['tease'], weight: 0.4 },
    { id: 'putmd', file: 'putmd.png', emotions: ['neutral'], scenes: ['lazy'], weight: 0.45 },
    { id: 'shyshort', file: 'shyshort.png', emotions: ['shy'], scenes: ['praise'] },
    { id: 'sleepynow', file: 'sleepynow.png', emotions: ['tired'], scenes: ['night'] },
    { id: 'sobbinghard', file: 'Sobbinghard.png', emotions: ['sad'], scenes: ['comfort'], weight: 0.45 },
    { id: 'sogood', file: 'sogood.png', emotions: ['happy'], scenes: ['meal', 'praise'] },
    { id: 'sonice', file: 'sonice.png', emotions: ['happy', 'gentle'], scenes: ['praise'] },
    { id: 'sotired', file: 'sotired.png', emotions: ['tired'], scenes: ['work', 'night'] },
    { id: 'teatime', file: 'teatime.png', emotions: ['gentle', 'happy'], scenes: ['afternoon', 'lazy'] },
    { id: 'thanks', file: 'Thanks.png', emotions: ['happy', 'gentle'], scenes: ['praise'] },
    { id: 'thinking', file: 'thinking.png', emotions: ['thinking'], scenes: ['work'] },
    { id: 'thumbsup', file: 'Thumbsup.png', emotions: ['happy'], scenes: ['praise', 'work'] },
    { id: 'vacayover', file: 'Vcayover.png', emotions: ['sad', 'tired'], scenes: ['work'], weight: 0.45 },
    { id: 'weeploud', file: 'weeploud.png', emotions: ['sad'], scenes: ['comfort'], weight: 0.4 },
    { id: 'whatswrong', file: 'Whatswrong.png', emotions: ['thinking', 'gentle'], scenes: ['comfort'] }
];
/** 相近情绪：完全命中之外的第二档，避免只剩一张可用。 */
const NEAR_EMOTIONS = {
    neutral: ['gentle', 'thinking'],
    happy: ['excited', 'gentle'],
    sad: ['tired', 'gentle'],
    angry: ['shy', 'neutral'],
    surprised: ['thinking', 'excited'],
    shy: ['gentle', 'happy'],
    tired: ['sad', 'neutral'],
    thinking: ['neutral', 'surprised'],
    excited: ['happy', 'surprised'],
    gentle: ['shy', 'happy']
};
const WEIGHT_EMOTION = 0.55;
const WEIGHT_REGISTER = 0.2;
const WEIGHT_FRESHNESS = 0.15;
const WEIGHT_SCENE = 0.1;
const DEFAULT_FLOOR = 0.35;
/** 深夜和清早都压低高唤醒的图，避免凌晨两点的「hellyeah」。 */
function registerScore(entry, context) {
    const mood = context.mood;
    if (mood === undefined)
        return 0.6;
    const highArousal = entry.emotions.includes('excited') || entry.emotions.includes('surprised');
    const lowEnergy = entry.emotions.includes('tired') || entry.emotions.includes('gentle');
    if (mood.arousal <= 0.28 && highArousal)
        return 0.15;
    if (mood.arousal >= 0.7 && lowEnergy)
        return 0.4;
    if (mood.tension >= 0.55 && entry.emotions.includes('happy'))
        return 0.35;
    if (mood.valence <= -0.3 && entry.emotions.includes('happy'))
        return 0.25;
    return 0.75;
}
function emotionScore(entry, emotion) {
    if (entry.emotions.includes(emotion))
        return 1;
    const near = NEAR_EMOTIONS[emotion];
    if (entry.emotions.some((tag) => near.includes(tag)))
        return 0.6;
    return 0;
}
function freshnessScore(id, recentIds) {
    const index = recentIds.indexOf(id);
    if (index < 0)
        return 1;
    // 最近用过：第 0 近 = 0.05，第 5 近 ≈ 0.48，越远越接近 1。
    return Math.min(1, 0.05 + index * 0.09);
}
function repeatPenalty(id, recentIds) {
    const index = recentIds.indexOf(id);
    if (index < 0)
        return 0;
    if (index < 3)
        return 0.25;
    if (index < 10)
        return 0.1;
    return 0;
}
function sceneScore(entry, scene) {
    if (scene === undefined)
        return 0.5;
    return entry.scenes.includes(scene) ? 1 : 0.3;
}
export function pickEmoji(context, options = {}) {
    const catalog = options.catalog ?? DEFAULT_EMOJI_CATALOG;
    const recent = context.recentIds ?? [];
    const floor = options.floor ?? DEFAULT_FLOOR;
    const limit = options.limit ?? 6;
    const scored = catalog.map((entry) => {
        const emotion = emotionScore(entry, context.emotion);
        const register = registerScore(entry, context);
        const freshness = freshnessScore(entry.id, recent);
        const scene = sceneScore(entry, context.scene);
        const penalty = repeatPenalty(entry.id, recent);
        const raw = WEIGHT_EMOTION * emotion +
            WEIGHT_REGISTER * register +
            WEIGHT_FRESHNESS * freshness +
            WEIGHT_SCENE * scene -
            penalty;
        return {
            entry,
            score: Math.max(0, Math.min(1, raw * (entry.weight ?? 1))),
            breakdown: { emotion, register, freshness, scene, penalty }
        };
    });
    return scored
        .filter((item) => item.score >= floor)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}
/**
 * 从情绪标签反推「现在大概是什么场景」。
 *
 * 只在调用方没给场景时用，属于兜底推断；推不出来就返回 undefined，
 * 让场景分退化成中性 0.5，而不是硬编一个假的。
 */
export function inferScene(emotion, hour, options = {}) {
    if (emotion === 'tired')
        return hour >= 21 || hour <= 5 ? 'night' : 'work';
    if (emotion === 'gentle')
        return hour >= 21 || hour <= 5 ? 'night' : 'comfort';
    if (emotion === 'excited')
        return options.weekend === true ? 'lazy' : 'praise';
    if (emotion === 'thinking')
        return 'work';
    if (emotion === 'sad')
        return 'comfort';
    if (emotion === 'angry')
        return 'tease';
    if (emotion === 'happy') {
        if (hour >= 6 && hour < 10)
            return 'morning';
        if (hour >= 11 && hour < 14)
            return 'meal';
        if (hour >= 14 && hour < 18)
            return 'afternoon';
        if (hour >= 22 || hour < 3)
            return 'farewell';
        return 'greeting';
    }
    return undefined;
}
