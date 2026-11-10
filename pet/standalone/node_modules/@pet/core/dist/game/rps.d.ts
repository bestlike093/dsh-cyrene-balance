/** 猜拳。纯逻辑，无 IO，不依赖任何宿主能力。 */
export type RpsChoice = 'rock' | 'paper' | 'scissors';
/** 从用户视角看这一局的结果。 */
export type RpsOutcome = 'win' | 'lose' | 'draw';
export interface RpsRound {
    readonly user: RpsChoice;
    readonly pet: RpsChoice;
    readonly outcome: RpsOutcome;
}
export interface RpsStats {
    readonly rounds: number;
    readonly wins: number;
    readonly losses: number;
    readonly draws: number;
}
/**
 * 把用户说的话解析成出拳。
 *
 * 只做整串匹配：从「我想出石头」里猜出石头属于过度解读，
 * 猜错了比说「没听懂」更让人不快。
 */
export declare function parseRpsChoice(input: string): RpsChoice | undefined;
export declare function rpsOutcome(user: RpsChoice, pet: RpsChoice): RpsOutcome;
export interface RpsOptions {
    /** 随机源，返回 [0, 1)。测试注入固定值。 */
    readonly rng?: () => number;
}
/**
 * 猜拳对局。
 *
 * 记录累计战绩，供她按输赢换说法（「这局是人家让你」之类）。
 * 这里只维护内存状态；要不要跨会话保留，由宿主决定并调用 restore / stats。
 */
export declare class RockPaperScissors {
    private readonly rng;
    private rounds;
    private wins;
    private losses;
    private draws;
    constructor(options?: RpsOptions);
    play(user: RpsChoice): RpsRound;
    get stats(): RpsStats;
    reset(): void;
    /**
     * 从持久化数据恢复战绩。
     *
     * 只接受自洽的一份数据：四个值都是非负整数，且三者和等于总轮数。
     * 不自洽就整体拒绝，返回 false —— 宁可丢掉旧战绩，也不把坏数据带进下一局。
     */
    restore(stats: RpsStats): boolean;
    private pick;
}
