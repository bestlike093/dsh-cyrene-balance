/**
 * chat:status 只做本地同步短路，远端可达性单独走 stale 分支。
 *
 * 短路三件：能力开关、聊天上下文、缓存 TTL。三者都不触发探活。
 * TTL 未命中时先返回旧快照（stale=true），再 fire-and-forget 探活并只回写缓存。
 * 这里只吐 chat.state.* 码，文案统一在 renderer/reason-text.js。
 */
export declare const CHAT_STATUS_TTL_MS = 10000;
export type ChatStatusState = 'disabled' | 'no-context' | 'ready' | 'stale' | 'unknown';
export interface ChatStatusValue {
    ok: true;
    state: ChatStatusState;
    stale: boolean;
    reason: string;
    checkedAt: number | null;
    provider: string | null;
    model: string | null;
    historyCount: number;
    busy: boolean;
}
export interface ChatStatusDeps {
    registerChannel: (channel: string, listener: (...args: unknown[]) => unknown) => void;
    getChatSnapshot: () => Record<string, unknown> | null;
    probeChat: () => Promise<Record<string, unknown>>;
    now: () => number;
    log: (...args: unknown[]) => void;
}
export declare function registerChatStatus(deps: ChatStatusDeps): void;
