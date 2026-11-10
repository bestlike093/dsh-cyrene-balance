/**
 * 游戏本体的安装位置推导。
 *
 * 米哈游统一启动器（HYP）把各游戏放在 `<启动器根>/games/<目录名>`，
 * 注册表 `HKCU\Software\miHoYo\HYP\1_1\<biz>` 的 `GameInstallPath` 就是这条路径。
 *
 * 这里不读注册表、不碰文件系统：那一层由宿主做。本模块只负责把
 * 「游戏 → 可能的可执行文件路径」这段拼出来，宿主拿去做存在性检查。
 * 这样测试不需要真的装游戏，也不依赖 Windows。
 */
export const GAME_INSTALL_PROFILES = {
    genshin: {
        exe: 'YuanShen.exe',
        launcherDir: 'Genshin Impact Game',
        standaloneDirs: ['Genshin Impact', 'Genshin Impact Game']
    },
    starrail: {
        exe: 'StarRail.exe',
        launcherDir: 'Star Rail Game',
        standaloneDirs: ['Star Rail', 'Star Rail Game']
    },
    hi3: {
        exe: 'BH3.exe',
        launcherDir: 'Honkai Impact 3rd Game',
        standaloneDirs: ['Honkai Impact 3rd', 'Honkai Impact 3rd Game']
    },
    zzz: {
        exe: 'ZenlessZoneZero.exe',
        launcherDir: 'ZenlessZoneZero Game',
        standaloneDirs: ['ZenlessZoneZero', 'ZenlessZoneZero Game']
    }
};
/** 默认探测的盘符。只作为候选，不保证存在。 */
export const DEFAULT_DRIVES = ['C:', 'D:', 'E:'];
/**
 * 拼路径。
 *
 * 不用 `node:path`：`@pet/core` 要能进浏览器包，引 Node 内置模块会被
 * `exports/browser` 的依赖检查拦下。这里只处理反斜杠，Windows 够用。
 */
function join(...parts) {
    const cleaned = parts
        .map((part, index) => {
        if (index === 0)
            return part.replace(/[\\/]+$/, '');
        return part.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    })
        .filter((part) => part.length > 0);
    return cleaned.join('\\');
}
/** 统一启动器下的候选路径。没给根目录就返回空数组。 */
export function launcherCandidates(game, launcherRoot) {
    if (launcherRoot === undefined || launcherRoot.trim().length === 0)
        return [];
    const profile = GAME_INSTALL_PROFILES[game];
    return [join(launcherRoot, 'games', profile.launcherDir, profile.exe)];
}
/** 独立安装的候选路径，按「盘符 × 目录名」展开。 */
export function standaloneCandidates(game, drives = DEFAULT_DRIVES) {
    const profile = GAME_INSTALL_PROFILES[game];
    const candidates = [];
    for (const drive of drives) {
        for (const dir of profile.standaloneDirs) {
            candidates.push(join(drive, dir, profile.exe));
            candidates.push(join(drive, 'Program Files', dir, profile.exe));
            candidates.push(join(drive, 'Program Files (x86)', dir, profile.exe));
        }
    }
    return candidates;
}
/**
 * 全部候选，按命中概率排序：启动器路径在前，独立安装在后。
 *
 * 只做字符串推导，不判断存在。真正的判定交给 `pickExisting`。
 */
export function candidateExecutables(game, options = {}) {
    return [
        ...launcherCandidates(game, options.launcherRoot),
        ...standaloneCandidates(game, options.drives)
    ];
}
/**
 * 从候选里挑第一个存在的路径。
 *
 * `exists` 由宿主注入，保持这一层无 IO。挑不到返回 null，
 * 调用方据此标 `missing`，不要退化成「用第一个候选试试」。
 */
export function pickExisting(candidates, exists) {
    for (const candidate of candidates) {
        if (exists(candidate))
            return candidate;
    }
    return null;
}
