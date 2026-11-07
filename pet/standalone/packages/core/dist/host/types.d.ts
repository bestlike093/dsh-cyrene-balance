/**
 * 运行时契约。
 *
 * 和 `@pet/shared` 的 `HostAdapter` 是两件事，刻意分开命名：
 *
 * - `HostAdapter`：宿主**替我决策**——问用户、审批、报进度。
 * - `PetRuntime`：宿主**替我供料**——会话、通知、语音、抓帧、输入、存储。
 *
 * dsh 是一种实现，独立进程是另一种，QQ / 微信适配器也可以是。
 * 所有可选能力都配一个布尔位：core 能在不发起调用的前提下判断，
 * 而不是「先试一次失败再降级」——那会把异常当流程。
 */
export type RuntimeId = 'dsh' | 'standalone' | (string & {});
export interface RuntimeCapabilities {
    readonly session: boolean;
    readonly notify: boolean;
    readonly speech: boolean;
    readonly capture: boolean;
    readonly input: boolean;
    readonly storage: boolean;
}
export type MessageRole = 'user' | 'pet' | 'system';
export interface PetMessage {
    readonly role: MessageRole;
    readonly text: string;
    readonly at: number;
}
export interface SessionRef {
    readonly id: string;
}
export interface OpenSessionInput {
    /** 会话模式：日常陪伴 / 具体任务 / 游戏 / 语音。 */
    readonly mode: 'daily' | 'task' | 'game' | 'voice';
    /** 复用已有会话；省略则新建。 */
    readonly existing?: SessionRef;
    readonly title?: string;
}
export type NoticeLevel = 'info' | 'warn' | 'error';
export interface PetNotice {
    readonly title: string;
    readonly body: string;
    readonly level?: NoticeLevel;
}
export interface SpeakOptions {
    readonly voice?: string;
    /** 0.5–2.0，运行时实现可钳制。 */
    readonly rate?: number;
}
export interface Frame {
    readonly width: number;
    readonly height: number;
    /** RGBA 或运行时自定义的原始像素。 */
    readonly data: Uint8Array;
    readonly at: number;
}
export interface CaptureTarget {
    /** 窗口标题或进程名，运行时自行解析。 */
    readonly window?: string;
    readonly region?: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
    };
}
export interface Point {
    readonly x: number;
    readonly y: number;
}
/** 运行时能力不足时抛出，调用方据此降级而不是崩溃。 */
export declare class RuntimeCapabilityError extends Error {
    readonly capability: keyof RuntimeCapabilities;
    constructor(capability: keyof RuntimeCapabilities, runtimeId: string);
}
export interface PetRuntime {
    readonly id: RuntimeId;
    readonly capabilities: RuntimeCapabilities;
    /** 统一时钟。测试里注入假的，避免依赖真实时间。 */
    now(): number;
    openSession(input: OpenSessionInput): Promise<SessionRef>;
    appendMessage(session: SessionRef, message: PetMessage): Promise<void>;
    notify(notice: PetNotice): Promise<void>;
    speak(text: string, options?: SpeakOptions): Promise<void>;
    capture?(target?: CaptureTarget): Promise<Frame>;
    click?(point: Point): Promise<void>;
    readState<T>(key: string): Promise<T | null>;
    writeState<T>(key: string, value: T): Promise<void>;
}
/** 调用可选能力前的统一检查。 */
export declare function requireCapability(runtime: PetRuntime, capability: keyof RuntimeCapabilities): void;
/**
 * 最容易出错的四处，先固化成小工具。
 *
 * 这些组合在睡眠、游戏、语音三条线上都会反复出现，散在各处写会不一致。
 */
export declare const runtimeOps: {
    trySpeak(runtime: PetRuntime, text: string, options?: SpeakOptions): Promise<boolean>;
    tryNotify(runtime: PetRuntime, notice: PetNotice): Promise<boolean>;
    /** 读状态但没装存储时返回 null，调用方不要因此认为「状态是空的」。 */
    readStateOrNull<T>(runtime: PetRuntime, key: string): Promise<T | null>;
    captureOrNull(runtime: PetRuntime, target?: CaptureTarget): Promise<Frame | null>;
};
