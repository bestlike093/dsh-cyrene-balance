/**
 * 主动开口的候选。
 *
 * 把「什么时候可以说话」和「说什么」分开：
 * 这里只回答前者——现在有没有值得主动开口的理由，以及优先级。
 * 真正调模型、挑表情、发到哪个通道，仍然由主进程决定。
 *
 * 纯逻辑：时间、状态都从参数进来，不读文件、不碰网络。
 */
import { minuteOfDay, segmentAt } from './agenda.js';
export const DEFAULT_LOOP_MIN_AGE_MS = 20 * 60_000;
export const DEFAULT_ABSENCE_AFTER_MS = 3 * 24 * 60 * 60_000;
export const DEFAULT_AGENDA_WINDOW_MS = 30 * 60_000;
export const DEFAULT_THOUGHT_MIN_AGE_MS = 20 * 60_000;
const PRIORITY_THOUGHT = 100;
const PRIORITY_ABSENCE = 90;
const PRIORITY_LOOP = 70;
const PRIORITY_AGENDA = 50;
function minuteLabel(minute) {
    const safe = Math.max(0, Math.min(24 * 60, Math.trunc(minute)));
    const hour = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${`${hour}`.padStart(2, '0')}:${`${rest}`.padStart(2, '0')}`;
}
/**
 * 此刻所有成立的开口理由，按优先级从高到低。
 *
 * 任何一道闸门没通过都返回空数组：宁可这一拍不说话，也不要事后解释「为什么打扰你」。
 */
export function candidatesAt(input) {
    if (input.asleep === true)
        return [];
    if (input.quiet === true)
        return [];
    if (typeof input.cooldownUntil === 'number' && input.now < input.cooldownUntil)
        return [];
    const found = [];
    // 念头池排在最前：这是她自己攒下、还没说出口的一件具体的事。
    // 仍然排在睡眠、免打扰、冷却之后；安静的时候，再想说的念头也先放着。
    const thought = input.thought ?? null;
    if (thought !== null && typeof thought.text === 'string' && thought.text.trim() !== '') {
        const minAge = input.thoughtMinAgeMs ?? DEFAULT_THOUGHT_MIN_AGE_MS;
        if (input.now - thought.createdAt >= minAge) {
            found.push({
                kind: 'thought',
                priority: PRIORITY_THOUGHT,
                segmentId: null,
                thoughtId: thought.id,
                note: `心里还记着一件事：${thought.text.trim()}`,
                reason: 'thought'
            });
        }
    }
    const lastUserAt = input.lastUserAt ?? null;
    const absenceAfter = input.absenceAfterMs ?? DEFAULT_ABSENCE_AFTER_MS;
    if (typeof lastUserAt === 'number' && input.now - lastUserAt >= absenceAfter) {
        const days = Math.max(1, Math.floor((input.now - lastUserAt) / (24 * 60 * 60_000)));
        found.push({
            kind: 'absence',
            priority: PRIORITY_ABSENCE,
            segmentId: null,
            thoughtId: null,
            note: `已经 ${days} 天没有好好说过话了。`,
            reason: 'absence'
        });
    }
    const loop = input.loop ?? null;
    if (loop !== null && typeof loop.text === 'string' && loop.text.trim() !== '') {
        const minAge = input.loopMinAgeMs ?? DEFAULT_LOOP_MIN_AGE_MS;
        if (input.now - loop.createdAt >= minAge) {
            found.push({
                kind: 'loop',
                priority: PRIORITY_LOOP,
                segmentId: null,
                thoughtId: null,
                note: `还有一件没聊完的事：${loop.text.trim()}`,
                reason: 'loop'
            });
        }
    }
    // 累了就别没话找话。日程段落是「顺便聊一句」，最该先收起来；
    // 话头和很久没联系还在，因为那两件事本身值得说。
    const current = input.tired === true ? null : segmentAt(input.agenda, input.now);
    const claimed = new Set(input.claimedSegmentIds ?? []);
    if (current !== null && current.kind !== 'sleep' && !claimed.has(current.id)) {
        const windowMs = input.agendaWindowMs ?? DEFAULT_AGENDA_WINDOW_MS;
        // 距这一段开始过了多久；按分钟粒度算就够，不必抠秒。
        const elapsed = minuteOfDay(input.now) * 60_000 - current.startMinute * 60_000;
        if (elapsed >= 0 && elapsed <= windowMs) {
            const title = typeof current.title === 'string' ? current.title.trim() : '';
            const memo = typeof current.memo === 'string' ? current.memo.trim() : '';
            found.push({
                kind: 'agenda',
                priority: PRIORITY_AGENDA,
                segmentId: current.id,
                thoughtId: null,
                note: `现在是 ${minuteLabel(current.startMinute)} 开始的「${title}」` +
                    `${memo === '' ? '。' : `，${memo}。`}`,
                reason: `agenda:${current.kind}`
            });
        }
    }
    return found.sort((a, b) => b.priority - a.priority);
}
/** 只取最高优先级的一条；没有就是这一拍不该主动开口。 */
export function pickCandidate(input) {
    return candidatesAt(input)[0] ?? null;
}
