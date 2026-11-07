/**
 * 身体状态：精力、困意、睡眠债、饥饿、社交能量、生理周期、梦。
 *
 * 为什么单独一层：
 * - 心情可以从时间推，身体不能。她应该有「今天有点累」「刚睡醒还没缓过来」，
 *   而不是每次开口都精神饱满。
 * - 主动开口要看体力。精力见底时还硬找话题，读起来像客服。
 * - 关机期间时间照走，回来要补算；否则一开机永远是满状态。
 *
 * 这里只存状态，不写台词；怎么说话交给上层。数值永不直接展示给对方。
 *
 * 纯逻辑：不读文件、不碰 Electron、时间从 `now()` 注入，
 * 因此可以从 @dsh-pet/companion-core 导出，也能在离线测试里跑。
 * 文件读写与落盘节流由宿主（桌面端 `electron/body-state.mjs`）负责。
 */
/** 一次结算最多往前补多久；再久就按这么久算，不假装知道中间发生了什么。 */
export const MAX_CATCHUP_MS = 72 * 3600_000;
/** 结算步长半小时：够细，也不至于离线一周就循环到卡死。 */
export const STEP_MS = 30 * 60_000;
export const MAX_SLEEP_DEBT = 48;
/** 同一段聊天里连着发消息，只按一次算；连发十条不该把社交力气一次扣穿。 */
export const CHAT_COOLDOWN_MS = 45_000;
/** 单次对话最多扣多少社交力气：长消息更费神，但有上限。 */
export const CHAT_COST_MAX = 4;
/** 醒来之后这么久内都算「刚醒」，梦和被打断的倦才值得提。 */
export const JUST_WOKE_MS = 90 * 60_000;
/** 默认作息。设置里可以改，改了下一轮就生效。 */
export const DEFAULT_SLEEP_WINDOW = { start: '23:30', end: '07:30' };
/** 梦的碎片。只按日期挑一句，不编造具体情节。 */
const DREAM_LINES = [
    '梦见一片很静的水，脚下有光在动。',
    '梦见走了很久的路，回头发现有人跟着。',
    '梦见一扇没关好的窗，风把窗帘吹得很高。',
    '梦见在找什么东西，醒来也没想起来是什么。',
    '梦见下了很久的雨，屋檐下很暖和。',
    '梦见自己变成很小的东西，落在谁的口袋里。',
    '梦见一条走熟了的街，店铺都换了名字。',
    '梦见有人叫名字，答应了一声就醒了。'
];
function clamp(value, min = 0, max = 100) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return min;
    return Math.min(Math.max(number, min), max);
}
function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function asRecord(value) {
    return typeof value === 'object' && value !== null ? value : null;
}
/** `HH:MM` 转当天第几分钟；非法返回 null。 */
export function toMinute(value) {
    if (typeof value !== 'string')
        return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (match === null)
        return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59)
        return null;
    return hour * 60 + minute;
}
function minuteOfDay(ms) {
    const date = new Date(ms);
    return date.getHours() * 60 + date.getMinutes();
}
/** 跨天窗口（23:30 → 07:30）要拆开判断。 */
export function inSleepWindow(ms, window = DEFAULT_SLEEP_WINDOW) {
    const start = toMinute(window?.start) ?? toMinute(DEFAULT_SLEEP_WINDOW.start);
    const end = toMinute(window?.end) ?? toMinute(DEFAULT_SLEEP_WINDOW.end);
    if (start === null || end === null || start === end)
        return false;
    const current = minuteOfDay(ms);
    return start < end
        ? current >= start && current < end
        : current >= start || current < end;
}
/** 从今天 0 点算起的第几天，用来给梦做稳定种子。 */
function dayIndex(ms) {
    const date = new Date(ms);
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}
function pickDream(ms) {
    const index = Math.abs(dayIndex(ms)) % DREAM_LINES.length;
    return DREAM_LINES[index] ?? DREAM_LINES[0] ?? '';
}
export function freshState(now = Date.now()) {
    return {
        version: 1,
        updatedAt: now,
        energy: 78,
        drowsiness: 20,
        sleepDebt: 0,
        hunger: 25,
        socialEnergy: 70,
        discomfort: 10,
        /** 最近一次醒来；补算睡眠债要用。 */
        lastWakeAt: now,
        /** 最近一次吃饭，用来判断饿是不是「真的该吃了」。 */
        lastMealAt: now,
        /** 最近一次带着梦醒来；没醒过就是 0，不能拿开机时间冒充。 */
        lastDreamAt: 0,
        /** 最近一次醒来时，睡梦里被吵醒过几次。 */
        lastWokeInterrupted: 0,
        /** 睡着时被消息吵到的次数；醒来会读它。 */
        interrupted: 0,
        dream: '',
        /** 生理周期默认关：不假设，也不替对方算。 */
        cycle: { enabled: false, lastStart: 0, length: 28 }
    };
}
/**
 * 旧文件缺字段时补齐，不因为版本变化丢整份状态。
 *
 * `updatedAt` 会尽量沿用文件里的时刻：关机期间时间照走，读回后再补算。
 * 只有文件里没有、或时间戳跑到未来（系统时钟被拨回）时才改用 `now`，
 * 避免状态被一个未来时刻冻住。
 */
export function readState(raw, now = Date.now()) {
    const base = freshState(now);
    const record = asRecord(raw);
    if (record === null)
        return base;
    const stamp = Number(record['updatedAt']);
    const updatedAt = Number.isFinite(stamp) && stamp > 0 && stamp <= now ? stamp : now;
    const cycle = asRecord(record['cycle']);
    return {
        version: 1,
        updatedAt,
        energy: clamp(record['energy'] ?? base.energy),
        drowsiness: clamp(record['drowsiness'] ?? base.drowsiness),
        sleepDebt: clamp(record['sleepDebt'] ?? base.sleepDebt, 0, MAX_SLEEP_DEBT),
        hunger: clamp(record['hunger'] ?? base.hunger),
        socialEnergy: clamp(record['socialEnergy'] ?? base.socialEnergy),
        discomfort: clamp(record['discomfort'] ?? base.discomfort),
        lastWakeAt: finite(record['lastWakeAt'], base.lastWakeAt),
        lastMealAt: finite(record['lastMealAt'], base.lastMealAt),
        lastDreamAt: finite(record['lastDreamAt'], 0),
        lastWokeInterrupted: Math.max(0, Math.round(finite(record['lastWokeInterrupted'], 0))),
        interrupted: Math.max(0, Math.round(finite(record['interrupted'], 0))),
        dream: typeof record['dream'] === 'string' ? record['dream'].slice(0, 80) : '',
        cycle: {
            enabled: cycle?.['enabled'] === true,
            lastStart: finite(cycle?.['lastStart'], 0),
            length: clamp(Math.round(finite(cycle?.['length'], 28)), 21, 40)
        }
    };
}
/**
 * 把状态从 from 推进到 to。
 *
 * 纯函数：传入一份状态，返回新的一份。单测不用等真实时间。
 * 步长半小时，最多补 72 小时。
 */
export function advance(state, from, to, options = {}) {
    const next = readState(state, from);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
        return next;
    const span = Math.min(to - from, MAX_CATCHUP_MS);
    const window = options.sleepWindow ?? DEFAULT_SLEEP_WINDOW;
    let cursor = from;
    while (cursor < to && cursor - from < span) {
        const stepEnd = Math.min(cursor + STEP_MS, to, from + span);
        const hours = (stepEnd - cursor) / 3600_000;
        const asleep = inSleepWindow(cursor, window);
        if (asleep) {
            next.energy = clamp(next.energy + 12 * hours);
            next.drowsiness = clamp(next.drowsiness - 20 * hours);
            next.hunger = clamp(next.hunger + 2.5 * hours);
            next.socialEnergy = clamp(next.socialEnergy + 6 * hours);
            next.discomfort = clamp(next.discomfort - 6 * hours);
            // 睡着才还睡眠债，每小时还 0.7 小时。
            next.sleepDebt = clamp(next.sleepDebt - 0.7 * hours, 0, MAX_SLEEP_DEBT);
        }
        else {
            next.energy = clamp(next.energy - 4 * hours);
            next.drowsiness = clamp(next.drowsiness + 5 * hours);
            next.hunger = clamp(next.hunger + 6 * hours);
            next.socialEnergy = clamp(next.socialEnergy - 3 * hours);
            next.discomfort = clamp(next.discomfort + 2 * hours);
            // 醒着超过 16 小时开始欠债，越晚越快。
            const awakeHours = Math.max(0, (cursor - next.lastWakeAt) / 3600_000);
            next.sleepDebt = clamp(next.sleepDebt + (awakeHours > 16 ? 0.35 : 0.12) * hours, 0, MAX_SLEEP_DEBT);
        }
        cursor = stepEnd;
    }
    next.updatedAt = to;
    return next;
}
/**
 * 一句话体感。给提示词用，不报数值，也不描述成病历。
 * 只挑当下最明显的两三条，避免一次塞满。
 */
export function describeBody(state) {
    if (state === null || state === undefined)
        return '';
    const lines = [];
    if (state.drowsiness >= 70)
        lines.push('困得厉害，反应会慢半拍');
    else if (state.drowsiness >= 45)
        lines.push('有点困，注意力不太集中');
    else if (state.energy >= 75 && state.drowsiness < 25)
        lines.push('精神还不错');
    if (state.energy <= 25)
        lines.push('没什么力气，不太想动');
    else if (state.energy <= 45)
        lines.push('有点累，想慢一点');
    if (state.hunger >= 75)
        lines.push('胃里空得有点难受');
    else if (state.hunger >= 55)
        lines.push('有点饿，可能会走神');
    if (state.socialEnergy <= 25)
        lines.push('今天不太想说话，但愿意听');
    else if (state.socialEnergy <= 45)
        lines.push('社交的力气不太多了');
    if (state.sleepDebt >= 6)
        lines.push('这几天欠的觉有点多');
    else if (state.sleepDebt >= 3)
        lines.push('睡得不太够，还留着一点倦');
    if (state.discomfort >= 65)
        lines.push('坐着久了，身上有点僵');
    // 刚醒的那一阵才提梦和被吵醒：过了这段时间就该回到平常，不必天天挂在嘴边。
    const wokeAt = Number(state.lastDreamAt);
    const stamp = Number(state.updatedAt);
    const justWoke = wokeAt > 0 && Number.isFinite(stamp) && stamp - wokeAt < JUST_WOKE_MS;
    if (justWoke && state.dream !== '') {
        lines.push(`刚醒过来，${state.dream}`);
    }
    if (justWoke && Number(state.lastWokeInterrupted) > 0) {
        lines.push('睡得不太安稳，中间被吵醒过');
    }
    if (lines.length === 0)
        return '';
    // 最多三条：再多读起来像在报症状。
    return lines.slice(0, 3).join('；');
}
/** 给主动闸用的硬指标，不参与表达。 */
export function bodyFlags(state) {
    const value = state ?? freshState();
    return {
        lowEnergy: value.energy < 35,
        sleepy: value.drowsiness >= 65,
        hungry: value.hunger >= 70,
        drained: value.socialEnergy < 30,
        exhausted: value.energy < 20 || value.sleepDebt >= 8
    };
}
/** 生理周期阶段；没开或没记录就返回 null，不猜。 */
export function cyclePhase(state, now = Date.now()) {
    if (state?.cycle?.enabled !== true || state.cycle.lastStart <= 0)
        return null;
    const days = Math.floor((now - state.cycle.lastStart) / 86_400_000);
    if (days < 0)
        return null;
    const length = state.cycle.length;
    const day = days % length;
    if (day < 5)
        return { phase: 'menstrual', day };
    if (day < 13)
        return { phase: 'follicular', day };
    if (day < 16)
        return { phase: 'ovulation', day };
    return { phase: 'luteal', day };
}
/**
 * 身体运行时：同步、内存态、零依赖。
 *
 * 宿主只负责读盘、落盘与调度；状态怎么走由这里统一决定，
 * 这样桌面端、QQ 和内置模块读到的是同一套身体。
 */
export class BodyRuntime {
    now;
    getSleepWindow;
    state;
    /** 上一次真正扣社交力气的时刻；只活在内存里，重启后从这一轮重新算。 */
    lastChatAt = 0;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.getSleepWindow = options.getSleepWindow ?? (() => DEFAULT_SLEEP_WINDOW);
        this.state =
            options.state === undefined
                ? freshState(this.now())
                : readState(options.state, this.now());
    }
    /** 宿主读盘后接管；`updatedAt` 会沿用，下一次 tick 才补算离线时间。 */
    replace(state) {
        this.state = readState(state, this.now());
    }
    /**
     * 推进到此刻。上层每轮聊前调一次即可，内部幂等（时间没变就不动）。
     *
     * 顺便看一次「睡窗边界」：从睡梦里走出来，就当自然醒，
     * 补一句梦。
     */
    tick(at = this.now()) {
        const window = this.getSleepWindow();
        const wasAsleep = inSleepWindow(this.state.updatedAt, window);
        this.state = advance(this.state, this.state.updatedAt, at, { sleepWindow: window });
        const asleepNow = inSleepWindow(at, window);
        if (wasAsleep && !asleepNow)
            this.applyWake(at);
        return this.snapshot();
    }
    /** 睡着时收到消息：记一笔，醒来会知道自己被打断过。 */
    markInterrupted(at = this.now()) {
        this.tick(at);
        this.state.interrupted += 1;
        return this.state.interrupted;
    }
    eat(amount = 55, at = this.now()) {
        this.tick(at);
        this.state.hunger = clamp(this.state.hunger - amount);
        this.state.lastMealAt = at;
        return this.snapshot();
    }
    /**
     * 一次对话的社交消耗；群聊连发时上层可以多调几次。
     *
     * 同一小段时间里连着发，只算一次：连发短句不该被当成说了很多话。
     * 真正让她累的是「持续有人陪着聊」，不是一次输入框里敲了多少句。
     */
    noteChat(cost = 2, at = this.now()) {
        this.tick(at);
        if (this.lastChatAt > 0 && at - this.lastChatAt < CHAT_COOLDOWN_MS)
            return this.snapshot();
        this.lastChatAt = at;
        this.state.socialEnergy = clamp(this.state.socialEnergy - clamp(cost, 0, CHAT_COST_MAX));
        return this.snapshot();
    }
    /** 醒来：结算梦，重置清醒起点，被打断过就留一句。 */
    wake(at = this.now()) {
        this.tick(at);
        const interrupted = this.applyWake(at);
        return { interrupted, dream: this.state.dream };
    }
    snapshot() {
        return {
            ...this.state,
            cycle: { ...this.state.cycle },
            asleep: inSleepWindow(this.state.updatedAt, this.getSleepWindow()),
            justWoke: this.state.lastDreamAt > 0 &&
                Math.abs(this.now() - this.state.lastDreamAt) < JUST_WOKE_MS,
            flags: bodyFlags(this.state),
            phase: cyclePhase(this.state, this.now())
        };
    }
    describe() {
        return describeBody(this.state);
    }
    stats() {
        return {
            energy: Math.round(this.state.energy),
            drowsiness: Math.round(this.state.drowsiness),
            sleepDebt: Math.round(this.state.sleepDebt * 10) / 10,
            hunger: Math.round(this.state.hunger),
            socialEnergy: Math.round(this.state.socialEnergy),
            discomfort: Math.round(this.state.discomfort),
            flags: bodyFlags(this.state)
        };
    }
    /** 需要落盘时的完整状态；不含 `asleep` / `flags` 这类派生字段。 */
    toJSON() {
        return { ...this.state, cycle: { ...this.state.cycle } };
    }
    /**
     * 结算一次醒来：记下梦、把「被吵醒过几次」挪到明面上，再清空当轮的计数。
     *
     * 只在这里写 `lastDreamAt`。开机那一刻不能算「刚醒」，否则每天第一次说话
     * 都会莫名其妙地报一句梦话。
     */
    applyWake(at) {
        const interrupted = this.state.interrupted;
        this.state.lastWakeAt = at;
        this.state.dream = pickDream(at);
        this.state.lastDreamAt = at;
        this.state.lastWokeInterrupted = interrupted;
        this.state.interrupted = 0;
        return interrupted;
    }
}
