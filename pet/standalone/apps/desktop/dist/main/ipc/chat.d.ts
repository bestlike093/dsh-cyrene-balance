type AnyRecord = Record<string, any>;
/**
 * 聊天通道：send / clear / open / export。
 *
 * 通道层只做透传与编排，不碰文件格式、不发事件、不更新索引。
 * 落盘由 `chatService` 内部通过注入的 `persistTurn` / `persistClear` 完成。
 * clear 的返回态统一成 `{ ok, reason? }`：失败时 reason 一定是非空字符串，
 * 不把 undefined 丢给渲染层去兜底成「出了点状况（undefined）」。
 *
 * open 保持老语义：只负责开窗并返回 true，没有会话 id，也没有「找不到会话」的错误分支。
 * export 保持老语义：空历史返回 CHAT_EMPTY；取消返回 canceled；成功回绝对路径与条数。
 *
 * 已知取舍（既有行为，迁移时未改动）：user / assistant 两条 turn 分别落盘，
 * 第二条失败会留下「有问无答」的半条记录。要修成事务式写入需要改 chat.mjs
 * 的持久化契约，不在本次迁移范围内。
 */
export type ChatClearResult = {
    ok: boolean;
    reason?: string;
};
type ChatClearRaw = ChatClearResult | boolean;
export interface ChatTurn {
    role: string;
    content: string;
}
export interface ChatChannelDeps {
    registerChannel: (channel: string, listener: (...args: any[]) => unknown) => void;
    getChatService: () => {
        send: (payload: AnyRecord) => Promise<unknown>;
        clear: () => ChatClearRaw | Promise<ChatClearRaw>;
        history: () => ChatTurn[];
    };
    openChatWindow: () => void;
    /**
     * 这句话在要照片时先真拍一张。
     * 返回 null 表示不是要照片；返回结果里只有渲染层能直接用的地址，没有图像字节。
     */
    takePhotoIfAsked?: (text: string) => Promise<{
        ok: boolean;
        reason?: string;
        photo?: {
            url: string;
            path: string;
            at: string;
        };
    } | null>;
    showSaveDialog: (options: AnyRecord) => Promise<{
        canceled: boolean;
        filePath?: string;
    }>;
    getDocumentsPath: () => string;
    pathJoin: (...parts: string[]) => string;
    fs: {
        writeFile: (file: string, data: string, encoding?: string) => Promise<void>;
        restrictPermissions: (file: string) => Promise<void>;
    };
    log: (...args: any[]) => void;
}
export declare function registerChatChannels(deps: ChatChannelDeps): void;
export {};
