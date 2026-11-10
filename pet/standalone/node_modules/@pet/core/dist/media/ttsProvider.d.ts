/**
 * TTS provider 抽象。
 *
 * `voice.ts` 只管「一次合成请求长什么样」，这里管「谁真的把声音拿回来」。
 * 两种跑法共用一套口径：
 *
 * - 云端：按字符计费，Key 独立存放，不进日志、不进诊断
 * - 本地：走本机端口（IndexTTS / GPT-SoVITS 这类），不计费，端口可改
 *
 * provider 的输出是 `TtsAudio`，不是 `VoiceMessage`。
 * `VoiceMessage` 带 60 秒 / 2 MiB 的社交平台闸门，桌面播放不该被那条线卡住。
 */
import { type AudioFormat, type TtsProtocol } from './voice.js';
export type TtsProviderKind = 'cloud' | 'local';
/** 合成出来的一段音频。时长是估算值，只用于展示和排队。 */
export interface TtsAudio {
    readonly audio: Uint8Array;
    readonly format: AudioFormat;
    readonly durationSec: number;
}
export interface TtsSynthesisInput {
    readonly text: string;
    readonly voice?: string;
    readonly speed?: number;
    readonly format?: AudioFormat;
}
export interface TtsProvider {
    readonly id: string;
    readonly kind: TtsProviderKind;
    /** 云端按字符计费；本地端口固定 false。 */
    readonly billable: boolean;
    /** 单次文本上限，由 provider 决定，调用方据此决定是否分段。 */
    readonly maxTextLength: number;
    synthesize(input: TtsSynthesisInput, signal?: AbortSignal): Promise<TtsAudio>;
}
export declare class TtsProviderError extends Error {
    readonly reason: 'settings' | 'http' | 'empty' | 'not-audio' | 'aborted';
    constructor(reason: TtsProviderError['reason'], message: string);
}
export interface CloudTtsOptions {
    readonly id?: string;
    /** 完整合成地址。 */
    readonly baseUrl: string;
    /** 独立 Key，和 LLM 的 Key 分开存。 */
    readonly apiKey: string;
    readonly voice?: string;
    readonly format?: AudioFormat;
    /** 每千字符单价（元）。只用于估算，真实扣费以账单为准。 */
    readonly pricePerKCharCny: number;
    readonly fetchImpl?: typeof fetch;
    /** 单次上限，默认沿用 voice.ts 的 500 字。 */
    readonly maxTextLength?: number;
}
export interface LocalTtsOptions {
    readonly id?: string;
    /** 本机端口，例如 http://127.0.0.1:9880/tts */
    readonly baseUrl: string;
    /**
     * 接口协议。默认 gpt-sovits —— 本机 IndexTTS / GPT-SoVITS 服务都认这套参数；
     * 换成自建通用接口时改回 generic。
     */
    readonly protocol?: TtsProtocol;
    /** GPT-SoVITS 的参考音频，服务端本机路径。 */
    readonly refAudioPath?: string;
    /** 参考音频与文本的语言代码，默认 zh。 */
    readonly promptLang?: string;
    readonly voice?: string;
    readonly format?: AudioFormat;
    readonly fetchImpl?: typeof fetch;
    readonly maxTextLength?: number;
}
/**
 * 计费字符数：去掉空白后的 Unicode 码点数。
 *
 * 不用 `text.length`，因为它按 UTF-16 单元数，一个 emoji 会算成两个字符，
 * 和厂商账单对不上。
 */
export declare function countBillableChars(text: string): number;
/** 估算一次合成的费用（元）。只用于提示，真实金额以服务商账单为准。 */
export declare function estimateTtsCostCny(text: string, pricePerKCharCny: number): number;
/** 费用文案。带 `≈`，明确是估算不是账单。 */
export declare function formatTtsCost(costCny: number): string;
/** 云端：独立 Key + 按字符计费。 */
export declare function createCloudTtsProvider(options: CloudTtsOptions): TtsProvider;
/**
 * 本地：走本机端口，不带 Key，不计费。
 *
 * 地址默认只接受回环，避免一条配置写错就把文本发到外面去。
 */
export declare function createLocalTtsProvider(options: LocalTtsOptions): TtsProvider;
/** 给调用方判断「这段音频是不是我们要的格式」，避免把 json 当 mp3 播。 */
export declare function isAudioMime(mime: string): boolean;
/** 导出给测试和诊断用，不参与运行时逻辑。 */
export declare const TTS_MIME_BY_FORMAT: Readonly<Record<AudioFormat, string>>;
