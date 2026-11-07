import type { IpcChannel } from './ipc.js';
export type PreloadInvoke = (channel: IpcChannel, payload?: unknown) => Promise<unknown>;
/**
 * 渲染层能看到的全部能力。
 * 每个方法固定绑定一个 channel，调用方无法传入任意通道名。
 */
export interface PreloadApi {
    ask(question: string, options?: readonly string[]): Promise<unknown>;
    approve(title: string, risk?: 'low' | 'medium' | 'high'): Promise<unknown>;
    reportTask(progress: {
        readonly id: string;
        readonly label: string;
        readonly ratio: number;
        readonly state: 'running' | 'done' | 'failed';
    }): void;
    getSettings(): Promise<unknown>;
    saveSettings(next: unknown): Promise<unknown>;
    setClickThrough(enabled: boolean): Promise<unknown>;
    setAlwaysOnTop(enabled: boolean): Promise<unknown>;
    move(x: number, y: number): Promise<unknown>;
    collectDiagnostics(): Promise<unknown>;
    /** 密钥只写不读：渲染层能设置与清除，回显只有掩码。 */
    setSecret(serviceId: string, value: string, field?: string): Promise<unknown>;
    getSecretMasked(serviceId: string, field?: string): Promise<unknown>;
    /** 只验证 QQ 凭据与网关可达性；不发送消息，也不回传 token。 */
    qqTest(): Promise<unknown>;
    /** QQ 通道运行状态：只读，不含凭据。 */
    qqStatus(): Promise<unknown>;
    /** 观察模式一键绑定：把最近一条入站消息的发送者写进主人名单。 */
    bindQqOwner(): Promise<unknown>;
    clearSecret(serviceId: string, field?: string): Promise<unknown>;
    diagnoseVault(): Promise<unknown>;
    /** 备份口令只在调用瞬间出现，不进入设置或本地存储。 */
    exportVault(password: string): Promise<unknown>;
    importVault(password: string): Promise<unknown>;
    /**
     * 聊天：历史留在主进程内存里，渲染层只发文本、拿结果。
     * 返回结构由主进程决定（ok / reason / reply），这里不假设成功。
     */
    sendChat(text: string): Promise<unknown>;
    getChatHistory(): Promise<unknown>;
    getChatStatus(): Promise<unknown>;
    clearChat(): Promise<unknown>;
    openChat(): Promise<unknown>;
    closeChat(): Promise<unknown>;
    /** 拍照：回 { ok, photo? }，photo 里只有路径、时间与字节数。 */
    takePhoto(): Promise<unknown>;
    /** 记忆：统计、分页读取、单条删除；清除仍是整份清除。 */
    getMemoryStats(): Promise<unknown>;
    getMemoryFacts(options?: {
        readonly scope?: string;
        readonly kind?: string;
    }): Promise<unknown>;
    removeMemoryFact(id: string): Promise<unknown>;
    updateMemoryFact(id: string, text: string): Promise<unknown>;
    /** 她记住的事整份导出 / 导入（JSONL）。 */
    exportMemoryFacts(options?: {
        readonly scope?: string;
        readonly includeArchived?: boolean;
    }): Promise<unknown>;
    importMemoryFacts(options?: {
        readonly scope?: string;
        readonly includeArchived?: boolean;
    }): Promise<unknown>;
    /** 今天的节目单：只读当前与接下来；手动顺延由主进程判断改不改。 */
    companionAgenda(): Promise<unknown>;
    rescheduleAgenda(minutes: number): Promise<unknown>;
    /** 观察台：整份只读快照；写动作只落在指定会话上。 */
    openInsight(): Promise<unknown>;
    getInsightSnapshot(options?: {
        readonly force?: boolean;
    }): Promise<unknown>;
    setInsightFavor(scope: string, value: number, note?: string): Promise<unknown>;
    adjustInsightFavor(scope: string, delta: number, note?: string): Promise<unknown>;
    lockInsightFavor(scope: string, locked: boolean): Promise<unknown>;
    resetInsightScope(scope: string): Promise<unknown>;
    deleteInsightMemory(id: string): Promise<unknown>;
    listMemory(options?: {
        readonly offset?: number;
        readonly limit?: number;
        readonly query?: string;
        readonly role?: string;
        readonly from?: string;
        readonly to?: string;
        readonly scope?: string;
        readonly layer?: string;
        readonly includeCold?: boolean;
    }): Promise<unknown>;
    deleteMemory(id: string): Promise<unknown>;
    exportMemory(options?: {
        readonly query?: string;
        readonly role?: string;
        readonly from?: string;
        readonly to?: string;
    }): Promise<unknown>;
    clearMemory(): Promise<unknown>;
    /** 启动前体检：只汇总本地状态，不发网络请求、不计费。 */
    getPreflight(): Promise<unknown>;
    /** 人格预览：主进程真实拼装结果。 */
    getPersonaPreview(): Promise<unknown>;
    /** 语音：自动/手动出声；失败回 ok:false，不抛。 */
    speakVoice(text: string, reason?: 'auto' | 'manual'): Promise<unknown>;
    /** 语音服务真实状态：只回 state，人话交给界面翻译。 */
    voiceStatus(): Promise<unknown>;
    /** 表情包待审核队列：只列文件，不入库。 */
    listStickerInbox(): Promise<unknown>;
    /** 表情库：内置素材 + 用户素材包，只读清单。 */
    listStickerLibrary(): Promise<unknown>;
    /** 用户点「入库」才会把待审核图移进素材包；name 为空时用原始 id。 */
    approveSticker(id: string, options?: {
        packId?: string;
        name?: string;
    }): Promise<unknown>;
    /** 丢弃待审核图，删文件不可撤销。 */
    rejectSticker(id: string): Promise<unknown>;
    /** 打开独立的表情包预览页。 */
    openStickerWindow(): Promise<unknown>;
    /** 把已入库的表情发到最近一次 QQ 会话；file 为素材包内相对路径。 */
    sendSticker(file: string): Promise<unknown>;
}
export declare const PRELOAD_METHODS: readonly (keyof PreloadApi)[];
export declare function createPreloadApi(invoke: PreloadInvoke): PreloadApi;
