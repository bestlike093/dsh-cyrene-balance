/**
 * 运行前的依赖体检。
 *
 * 来自 dsh-game-daily 的做法：跑之前先体检，缺东西就直说缺什么，
 * 而不是启动之后在日志里翻半小时找不到原因。
 *
 * 这一层只建模「体检结果」，不自己探测文件系统——探测由宿主做，
 * 结果按这里的三态喂进来。这样测试不需要真的装游戏。
 */
/**
 * 汇总。
 *
 * `unknown` 也算阻塞：探测不了就不能假装它没问题。
 * 这条容易被写成「未知就当通过」，但在「替你操作游戏」这件事上，
 * 未知意味着可能在你不在的时候点错东西。
 */
export function summarizeDependencies(items) {
    const blocking = items.filter((item) => item.required && (item.status === 'missing' || item.status === 'unknown'));
    const warnings = items.filter((item) => item.status === 'warn' || (item.status === 'missing' && !item.required));
    return {
        items: [...items],
        blocking,
        warnings,
        canRun: blocking.length === 0
    };
}
/** 压成一句话，给气泡或汇报用。 */
export function describeDependencies(report) {
    if (report.canRun && report.warnings.length === 0)
        return '环境齐了，可以开始';
    if (!report.canRun) {
        const names = report.blocking.map((item) => item.label).join('、');
        return `还差 ${report.blocking.length} 项：${names}`;
    }
    const names = report.warnings.map((item) => item.label).join('、');
    return `能跑，但有 ${report.warnings.length} 项要注意：${names}`;
}
/**
 * 已知的几项，按「缺了会怎样」排序。
 *
 * 这套清单是照着本机实测的坑写的，不是通用模板：
 * 没装 BetterGI 原神跑不起来；游戏路径没配就只能演练。
 */
export const KNOWN_DEPENDENCIES = {
    bettergi: {
        id: 'bettergi',
        label: 'BetterGI',
        required: true,
        fix: '安装 BetterGI 并在设置里指向 BetterGI.exe'
    },
    gamePath: {
        id: 'game-path',
        label: '游戏本体路径',
        required: true,
        fix: '在设置里填游戏安装目录'
    },
    dshCli: {
        id: 'dsh-cli',
        label: 'dsh 命令行',
        required: true,
        fix: '确认 dsh 在 PATH 里，或填绝对路径'
    },
    planTaskPermission: {
        id: 'plan-task-permission',
        label: '计划任务权限',
        required: false,
        fix: '首次注册计划任务需要一次提权确认'
    },
    reportDir: {
        id: 'report-dir',
        label: '报告目录可写',
        required: true,
        fix: '检查数据目录权限'
    }
};
