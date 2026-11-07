/**
 * 主动开口的机会账本：跨重启记住「说过几次、上次什么时候、对方回没回」。
 *
 * 借鉴 AstrBot 陪伴插件的「机会生命周期」：
 * 一次主动开口从候选变成一条有记录的机会，说了什么方向、结果如何、
 * 对方后来有没有接话，都留下来。下一拍据此决定还要不要开口，
 * 而不是只看一个进程内的计时器。
 *
 * 纯逻辑：时间从参数进来，不读文件、不碰网络，可从 `@pet/core/browser` 导出。
 */
export type OpeningKind = 'absence' | 'loop' | 'agenda' | 'auto';
export type OpeningOutcome = 'spoken' | 'failed';
/** 一条已经发生过的机会；只记方向，不存台词。 */
export interface OpeningRecord {
    readonly id: string;
    readonly kind: OpeningKind;
    readonly reason: string;
    /** 同方向去重用的指纹；agenda 用段 id，其余用 kind + reason。 */
    readonly fingerprint: string;
    readonly at: number;
    readonly outcome: OpeningOutcome;
}
export interface OpeningLedgerSnapshot {
    readonly version: 1;
    /** 账本当前归属的本地日期。 */
    readonly day: string;
    readonly spokenToday: number;
    readonly lastSpokenAt: number;
    /** 连续开口、对方一直没接话的次数。 */
    readonly unansweredStreak: number;
    readonly records: readonly OpeningRecord[];
}
/** 此刻的开口分寸，交给调度器决定下一次最早什么时候可以再试。 */
export interface OpeningPacing {
    readonly day: string;
    readonly spokenToday: number;
    readonly dailyLimit: number;
    readonly lastSpokenAt: number;
    readonly unansweredStreak: number;
    /** 未回应降速倍率：1 / 1.5 / 2 / 2.5。 */
    readonly intervalScale: number;
    /** 好感分层倍率：亲近的人更短，疏远的人更长。 */
    readonly favorScale: number;
    readonly minutesSinceLast: number | null;
    readonly blockedReason: 'daily_limit' | null;
}
export interface OpeningGate {
    readonly allowed: boolean;
    readonly reason: 'daily_limit' | 'duplicate' | null;
}
export interface OpeningLedgerOptions {
    readonly now?: () => number;
    /** 每天最多主动开口几次。 */
    readonly dailyLimit?: number;
    /** 同一方向的重复窗口；窗口内不再说第二遍。 */
    readonly duplicateWindowMs?: number;
    /** 当前好感度（0-100）；缺省按 50 处理，不改变原有节奏。 */
    readonly favor?: () => number;
}
export declare const DEFAULT_DAILY_LIMIT = 8;
export declare const DEFAULT_DUPLICATE_WINDOW_MS: number;
export declare class OpeningLedger {
    private readonly now;
    private readonly dailyLimit;
    private readonly duplicateWindowMs;
    private readonly favor;
    private day;
    private spokenToday;
    private lastSpokenAt;
    private unansweredStreak;
    private records;
    private sequence;
    constructor(options?: OpeningLedgerOptions);
    /** 好感分层后的当日上限：再疏远也至少留一次，别把话说死。 */
    private effectiveDailyLimit;
    /** 跨天只重置「今天说了几次」，上次开口时间保留，跨午夜的冷却仍然有效。 */
    private roll;
    pacing(at?: number): OpeningPacing;
    /**
     * 这一刻能不能开口。
     *
     * agenda 段由节目单自己的认领记录去重，这里不按指纹拦，
     * 否则「工作」这种每天都会出现的段会被跨天误伤。
     */
    allows(kind: OpeningKind, reason: string, fingerprint: string, at?: number): OpeningGate;
    /**
     * QQ 群插话的共享闸门：只查「今天总共说了几次」和同方向重复，
     * 不看桌面端的冷却，也不改未回应计数。
     *
     * 群消息节奏和桌面完全不同：把群里的沉默算成「她不回我」，
     * 会让桌面端正常开口被一起拖慢。共享的只是日预算这一层。
     */
    allowsShared(fingerprint: string, at?: number): OpeningGate;
    /** QQ 群那边真的说出去了：只计入今天的总次数，不动桌面端的冷却与未回应节奏。 */
    spokenShared(fingerprint: string, at?: number): OpeningRecord;
    /** 一句话真的说出去了。失败的那次不要调用，下一拍还有机会。 */
    spoken(kind: OpeningKind, reason: string, fingerprint: string, at?: number): OpeningRecord;
    /** 生成失败或没有可说的话：留下证据，但不计入今天、也不进入冷却。 */
    failed(kind: OpeningKind, reason: string, fingerprint: string, at?: number): OpeningRecord;
    /** 用户真的接话了。连续未回应计数清零，节奏回到正常。 */
    userReplied(): void;
    /**
     * 给主动提示词的一行节奏提醒。
     *
     * 只在今天已经开口过时才给，避免第一句话就被「你今天说了几次」带跑。
     */
    describeForPrompt(at?: number): string;
    private minutesSinceLast;
    private push;
    toJSON(): OpeningLedgerSnapshot;
    /** 任意一层坏掉都只回到空账本，不让主动开口整体失效。 */
    static fromJSON(raw: unknown, options?: OpeningLedgerOptions): OpeningLedger;
}
