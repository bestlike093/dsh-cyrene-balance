/**
 * 游戏助手的纯规则层。
 *
 * 三件事：
 * 1. 任务目录：每个游戏有哪些日常、周常、工具任务，谁负责执行。
 * 2. 周常积分账本：周期积分有上限，货币战争与差分宇宙共享同一份奖励。
 * 3. 风险门：功能默认关闭，必须连续两次独立确认才能打开。
 *
 * 这一层不碰文件、不碰进程、不联网，方便单测，也方便宿主替换存储。
 */
export const ASSISTANT_GAME_IDS = [
    'starrail',
    'genshin',
    'zzz',
    'hi3'
];
/**
 * 任务目录。
 *
 * 星铁部分参考三月七小助手的日常/周常划分；积分规则按「货币战争与差分宇宙
 * 共享每周积分」建模，所以两项都标 sharesWeeklyCap。
 */
export const GAME_ASSISTANT_TASKS = [
    {
        id: 'starrail-daily-training',
        game: 'starrail',
        kind: 'daily',
        label: '每日实训',
        executor: 'march7th',
        note: '完成当天的实训目标，拿活跃度奖励。'
    },
    {
        id: 'starrail-trailblaze-power',
        game: 'starrail',
        kind: 'daily',
        label: '清体力',
        executor: 'march7th',
        note: '按预设副本消耗开拓力，避免溢出。'
    },
    {
        id: 'starrail-assignments',
        game: 'starrail',
        kind: 'daily',
        label: '委托',
        executor: 'march7th',
        note: '派出与收取委托奖励。'
    },
    {
        id: 'starrail-claim-rewards',
        game: 'starrail',
        kind: 'daily',
        label: '领取奖励',
        executor: 'march7th',
        note: '领取邮件、活动与每日奖励。'
    },
    {
        id: 'starrail-echo-of-war',
        game: 'starrail',
        kind: 'weekly',
        label: '历战余响',
        executor: 'march7th',
        note: '每周三次，按需选择首领。'
    },
    {
        id: 'starrail-simulated-universe',
        game: 'starrail',
        kind: 'weekly',
        label: '模拟宇宙',
        executor: 'march7th',
        note: '周常积分与差分宇宙、货币战争共享。'
    },
    {
        id: 'starrail-divergent-universe',
        game: 'starrail',
        kind: 'weekly',
        label: '差分宇宙',
        points: 18000,
        sharesWeeklyCap: true,
        executor: 'march7th',
        note: '完整通关任意难度可拿满 18000；与货币战争共享，不需要重复刷。'
    },
    {
        id: 'starrail-currency-war',
        game: 'starrail',
        kind: 'weekly',
        label: '货币战争',
        points: 18000,
        sharesWeeklyCap: true,
        executor: 'march7th',
        note: '完整通关标准或超频博弈可拿满 18000；未完整通关只有部分积分。'
    },
    {
        id: 'starrail-memory-of-chaos',
        game: 'starrail',
        kind: 'weekly',
        label: '混沌回忆',
        executor: 'march7th',
        note: '按队伍强度选择层数，量力而行。'
    },
    {
        id: 'starrail-pure-fiction',
        game: 'starrail',
        kind: 'weekly',
        label: '虚构叙事',
        executor: 'march7th',
        note: '按队伍强度选择层数，量力而行。'
    },
    {
        id: 'starrail-apocalyptic-shadow',
        game: 'starrail',
        kind: 'weekly',
        label: '末日幻影',
        executor: 'march7th',
        note: '按队伍强度选择层数，量力而行。'
    },
    {
        id: 'starrail-redemption-code',
        game: 'starrail',
        kind: 'tool',
        label: '兑换码',
        executor: 'march7th',
        note: '批量兑换公开兑换码，失败会逐条返回。'
    },
    {
        id: 'starrail-warp-export',
        game: 'starrail',
        kind: 'tool',
        label: '抽卡记录导出',
        executor: 'march7th',
        note: '导出 UIGF / SRGF 标准记录，方便第三方分析。'
    },
    {
        id: 'genshin-daily-commission',
        game: 'genshin',
        kind: 'daily',
        label: '每日委托',
        executor: 'bettergi',
        note: '完成四条委托并领取奖励。'
    },
    {
        id: 'genshin-resin',
        game: 'genshin',
        kind: 'daily',
        label: '清体力',
        executor: 'bettergi',
        note: '按预设副本消耗原粹树脂。'
    },
    {
        id: 'genshin-teapot',
        game: 'genshin',
        kind: 'daily',
        label: '尘歌壶',
        executor: 'bettergi',
        note: '收取洞天宝钱与好感。'
    },
    {
        id: 'genshin-abyss',
        game: 'genshin',
        kind: 'weekly',
        label: '深境螺旋',
        executor: 'bettergi',
        note: '按队伍强度选择层数。'
    }
];
export function findTask(taskId) {
    return GAME_ASSISTANT_TASKS.find((task) => task.id === taskId) ?? null;
}
export function tasksForGame(game) {
    return GAME_ASSISTANT_TASKS.filter((task) => task.game === game);
}
/* ------------------------------------------------------------------ */
/* 周常积分账本                                                        */
/* ------------------------------------------------------------------ */
/** 每周积分上限。货币战争与差分宇宙共享这一份。 */
export const WEEKLY_POINT_CAP = 18000;
/** 周常刷新：周一 04:00（与游戏内周一刷新对齐）。 */
export const WEEKLY_RESET_WEEKDAY = 1;
export const WEEKLY_RESET_HOUR = 4;
const WEEKLY_SOURCES = [
    'currency-war',
    'divergent-universe',
    'other'
];
const WEEKLY_DIFFICULTIES = [
    'standard',
    'overclock',
    'unknown'
];
function pad2(value) {
    return String(value).padStart(2, '0');
}
/**
 * 这一周属于哪个 weekKey。
 *
 * 以周一 04:00 为界：周一 03:59 仍算上一周，04:00 之后算新的一周。
 * 返回值是这一周周一的日期（YYYY-MM-DD），方便直接展示与比较。
 */
export function weeklyKeyOf(now) {
    const date = new Date(now);
    // 先减掉 4 小时，把「周一 00:00—03:59」归到上一周。
    date.setHours(date.getHours() - WEEKLY_RESET_HOUR);
    const weekday = date.getDay();
    let offset = weekday - WEEKLY_RESET_WEEKDAY;
    if (offset < 0)
        offset += 7;
    const monday = new Date(date);
    monday.setDate(date.getDate() - offset);
    return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
}
/** 本周期还剩多少毫秒，给「距离刷新」用。 */
export function nextWeeklyResetAt(now) {
    const date = new Date(now);
    const weekday = date.getDay();
    let offset = (WEEKLY_RESET_WEEKDAY - weekday + 7) % 7;
    const candidate = new Date(date);
    candidate.setDate(date.getDate() + offset);
    candidate.setHours(WEEKLY_RESET_HOUR, 0, 0, 0);
    if (candidate.getTime() <= now)
        candidate.setDate(candidate.getDate() + 7);
    return candidate.getTime();
}
/** 校验并补全一条记录；不合法时给出能直接展示的原因。 */
export function normalizeWeeklyEntry(input, now) {
    if (input === null || typeof input !== 'object') {
        return { ok: false, error: '记录必须是一个对象' };
    }
    const source = input;
    const id = typeof source.id === 'string' ? source.id.trim() : '';
    if (id === '')
        return { ok: false, error: '记录缺少 id' };
    const sourceValue = typeof source.source === 'string' ? source.source : 'other';
    if (!WEEKLY_SOURCES.includes(sourceValue)) {
        return { ok: false, error: `未知来源：${sourceValue}` };
    }
    const difficultyValue = typeof source.difficulty === 'string' ? source.difficulty : 'unknown';
    if (!WEEKLY_DIFFICULTIES.includes(difficultyValue)) {
        return { ok: false, error: `未知难度：${difficultyValue}` };
    }
    const points = Number(source.points);
    if (!Number.isFinite(points) || points < 0 || points > WEEKLY_POINT_CAP) {
        return { ok: false, error: `积分需在 0–${WEEKLY_POINT_CAP} 之间` };
    }
    if (!Number.isInteger(points)) {
        return { ok: false, error: '积分必须是整数' };
    }
    const completed = source.completed === true;
    const claimed = source.claimed === true;
    if (claimed && !completed) {
        return { ok: false, error: '未完整通关的记录不能标记为已领奖' };
    }
    if (claimed && points === 0) {
        return { ok: false, error: '0 积分的记录没有可领取的奖励' };
    }
    const recordedAt = Number(source.recordedAt);
    const at = Number.isFinite(recordedAt) && recordedAt > 0 ? recordedAt : now;
    return {
        ok: true,
        entry: {
            id,
            weekKey: weeklyKeyOf(at),
            source: sourceValue,
            difficulty: difficultyValue,
            completed,
            points,
            claimed,
            recordedAt: at
        }
    };
}
/**
 * 汇总某一周。
 *
 * 同一周内只累加当前 weekKey 的记录；旧周记录不参与本期上限，
 * 避免用户翻旧账时看到「本周已满」的错觉。
 */
export function summarizeWeek(entries, now) {
    const weekKey = weeklyKeyOf(now);
    const current = entries.filter((entry) => entry.weekKey === weekKey);
    const earned = current.reduce((sum, entry) => sum + entry.points, 0);
    const claimedPoints = current
        .filter((entry) => entry.claimed)
        .reduce((sum, entry) => sum + entry.points, 0);
    const capped = Math.min(earned, WEEKLY_POINT_CAP);
    return {
        weekKey,
        earned: capped,
        cap: WEEKLY_POINT_CAP,
        remaining: Math.max(0, WEEKLY_POINT_CAP - capped),
        full: capped >= WEEKLY_POINT_CAP,
        claimedPoints,
        unclaimedPoints: Math.max(0, capped - claimedPoints),
        entries: [...current].sort((a, b) => a.recordedAt - b.recordedAt)
    };
}
/** 给气泡/汇报用的一句话。 */
export function describeWeek(summary) {
    if (summary.full) {
        return summary.unclaimedPoints > 0
            ? `本周积分已经满了，还有 ${summary.unclaimedPoints} 分没领奖，记得去领。`
            : '本周积分已经满了，这周不用再刷啦。';
    }
    return `本周积分 ${summary.earned}/${summary.cap}，还差 ${summary.remaining} 分。`;
}
/* ------------------------------------------------------------------ */
/* 风险确认门                                                          */
/* ------------------------------------------------------------------ */
/** 两次确认都必须原样输入的短语。 */
export const RISK_CONFIRM_PHRASE = '我已知晓风险';
/** 首次打开时展示的三条风险。 */
export const RISK_DISCLOSURES = [
    '第三方自动化可能违反游戏用户协议，存在封号、回档或账号受限的风险。',
    '桌宠只负责提醒、编排和记录；真正操作游戏的是你另外安装的第三方工具，它不受本项目控制。',
    '默认只做演练。即使打开，也不会读取游戏内存、修改游戏文件或替你输入账号密码。'
];
export function emptyRiskGate() {
    return {
        enabled: false,
        confirmations: 0,
        firstConfirmedAt: null,
        enabledAt: null
    };
}
/**
 * 连续两次确认。
 *
 * 第一次只记下「读过了」，不打开；第二次才真正打开。
 * 两次都要求勾选 + 原样输入短语，任何一次不合格都保持原状态。
 * 第二次还要求 understandsRealRun，避免用户以为只是再看一遍说明。
 */
export function confirmRisk(state, input, now) {
    if (state.enabled) {
        return {
            ok: true,
            state,
            stage: 'enabled',
            message: '游戏助手已经打开。'
        };
    }
    if (input.acknowledged !== true) {
        return {
            ok: false,
            state,
            stage: 'rejected',
            message: '请先勾选「我已阅读以上风险」。'
        };
    }
    if (input.phrase.trim() !== RISK_CONFIRM_PHRASE) {
        return {
            ok: false,
            state,
            stage: 'rejected',
            message: `确认短语不正确，请原样输入「${RISK_CONFIRM_PHRASE}」。`
        };
    }
    if (state.confirmations === 0) {
        return {
            ok: true,
            state: {
                enabled: false,
                confirmations: 1,
                firstConfirmedAt: now,
                enabledAt: null
            },
            stage: 'first',
            message: '第一次确认已记录。还需要再确认一次，才会真正打开。'
        };
    }
    if (input.understandsRealRun !== true) {
        return {
            ok: false,
            state,
            stage: 'rejected',
            message: '请确认你理解「打开后第三方工具可能真的操作游戏」。'
        };
    }
    return {
        ok: true,
        state: {
            enabled: true,
            confirmations: 2,
            firstConfirmedAt: state.firstConfirmedAt ?? now,
            enabledAt: now
        },
        stage: 'enabled',
        message: '游戏助手已打开。真实执行仍建议先用演练预览。'
    };
}
/** 关闭后重新计数；下次打开必须重新走两次确认。 */
export function disableRisk(state, now) {
    return {
        enabled: false,
        confirmations: 0,
        firstConfirmedAt: state.firstConfirmedAt,
        enabledAt: null
    };
}
/** 从磁盘读回时做一次形状修复，避免旧文件或手改文件把门打开。 */
export function readRiskGate(value) {
    if (value === null || typeof value !== 'object')
        return emptyRiskGate();
    const source = value;
    const enabled = source.enabled === true && source.confirmations === 2;
    const confirmations = enabled
        ? 2
        : Number.isInteger(source.confirmations)
            ? Math.min(1, Math.max(0, Number(source.confirmations)))
            : 0;
    return {
        enabled,
        confirmations,
        firstConfirmedAt: typeof source.firstConfirmedAt === 'number' ? source.firstConfirmedAt : null,
        enabledAt: enabled && typeof source.enabledAt === 'number' ? source.enabledAt : null
    };
}
export function planTask(taskId) {
    const task = findTask(taskId);
    if (task === null)
        return null;
    const steps = [
        { label: '确认环境', detail: '检查执行器与游戏本体是否存在。' },
        { label: '生成计划', detail: `把「${task.label}」拆成可回滚的步骤。` },
        { label: '演练', detail: '只输出预览，不启动游戏或第三方工具。' },
        { label: '记录', detail: '把结果写进本地记录，等你自己核对积分与领奖。' }
    ];
    const warnings = [];
    if (task.kind === 'weekly') {
        warnings.push('周常积分与差分宇宙、货币战争共享，达到上限后不要重复刷。');
    }
    if (task.executor === 'manual') {
        warnings.push('这项需要你自己完成，桌宠只负责提醒和记录。');
    }
    return {
        taskId: task.id,
        label: task.label,
        executor: task.executor,
        mode: 'dry',
        steps,
        warnings
    };
}
