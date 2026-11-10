/**
 * 游戏日常的排班模型。
 *
 * 来自 dsh-game-daily 的做法：设置页只负责收集意图，真正写进计划任务的
 * 是一份可校验的规格。校验放在这里，宿主拿到规格再决定怎么注册。
 *
 * 刻意不碰计划任务、不碰进程、不碰文件：这一层只回答「该在什么时候跑、
 * 最多跑多久、跑的是真实还是演练」。
 */
export const GAME_IDS = ['genshin', 'hi3', 'starrail', 'zzz'];
/**
 * 每轮默认超时（分钟）。
 *
 * 原神 150：一条龙流程长，还要等 BetterGI 启动。
 * 崩3 / 星铁 45：流程短，超时主要是防卡死。
 * 绝区零 60：一条龙多了切窗口与后端启动。
 */
export const DEFAULT_TIMEOUT_MINUTES = {
    genshin: 150,
    hi3: 45,
    starrail: 45,
    zzz: 60
};
/** 计划任务的系统执行时限 = 单轮超时 + 余量。余量里 5 分钟给看门狗收尾。 */
export const EXECUTION_LIMIT_MARGIN_MINUTES = 10;
export const MIN_TIMEOUT_MINUTES = 5;
export const MAX_TIMEOUT_MINUTES = 180;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** 时间是否是合法的 `HH:MM`。读盘修复与保存校验共用这一条规则。 */
export function isValidTime(value) {
    return TIME_PATTERN.test(value);
}
export function isGameId(value) {
    return GAME_IDS.includes(value);
}
/**
 * 校验配置。
 *
 * 一次返回全部问题，而不是遇到第一个就抛错——面板要一次性把红字标完，
 * 让用户改一遍就能保存，不用来回试。
 */
export function validateConfig(config) {
    const issues = [];
    if (!isGameId(config.game)) {
        issues.push({ field: 'game', message: `未知游戏：${String(config.game)}` });
    }
    if (!TIME_PATTERN.test(config.time)) {
        issues.push({ field: 'time', message: '时间必须是 HH:MM，24 小时制' });
    }
    if (!Number.isInteger(config.timeoutMinutes)) {
        issues.push({ field: 'timeoutMinutes', message: '超时必须是整数分钟' });
    }
    else if (config.timeoutMinutes < MIN_TIMEOUT_MINUTES ||
        config.timeoutMinutes > MAX_TIMEOUT_MINUTES) {
        issues.push({
            field: 'timeoutMinutes',
            message: `超时需在 ${MIN_TIMEOUT_MINUTES}–${MAX_TIMEOUT_MINUTES} 分钟之间`
        });
    }
    for (const day of config.days) {
        if (!Number.isInteger(day) || day < 0 || day > 6) {
            issues.push({ field: 'days', message: `执行日必须是 0–6，收到 ${String(day)}` });
        }
    }
    if (config.days.length > 7) {
        issues.push({ field: 'days', message: '执行日不能超过 7 天' });
    }
    if (config.mode !== 'real' && config.mode !== 'dry') {
        issues.push({ field: 'mode', message: `未知模式：${String(config.mode)}` });
    }
    return issues;
}
/**
 * 把配置转成计划任务规格。
 *
 * 只在配置合法时调用；非法配置应当先由 `validateConfig` 拦下，
 * 这里不重复承担报错责任。
 */
export function toTaskSpec(config, options = {}) {
    const prefix = options.prefix ?? 'game-daily-';
    const days = [...new Set(config.days)].sort((a, b) => a - b);
    return {
        name: `${prefix}${config.game}`,
        time: config.time,
        days,
        executionLimitMinutes: config.timeoutMinutes + EXECUTION_LIMIT_MARGIN_MINUTES,
        mode: config.mode
    };
}
function parseTime(time) {
    const match = TIME_PATTERN.exec(time);
    if (match === null) {
        throw new Error(`时间格式不合法：${time}`);
    }
    return { hour: Number(match[1]), minute: Number(match[2]) };
}
function dayMatches(config, weekday) {
    return config.days.length === 0 || config.days.includes(weekday);
}
/**
 * 下一次该跑的时间点。
 *
 * 规则：
 * - 今天还没到点，且今天是执行日 → 今天
 * - 今天已过点，或今天不是执行日 → 往后找最近的执行日
 * - `catchUp` 打开时，今天已过点仍返回今天（表示「现在就该补跑」），
 *   由宿主决定是立即触发还是交给计划任务
 *
 * 找不到（比如 days 全是非法值）返回 null，让调用方自己处理。
 */
export function nextRunAt(config, now) {
    const { hour, minute } = parseTime(config.time);
    const base = new Date(now);
    for (let offset = 0; offset <= 8; offset += 1) {
        const candidate = new Date(base);
        candidate.setDate(base.getDate() + offset);
        candidate.setHours(hour, minute, 0, 0);
        if (!dayMatches(config, candidate.getDay()))
            continue;
        if (candidate.getTime() > now)
            return candidate.getTime();
        if (offset === 0 && config.catchUp)
            return candidate.getTime();
    }
    return null;
}
/** 该配置此刻是否处于「错过补跑」窗口。 */
export function isCatchUpDue(config, now) {
    if (!config.catchUp)
        return false;
    const { hour, minute } = parseTime(config.time);
    const today = new Date(now);
    today.setHours(hour, minute, 0, 0);
    if (!dayMatches(config, today.getDay()))
        return false;
    return now > today.getTime();
}
