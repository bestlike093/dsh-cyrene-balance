/**
 * B 站浏览与受控互动。
 *
 * 适用范围要分清楚：
 * - 默认配置下 B 站只读，不点赞、不评论、不投币、不转发。
 *   这是行为约束，不写在这个包里。
 * - 桌宠项目（本包）不套用那条约束。它可以按使用者需求自由配置，
 *   默认仍是纯只读，写操作要逐项开启。
 *
 * 分档方式：
 * - 读动作（搜索、打开、简介、评论、相关推荐）永远允许
 * - 写动作（评论、点赞、收藏、投币、转发）默认全部关闭，必须显式列进策略
 * - 投币额外受数量上限约束
 *
 * 这一层不碰网络：它负责「认出链接、判定动作是否被允许、把简介拆成可用的结论」。
 * 真正抓页面、发请求由宿主完成，结果按这里的结构喂回来。
 */
export type BilibiliReadAction = 'search' | 'open' | 'read-intro' | 'read-comments' | 'list-related';
/** 会对外产生副作用的动作。默认一个都不开。 */
export type BilibiliWriteAction = 'comment' | 'like' | 'favorite' | 'coin' | 'share';
export type BilibiliAction = BilibiliReadAction | BilibiliWriteAction;
/** 读动作集合。这些不需要开关，也不该被策略收紧。 */
export declare const READ_ONLY_ACTIONS: readonly BilibiliReadAction[];
/**
 * 写动作的元信息。
 *
 * 三项标记决定了开启后的提醒方式：
 * `reversible` 能否撤回、`costly` 是否消耗资产、`public` 是否对他人可见。
 * 三者都命中时（投币 + 公开），最该给二次确认。
 */
export interface WriteActionMeta {
    readonly id: BilibiliWriteAction;
    readonly label: string;
    readonly reversible: boolean;
    readonly costly: boolean;
    readonly public: boolean;
}
export declare const WRITE_ACTION_META: Readonly<Record<BilibiliWriteAction, WriteActionMeta>>;
export declare const WRITE_ACTIONS: readonly BilibiliWriteAction[];
/** B 站单次投币上限是 2 枚。这里再收一道，防止调用方传 10。 */
export declare const MAX_COIN_COUNT = 2;
export interface BilibiliPolicy {
    /** 已开启的写动作。空数组 = 纯只读。 */
    readonly enabledWrites: readonly BilibiliWriteAction[];
    /** 单次投币上限，默认 1，最大 2。 */
    readonly maxCoinsPerAction: number;
}
export declare const DEFAULT_BILIBILI_POLICY: BilibiliPolicy;
export declare class BilibiliReadOnlyError extends Error {
    readonly action: string;
    constructor(action: string);
}
/** 写动作被策略关掉了。和「未知动作」分开，方便上层提示「去设置里开」。 */
export declare class BilibiliWriteDisabledError extends Error {
    readonly action: BilibiliWriteAction;
    constructor(action: BilibiliWriteAction);
}
export declare class BilibiliCoinLimitError extends Error {
    readonly requested: number;
    readonly limit: number;
    constructor(requested: number, limit: number);
}
export declare function isReadOnlyAction(action: string): action is BilibiliReadAction;
export declare function isWriteAction(action: string): action is BilibiliWriteAction;
/** 只校验「是不是读动作」。写动作会抛，语义仍是「这不是读动作」。 */
export declare function assertReadOnly(action: string): asserts action is BilibiliReadAction;
/**
 * 动作总闸。
 *
 * 读动作直接放行；写动作必须出现在策略里。未知动作两头都不认，直接拒绝。
 */
export declare function assertActionAllowed(action: string, policy: BilibiliPolicy): void;
/** 投币前单独过一道数量检查。不传数量按 1 枚算。 */
export declare function assertCoinCount(count: number, policy: BilibiliPolicy): void;
/**
 * 这个动作要不要二次确认。
 *
 * 规则：不可撤回、或消耗资产、或对他人公开 —— 命中任一条就要。
 * 点赞和收藏两条都不沾，开了就能直接做。
 */
export declare function needsConfirmation(action: BilibiliWriteAction): boolean;
export interface VideoRef {
    readonly bvid: string;
}
/** 从整段 URL 或裸 BV 号里取出 bvid；取不到返回 null。 */
export declare function parseVideoRef(input: string): VideoRef | null;
export interface RepoRef {
    readonly owner: string;
    readonly repo: string;
    readonly url: string;
}
/**
 * 从简介里抠 GitHub 仓库。
 *
 * 这是这次真正用得上的能力：简介里塞一个仓库链接，
 * 人工看要滚三屏，程序只要一次正则。去掉尾部标点，避免把「。」吃进仓库名。
 */
export declare function extractRepoRefs(text: string): readonly RepoRef[];
export interface VideoDigest {
    readonly title: string;
    readonly bvid?: string;
    readonly repos: readonly RepoRef[];
    /** 作者自己承认的边界，通常是整篇简介里最有信息量的部分。 */
    readonly limits: readonly string[];
    readonly body: string;
}
export interface RawVideoMeta {
    readonly title: string;
    readonly url?: string;
    readonly description: string;
}
/**
 * 把一条视频的简介压成摘要。
 *
 * 不判断内容好不好，只做三件事：认出仓库、摘出边界、保留原文。
 * 判断留给上层，避免这里掺进主观结论。
 */
export declare function digestVideo(meta: RawVideoMeta): VideoDigest;
/** 摘要是否值得进一步看：抓到仓库，或作者自己写了边界。 */
export declare function isWorthFollowing(digest: VideoDigest): boolean;
