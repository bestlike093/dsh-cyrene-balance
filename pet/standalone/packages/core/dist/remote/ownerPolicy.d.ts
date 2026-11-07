import type { SessionModeGate } from './sessionMode.js';
/** OneBot v11 消息里与本层相关的最小字段。 */
export interface IncomingMessage {
    readonly userId: string;
    readonly chatType: 'private' | 'group';
}
export interface OwnerPolicyOptions {
    /** 默认 true：只认私聊。设为 false 允许群聊提权。 */
    readonly privateOnly?: boolean;
}
/**
 * 主人判定。
 *
 * 两条同时满足才算：
 * 1. 私聊（可关，见 `privateOnly`）
 * 2. QQ 号在名单里
 *
 * 名单为空 = 谁都不是主人。这是 fail-closed：
 * 忘了配名单会退化成「只有群友模式」，不会误提权。
 *
 * 默认只认私聊：群成员可以顶着相同昵称说话，
 * 群聊里判断「这句话是不是主人的」没有可靠依据。
 * 关掉这个开关等于允许群聊提权，属于用户主动放宽。
 */
export declare class OwnerPolicy {
    private readonly owners;
    private readonly privateOnly;
    constructor(owners?: readonly string[], options?: OwnerPolicyOptions);
    isOwner(message: IncomingMessage): boolean;
    get ownerCount(): number;
    get requiresPrivateChat(): boolean;
}
/**
 * 把一条入站消息作用到会话闸门上。
 *
 * 只处理「提权」，不处理「降权」：
 * 群友说话不该把主人踢回 chat，否则主人在群里聊两句就丢了权限。
 * 降权只由空闲窗口负责。
 *
 * 返回 true 表示这条消息让模式变成了 closed-agent。
 */
export declare function applyIncomingMessage(gate: SessionModeGate, policy: OwnerPolicy, message: IncomingMessage): boolean;
