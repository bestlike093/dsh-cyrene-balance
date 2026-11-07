/** 猜拳。纯逻辑，无 IO，不依赖任何宿主能力。 */
const CHOICES = ['rock', 'paper', 'scissors'];
/** 随机源异常时的兜底出拳。 */
const DEFAULT_CHOICE = 'rock';
/** 谁赢谁：key 赢 value。 */
const BEATS = {
    rock: 'scissors',
    scissors: 'paper',
    paper: 'rock'
};
/** 中英文与常见别名。输入先小写、去空白。 */
const ALIASES = {
    rock: 'rock',
    石头: 'rock',
    paper: 'paper',
    布: 'paper',
    scissors: 'scissors',
    剪刀: 'scissors'
};
/**
 * 把用户说的话解析成出拳。
 *
 * 只做整串匹配：从「我想出石头」里猜出石头属于过度解读，
 * 猜错了比说「没听懂」更让人不快。
 */
export function parseRpsChoice(input) {
    return ALIASES[input.trim().toLowerCase()];
}
export function rpsOutcome(user, pet) {
    if (user === pet)
        return 'draw';
    return BEATS[user] === pet ? 'win' : 'lose';
}
/**
 * 猜拳对局。
 *
 * 记录累计战绩，供她按输赢换说法（「这局是人家让你」之类）。
 * 这里只维护内存状态；要不要跨会话保留，由宿主决定并调用 restore / stats。
 */
export class RockPaperScissors {
    rng;
    rounds = 0;
    wins = 0;
    losses = 0;
    draws = 0;
    constructor(options = {}) {
        this.rng = options.rng ?? Math.random;
    }
    play(user) {
        const pet = this.pick();
        const outcome = rpsOutcome(user, pet);
        this.rounds += 1;
        if (outcome === 'win')
            this.wins += 1;
        else if (outcome === 'lose')
            this.losses += 1;
        else
            this.draws += 1;
        return { user, pet, outcome };
    }
    get stats() {
        return {
            rounds: this.rounds,
            wins: this.wins,
            losses: this.losses,
            draws: this.draws
        };
    }
    reset() {
        this.rounds = 0;
        this.wins = 0;
        this.losses = 0;
        this.draws = 0;
    }
    /**
     * 从持久化数据恢复战绩。
     *
     * 只接受自洽的一份数据：四个值都是非负整数，且三者和等于总轮数。
     * 不自洽就整体拒绝，返回 false —— 宁可丢掉旧战绩，也不把坏数据带进下一局。
     */
    restore(stats) {
        const values = [stats.rounds, stats.wins, stats.losses, stats.draws];
        if (!values.every((value) => Number.isInteger(value) && value >= 0))
            return false;
        if (stats.wins + stats.losses + stats.draws !== stats.rounds)
            return false;
        this.rounds = stats.rounds;
        this.wins = stats.wins;
        this.losses = stats.losses;
        this.draws = stats.draws;
        return true;
    }
    pick() {
        const value = this.rng();
        // 非有限值或越界时退回固定项，避免 `CHOICES[NaN]` 得到 undefined。
        if (!Number.isFinite(value) || value < 0 || value >= 1)
            return DEFAULT_CHOICE;
        return CHOICES[Math.floor(value * CHOICES.length)] ?? DEFAULT_CHOICE;
    }
}
