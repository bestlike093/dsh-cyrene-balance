/**
 * 日常执行前的「先启动游戏」决策。
 *
 * 这一层只回答三个问题：要不要启动、启动哪个 exe、启动后等多久。
 * 真正的 spawn 和等待由宿主做，测试不需要装游戏。
 *
 * 默认不启动：只有用户在排班里显式打开 `launchGame`，才会动游戏本体。
 * 演练模式永远不启动，哪怕配置里开了也一样。
 */
import { GAME_INSTALL_PROFILES, candidateExecutables, pickExisting } from './installPaths.mjs';
/** 启动到可以交给引擎之前，给游戏留的加载时间。 */
export const LAUNCH_GRACE_MS = 90_000;
/**
 * 决定这一轮要不要先拉起游戏。
 *
 * `exists` 由宿主注入（真实运行时是文件系统）。显式路径优先；
 * 没给路径才去盘符里找。找不到就明确 blocked，不退化成「随便试一个」。
 */
export function decideLaunch(input, exists) {
    if (input.mode === 'dry')
        return { action: 'skip', reason: 'dry' };
    if (input.launchGame !== true)
        return { action: 'skip', reason: 'disabled' };
    const explicit = typeof input.installPath === 'string' ? input.installPath.trim() : '';
    if (explicit !== '') {
        if (exists(explicit))
            return { action: 'launch', exe: explicit, graceMs: LAUNCH_GRACE_MS };
        return { action: 'blocked', reason: 'missing-install', tried: [explicit] };
    }
    const tried = candidateExecutables(input.game, input.candidates);
    const found = pickExisting(tried, exists);
    if (found === null)
        return { action: 'blocked', reason: 'missing-install', tried };
    return { action: 'launch', exe: found, graceMs: LAUNCH_GRACE_MS };
}
/** 游戏进程名，用来确认「确实起来了」。 */
export function gameProcessName(game) {
    return GAME_INSTALL_PROFILES[game].exe;
}
