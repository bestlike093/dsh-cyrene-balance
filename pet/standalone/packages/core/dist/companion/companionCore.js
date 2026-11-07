// 陪伴核心：把心情、断言记忆、反思、表情串成一条"一轮对话"的生命周期。
//
// 调用方只需要两个入口：
//   用户说完话 → onUserMessage()，拿到这一轮该带进提示词的内容
//   自己说完话 → onAssistantReply()，把这一轮收尾
//
// 所有状态都可以 toJSON / fromJSON，重启之后心情和记住的事都还在。
import { AssertionStore } from './assertions.js';
import { AgendaClaims, carryOver, defaultPlan, isPlanFor, planFromJSON, planNote } from './agenda.js';
import { inferScene, pickEmoji } from './emojiPicker.js';
import { MoodEngine } from './mood.js';
import { OpeningLedger } from './openingLedger.js';
import { ReflectionEngine } from './reflection.js';
const DEFAULT_EMOJI_LIMIT = 4;
const DEFAULT_RECENT_EMOJI_LIMIT = 12;
export class CompanionCore {
    mood;
    assertions;
    reflection;
    openings;
    storedAgenda;
    claimsStore;
    now;
    emojiLimit;
    recentEmojiLimit;
    recentEmojiIds = [];
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.mood = options.mood ?? new MoodEngine({ now: this.now });
        this.storedAgenda = options.agenda ?? defaultPlan(this.now());
        this.claimsStore = options.claims ?? new AgendaClaims();
        this.assertions = options.assertions ?? new AssertionStore({ now: this.now });
        this.reflection = options.reflection ?? new ReflectionEngine({ now: this.now });
        this.openings = options.openings ?? new OpeningLedger({ now: this.now, favor: options.favor });
        this.emojiLimit = Math.max(0, options.emojiLimit ?? DEFAULT_EMOJI_LIMIT);
        this.recentEmojiLimit = Math.max(0, options.recentEmojiLimit ?? DEFAULT_RECENT_EMOJI_LIMIT);
    }
    /** 最近用过的表情 id，越靠前越近。 */
    get recentEmoji() {
        return [...this.recentEmojiIds];
    }
    /** 今天的节目单；跨天时沿用旧结构。 */
    get agenda() {
        return this.ensureToday();
    }
    /** 认领记录，主进程决定要不要主动开口时用。 */
    get claims() {
        return this.claimsStore;
    }
    /** 主进程当天生成完节目单后注入；不是今天的单会被挪成今天。 */
    setAgenda(plan) {
        const now = this.now();
        this.storedAgenda = isPlanFor(plan, now) ? plan : carryOver(plan, now);
    }
    /** 主动说话用：此刻在做什么、接下来做什么。 */
    agendaNote() {
        return planNote(this.ensureToday(), this.now());
    }
    ensureToday() {
        const now = this.now();
        if (!isPlanFor(this.storedAgenda, now)) {
            this.storedAgenda = carryOver(this.storedAgenda, now);
        }
        return this.storedAgenda;
    }
    onUserMessage(text) {
        const now = this.now();
        // 先让过期的话头自己退场，再处理这一句。
        this.reflection.expireLoops(now);
        // 用户真的接话了：连续未回应计数清零，主动开口的节奏回到正常。
        this.openings.userReplied();
        const mood = this.mood.applyText(text);
        const emotion = this.mood.toEmotionTag(mood);
        const agenda = this.ensureToday();
        // 断言抽取自带四道闸门，这里不需要再判断一次。
        this.assertions.ingest(text);
        this.reflection.observe({ role: 'user', content: text });
        const reflection = this.reflection.shouldReflect(now)
            ? this.reflection.reflect(mood, now)
            : null;
        const memories = this.assertions.recall(text);
        const hour = new Date(now).getHours();
        const scene = inferScene(emotion, hour);
        const emoji = pickEmoji({
            emotion,
            mood,
            recentIds: this.recentEmojiIds,
            ...(scene === undefined ? {} : { scene })
        }, { limit: this.emojiLimit });
        return {
            mood,
            emotion,
            moodNote: this.mood.describe(mood),
            agenda,
            agendaNote: planNote(agenda, now),
            memories,
            memoryNote: this.assertions.render(memories),
            emoji,
            openLoops: this.reflection.loops('open'),
            reflection
        };
    }
    onAssistantReply(text, emojiId) {
        this.reflection.observe({ role: 'assistant', content: text });
        if (emojiId !== undefined)
            this.rememberEmoji(emojiId);
    }
    /** 用户对某条被提及的记忆作出反应后调用；用于把"提得对不对"学进去。 */
    noteMemoryReaction(assertionId, reaction) {
        this.assertions.feedback(assertionId, reaction);
    }
    /** 只读快照，给调试面板或日志用。 */
    snapshot() {
        return this.toJSON();
    }
    toJSON() {
        return {
            version: 1,
            mood: this.mood.toJSON(),
            agenda: this.storedAgenda,
            agendaClaims: this.claimsStore.toJSON(),
            assertions: this.assertions.toJSON(),
            reflection: this.reflection.toJSON(),
            openings: this.openings.toJSON(),
            recentEmoji: [...this.recentEmojiIds]
        };
    }
    /** 任意一层数据坏了都只丢那一层，不让整个陪伴状态读不出来。 */
    static fromJSON(raw, options = {}) {
        if (typeof raw !== 'object' || raw === null)
            return new CompanionCore(options);
        const record = raw;
        const now = options.now ? options.now() : Date.now();
        const nowOptions = options.now === undefined ? {} : { now: options.now };
        const core = new CompanionCore({
            ...options,
            mood: MoodEngine.fromJSON(record['mood'], nowOptions),
            agenda: planFromJSON(record['agenda'], now),
            claims: AgendaClaims.fromJSON(record['agendaClaims']),
            assertions: AssertionStore.fromJSON(record['assertions'], nowOptions),
            reflection: ReflectionEngine.fromJSON(record['reflection'], nowOptions),
            openings: OpeningLedger.fromJSON(record['openings'], nowOptions)
        });
        const recent = record['recentEmoji'];
        if (Array.isArray(recent)) {
            for (const id of recent) {
                if (typeof id === 'string')
                    core.rememberEmoji(id);
            }
        }
        return core;
    }
    rememberEmoji(id) {
        const next = [id, ...this.recentEmojiIds.filter((item) => item !== id)];
        this.recentEmojiIds =
            this.recentEmojiLimit === 0 ? [] : next.slice(0, this.recentEmojiLimit);
    }
}
