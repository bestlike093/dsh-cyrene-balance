/**
 * 运行前的依赖体检。
 *
 * 来自 dsh-game-daily 的做法：跑之前先体检，缺东西就直说缺什么，
 * 而不是启动之后在日志里翻半小时找不到原因。
 *
 * 这一层只建模「体检结果」，不自己探测文件系统——探测由宿主做，
 * 结果按这里的三态喂进来。这样测试不需要真的装游戏。
 */
export type DependencyStatus = 'ok' | 'missing' | 'warn' | 'unknown';
export interface DependencyItem {
    readonly id: string;
    readonly label: string;
    /** 缺了它就不能跑。false 表示只是建议项。 */
    readonly required: boolean;
    readonly status: DependencyStatus;
    readonly detail?: string;
    /** 给用户看的修复动作，一句话。 */
    readonly fix?: string;
}
export interface DependencyReport {
    readonly items: readonly DependencyItem[];
    readonly blocking: readonly DependencyItem[];
    readonly warnings: readonly DependencyItem[];
    readonly canRun: boolean;
}
/**
 * 汇总。
 *
 * `unknown` 也算阻塞：探测不了就不能假装它没问题。
 * 这条容易被写成「未知就当通过」，但在「替你操作游戏」这件事上，
 * 未知意味着可能在你不在的时候点错东西。
 */
export declare function summarizeDependencies(items: readonly DependencyItem[]): DependencyReport;
/** 压成一句话，给气泡或汇报用。 */
export declare function describeDependencies(report: DependencyReport): string;
/**
 * 已知的几项，按「缺了会怎样」排序。
 *
 * 这套清单是照着本机实测的坑写的，不是通用模板：
 * 没装 BetterGI 原神跑不起来；游戏路径没配就只能演练。
 */
export declare const KNOWN_DEPENDENCIES: {
    readonly bettergi: {
        readonly id: "bettergi";
        readonly label: "BetterGI";
        readonly required: true;
        readonly fix: "安装 BetterGI 并在设置里指向 BetterGI.exe";
    };
    readonly gamePath: {
        readonly id: "game-path";
        readonly label: "游戏本体路径";
        readonly required: true;
        readonly fix: "在设置里填游戏安装目录";
    };
    readonly dshCli: {
        readonly id: "dsh-cli";
        readonly label: "dsh 命令行";
        readonly required: true;
        readonly fix: "确认 dsh 在 PATH 里，或填绝对路径";
    };
    readonly planTaskPermission: {
        readonly id: "plan-task-permission";
        readonly label: "计划任务权限";
        readonly required: false;
        readonly fix: "首次注册计划任务需要一次提权确认";
    };
    readonly reportDir: {
        readonly id: "report-dir";
        readonly label: "报告目录可写";
        readonly required: true;
        readonly fix: "检查数据目录权限";
    };
};
