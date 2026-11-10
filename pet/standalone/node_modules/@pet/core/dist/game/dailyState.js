/**
 * 多游戏日常状态。
 *
 * 一份 state.json 里放四个游戏各自的排班，而不是一条全局配置。
 * 这样切游戏不会把上一个游戏的设置覆盖掉，也方便「只开原神、星铁保持演练」。
 *
 * 读盘一律走 `normalizeDailyState`：文件缺失、被截断、手改坏了、旧版本迁移，
 * 都回到「全部关闭 + 演练」，不阻断设置页，也不会因为手改 JSON 就把真实执行打开。
 */
import { DEFAULT_TIMEOUT_MINUTES, GAME_IDS, isValidTime, validateConfig } from './dailySchedule.js';
export const DAILY_STATE_VERSION = 1;
/** 默认的每日触发时间。四个游戏错开一点，避免同一分钟抢窗口。 */
export const DEFAULT_TIMES = {
    genshin: '04:00',
    hi3: '05:00',
    starrail: '05:30',
    zzz: '06:00'
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readDays(input) {
    if (!Array.isArray(input))
        return [];
    return [...new Set(input.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
}
/** 单个游戏的默认值。默认关闭、演练，任何新建条目都从这里开始。 */
export function defaultGameConfig(game) {
    return {
        game,
        enabled: false,
        time: DEFAULT_TIMES[game],
        days: [],
        timeoutMinutes: DEFAULT_TIMEOUT_MINUTES[game],
        mode: 'dry',
        catchUp: false,
        reportSession: false,
        launchGame: false
    };
}
export function defaultDailyState() {
    return {
        version: DAILY_STATE_VERSION,
        games: {
            genshin: defaultGameConfig('genshin'),
            hi3: defaultGameConfig('hi3'),
            starrail: defaultGameConfig('starrail'),
            zzz: defaultGameConfig('zzz')
        },
        updatedAt: null
    };
}
/**
 * 读盘时的形状修复。
 *
 * 这里刻意不报错：设置页要能打开，用户才有机会改回来。
 * 非法值一律退回默认值，而不是把整个文件判死。
 */
export function normalizeGameConfig(game, input) {
    const base = defaultGameConfig(game);
    if (!isRecord(input))
        return base;
    const timeout = Number(input.timeoutMinutes);
    const mode = input.mode === 'real' ? 'real' : 'dry';
    const rawTime = typeof input.time === 'string' ? input.time.trim() : '';
    const config = {
        game,
        enabled: input.enabled === true,
        time: isValidTime(rawTime) ? rawTime : base.time,
        days: readDays(input.days),
        timeoutMinutes: Number.isInteger(timeout) && timeout >= 5 && timeout <= 180 ? timeout : base.timeoutMinutes,
        mode,
        catchUp: input.catchUp === true,
        reportSession: input.reportSession === true,
        launchGame: input.launchGame === true
    };
    if (typeof input.installPath === 'string' && input.installPath.trim() !== '') {
        return { ...config, installPath: input.installPath.trim() };
    }
    if (typeof input.gamePath === 'string' && input.gamePath.trim() !== '') {
        return { ...config, gamePath: input.gamePath.trim() };
    }
    return config;
}
/**
 * 读盘入口。
 *
 * 兼容一个更早的单配置形状（顶层直接是 `{ game, time, ... }`）：
 * 把它当成那一款游戏的配置，其余游戏保持默认，避免老用户升级后设置全丢。
 */
export function normalizeDailyState(input) {
    const base = defaultDailyState();
    if (!isRecord(input))
        return base;
    if (isRecord(input.games)) {
        const games = {};
        for (const game of GAME_IDS) {
            games[game] = normalizeGameConfig(game, input.games[game]);
        }
        return {
            version: DAILY_STATE_VERSION,
            games,
            updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : null
        };
    }
    if (typeof input.game === 'string' && GAME_IDS.includes(input.game)) {
        const game = input.game;
        const games = {};
        for (const id of GAME_IDS)
            games[id] = base.games[id];
        games[game] = normalizeGameConfig(game, input);
        return {
            version: DAILY_STATE_VERSION,
            games,
            updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : null
        };
    }
    return base;
}
/**
 * 更新一个游戏的配置。
 *
 * 先把 patch 合进候选值，再用 `validateConfig` 校验，通过了才写入 state。
 * 不合法时原样返回旧 state，让界面可以只标红不丢输入。
 */
export function updateGameConfig(state, game, patch, now) {
    const current = state.games[game] ?? defaultGameConfig(game);
    const days = [...new Set(patch.days ?? current.days)].sort((a, b) => a - b);
    const base = {
        game,
        enabled: patch.enabled ?? current.enabled,
        time: patch.time ?? current.time,
        days,
        timeoutMinutes: patch.timeoutMinutes ?? current.timeoutMinutes,
        mode: patch.mode ?? current.mode,
        catchUp: patch.catchUp ?? current.catchUp,
        reportSession: patch.reportSession ?? current.reportSession,
        launchGame: patch.launchGame ?? current.launchGame
    };
    // 'gamePath' in patch 时允许显式传空字符串清空。
    const nextPath = 'gamePath' in patch ? patch.gamePath?.trim() : current.gamePath;
    const nextInstall = 'installPath' in patch ? patch.installPath?.trim() : current.installPath;
    const candidate = {
        ...base,
        ...(nextPath !== undefined && nextPath !== '' ? { gamePath: nextPath } : {}),
        ...(nextInstall !== undefined && nextInstall !== '' ? { installPath: nextInstall } : {})
    };
    const issues = validateConfig(candidate);
    if (issues.length > 0) {
        return { ok: false, state, issues };
    }
    const games = { ...state.games, [game]: candidate };
    return {
        ok: true,
        state: { ...state, games, updatedAt: now },
        issues: []
    };
}
/** 已打开的游戏，按触发时间排序。 */
export function enabledGames(state) {
    return GAME_IDS
        .map((game) => state.games[game])
        .filter((config) => config.enabled)
        .sort((a, b) => a.time.localeCompare(b.time));
}
export function summarizeDailyState(state) {
    const enabled = enabledGames(state);
    const real = enabled.filter((config) => config.mode === 'real').length;
    return {
        enabled: enabled.length,
        total: GAME_IDS.length,
        real,
        dry: enabled.length - real,
        games: enabled
    };
}
/** 给气泡/设置页顶部的一句话。 */
export function describeDailyState(state) {
    const summary = summarizeDailyState(state);
    if (summary.enabled === 0)
        return '四个游戏都还关着，谁也不会自己动。';
    const names = {
        genshin: '原神',
        hi3: '崩坏3',
        starrail: '星穹铁道',
        zzz: '绝区零'
    };
    const list = summary.games
        .map((config) => `${names[config.game]} ${config.time}${config.mode === 'dry' ? '（演练）' : ''}`)
        .join('、');
    return `已开 ${summary.enabled} 个：${list}。`;
}
