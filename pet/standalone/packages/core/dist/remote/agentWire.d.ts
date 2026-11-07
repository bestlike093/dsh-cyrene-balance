import type { SessionMode, SessionModeGate } from './sessionMode.js';
import type { IncomingMessage, OwnerPolicy } from './ownerPolicy.js';
/**
 * 消息装配点。
 *
 * 把「谁在说话 → 她此刻能做什么 → 她说什么 → 发回去」串成一条链。
 * 这一层只做编排：不碰网络、不碰 dsh、不自己起定时器。
 * 谁把消息喂进来、谁把回复送出去，都由调用方决定。
 */
export interface WireMessage extends IncomingMessage {
    readonly text: string;
    readonly at: number;
}
export interface AgentTurn {
    readonly mode: SessionMode;
    readonly text: string;
    readonly isOwner: boolean;
}
export interface AgentReply {
    readonly text: string;
}
/** 跑一轮 agent。由宿主实现，core 只约定形状。 */
export interface AgentRunner {
    run(turn: AgentTurn): Promise<AgentReply>;
}
export interface AgentWireOptions {
    readonly gate: SessionModeGate;
    readonly policy: OwnerPolicy;
    readonly runner: AgentRunner;
    /** 把回复送回来源通道。 */
    readonly reply: (text: string) => Promise<void>;
    /**
     * agent 失败时给用户看的话。
     * 默认不暴露内部错误：把堆栈甩进群里既不安全也没用。
     */
    readonly onError?: (error: unknown, message: WireMessage) => string;
}
export declare const DEFAULT_ERROR_REPLY = "\u521A\u521A\u6CA1\u60F3\u660E\u767D\uFF0C\u7B49\u4E0B\u518D\u8BD5\u4E00\u6B21\u597D\u4E0D\u597D\uFF1F";
export declare class AgentWire {
    private readonly gate;
    private readonly policy;
    private readonly runner;
    private readonly reply;
    private readonly onError;
    constructor(options: AgentWireOptions);
    /**
     * 处理一条消息。
     *
     * 顺序是刻意的：先按身份提权，再检查空闲降权。
     * 反过来的话，主人隔了五分钟开口，会先被降权再提权，
     * 中途那一瞬间的工具面是错的，而且审计里会多出一条假的切换。
     */
    handle(message: WireMessage): Promise<AgentReply>;
    /** 宿主定时调用，只做空闲降权。返回 true 表示这一轮收权了。 */
    tick(now?: number): boolean;
}
