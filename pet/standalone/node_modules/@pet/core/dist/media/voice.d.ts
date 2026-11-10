/**
 * 语音合成与语音消息。
 *
 * 这里不内置任何服务商：地址、密钥、音色都留给使用者填。
 * 和外部服务那套一样，敏感项落盘前先过 `splitForStorage`。
 *
 * 对应能力：`media.tts`、`social.voiceMessage`。
 */
export interface TtsSettings {
    /** 自建或第三方的合成接口地址。必填。 */
    readonly baseUrl: string;
    /** 接口密钥，没有就留空。 */
    readonly apiKey?: string;
    /** 音色标识，由服务方定义。 */
    readonly voice?: string;
    /** 语速，0.5 到 2。默认 1。 */
    readonly speed?: number;
    /** 期望返回的音频格式。 */
    readonly format?: AudioFormat;
    /**
     * 接口协议。generic 发通用字段，gpt-sovits 发 GPT-SoVITS 那套参数。
     * 本机 IndexTTS / GPT-SoVITS 服务都走后者。
     */
    readonly protocol?: TtsProtocol;
    /** GPT-SoVITS 的参考音频，填服务端本机路径。 */
    readonly refAudioPath?: string;
    /** 参考音频与文本的语言代码，默认 zh。 */
    readonly promptLang?: string;
}
export type TtsProtocol = 'generic' | 'gpt-sovits';
export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'opus';
export declare const AUDIO_FORMATS: readonly AudioFormat[];
export interface TtsRequest {
    readonly url: string;
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Readonly<Record<string, unknown>>;
    /** 期望的音频 MIME。 */
    readonly accept: string;
}
export declare class TtsSettingsError extends Error {
    readonly field: string;
    constructor(field: string, message: string);
}
/** 单次合成的文本上限。太长就分段，别指望一次塞进去。 */
export declare const MAX_TTS_TEXT_LENGTH = 500;
/**
 * 校验配置。
 *
 * 地址必须是 http(s)，因为要真的发出去；
 * 语速超出范围就拒，免得合成出来一句拖得离谱的话。
 */
export declare function validateTtsSettings(settings: TtsSettings): readonly string[];
/** 拼一次合成请求。 */
export declare function buildTtsRequest(settings: TtsSettings, text: string): TtsRequest;
export interface VoiceMessage {
    readonly audio: Uint8Array;
    readonly format: AudioFormat;
    /** 时长，秒。 */
    readonly durationSec: number;
}
export declare class VoiceMessageError extends Error {
    readonly reason: 'format' | 'too-large' | 'too-long' | 'empty';
    constructor(reason: VoiceMessageError['reason'], message: string);
}
/** 语音消息上限：60 秒、2 MiB。超过就不该硬发。 */
export declare const MAX_VOICE_SECONDS = 60;
export declare const MAX_VOICE_BYTES: number;
/**
 * 把合成结果包装成一条语音消息。
 *
 * 三道闸：格式在白名单里、体积不超限、时长不超限。
 */
export declare function buildVoiceMessage(audio: Uint8Array, options: {
    format: AudioFormat;
    durationSec: number;
}): VoiceMessage;
/** 从 MIME 反推格式，认不出返回 null。 */
export declare function formatFromMime(mime: string): AudioFormat | null;
/**
 * 按文本长度估算时长，用来在合成前判断要不要分段。
 *
 * 中文大约每字 0.2 秒，英文按每 5 字符 0.2 秒估。只做粗判，不发出去之前用。
 */
export declare function estimateDuration(text: string): number;
