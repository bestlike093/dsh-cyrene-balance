/**
 * 语音合成与语音消息。
 *
 * 这里不内置任何服务商：地址、密钥、音色都留给使用者填。
 * 和外部服务那套一样，敏感项落盘前先过 `splitForStorage`。
 *
 * 对应能力：`media.tts`、`social.voiceMessage`。
 */
export const AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'opus'];
export class TtsSettingsError extends Error {
    field;
    constructor(field, message) {
        super(`tts.${field}：${message}`);
        this.name = 'TtsSettingsError';
        this.field = field;
    }
}
/** 单次合成的文本上限。太长就分段，别指望一次塞进去。 */
export const MAX_TTS_TEXT_LENGTH = 500;
const MIME_BY_FORMAT = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    opus: 'audio/opus'
};
/**
 * 校验配置。
 *
 * 地址必须是 http(s)，因为要真的发出去；
 * 语速超出范围就拒，免得合成出来一句拖得离谱的话。
 */
export function validateTtsSettings(settings) {
    const errors = [];
    const baseUrl = settings.baseUrl.trim();
    if (baseUrl.length === 0) {
        errors.push('接口地址不能为空');
    }
    else if (!/^https?:\/\//i.test(baseUrl)) {
        errors.push('接口地址需要以 http:// 或 https:// 开头');
    }
    if (settings.speed !== undefined) {
        if (!Number.isFinite(settings.speed) || settings.speed < 0.5 || settings.speed > 2) {
            errors.push('语速需要在 0.5 到 2 之间');
        }
    }
    if (settings.format !== undefined && !AUDIO_FORMATS.includes(settings.format)) {
        errors.push('音频格式只能是 mp3 / wav / ogg / opus');
    }
    return errors;
}
/** 拼一次合成请求。 */
export function buildTtsRequest(settings, text) {
    const errors = validateTtsSettings(settings);
    if (errors.length > 0)
        throw new TtsSettingsError('settings', errors[0]);
    const content = text.trim();
    if (content.length === 0)
        throw new TtsSettingsError('text', '文本不能为空');
    if (content.length > MAX_TTS_TEXT_LENGTH) {
        throw new TtsSettingsError('text', `最多 ${MAX_TTS_TEXT_LENGTH} 字，当前 ${content.length}`);
    }
    const protocol = settings.protocol ?? 'generic';
    // GPT-SoVITS 这类本机服务默认回 wav，通用接口沿用 mp3。
    const format = settings.format ?? (protocol === 'gpt-sovits' ? 'wav' : 'mp3');
    const headers = {
        'Content-Type': 'application/json',
        Accept: MIME_BY_FORMAT[format]
    };
    if (settings.apiKey !== undefined && settings.apiKey.trim().length > 0) {
        headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
    }
    if (protocol === 'gpt-sovits') {
        const refAudioPath = settings.refAudioPath?.trim() ?? '';
        if (refAudioPath.length === 0) {
            throw new TtsSettingsError('refAudioPath', '本地合成需要先填参考音频路径');
        }
        const lang = settings.promptLang?.trim() ?? 'zh';
        // 参考文本：GPT-SoVITS 靠它对齐音色；空着提交空串，音色会差一截。
        const promptText = settings.promptText?.trim() ?? '';
        return {
            url: settings.baseUrl.trim(),
            method: 'POST',
            headers,
            body: {
                text: content,
                text_lang: lang,
                ref_audio_path: refAudioPath,
                prompt_text: promptText,
                prompt_lang: lang,
                text_split_method: 'cut5',
                batch_size: 1,
                media_type: format,
                streaming_mode: false
            },
            accept: MIME_BY_FORMAT[format]
        };
    }
    return {
        url: settings.baseUrl.trim(),
        method: 'POST',
        headers,
        body: {
            text: content,
            ...(settings.voice === undefined ? {} : { voice: settings.voice }),
            speed: settings.speed ?? 1,
            format
        },
        accept: MIME_BY_FORMAT[format]
    };
}
export class VoiceMessageError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.name = 'VoiceMessageError';
        this.reason = reason;
    }
}
/** 语音消息上限：60 秒、2 MiB。超过就不该硬发。 */
export const MAX_VOICE_SECONDS = 60;
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
/**
 * 把合成结果包装成一条语音消息。
 *
 * 三道闸：格式在白名单里、体积不超限、时长不超限。
 */
export function buildVoiceMessage(audio, options) {
    if (!AUDIO_FORMATS.includes(options.format)) {
        throw new VoiceMessageError('format', `不支持的音频格式：${options.format}`);
    }
    if (audio.byteLength === 0) {
        throw new VoiceMessageError('empty', '音频内容为空');
    }
    if (audio.byteLength > MAX_VOICE_BYTES) {
        throw new VoiceMessageError('too-large', `语音太大：${audio.byteLength} 字节，上限 ${MAX_VOICE_BYTES}`);
    }
    if (!Number.isFinite(options.durationSec) || options.durationSec <= 0) {
        throw new VoiceMessageError('too-long', '时长需要是正数');
    }
    if (options.durationSec > MAX_VOICE_SECONDS) {
        throw new VoiceMessageError('too-long', `语音太长：${options.durationSec} 秒，上限 ${MAX_VOICE_SECONDS} 秒`);
    }
    return {
        audio,
        format: options.format,
        durationSec: Math.round(options.durationSec * 10) / 10
    };
}
/** 从 MIME 反推格式，认不出返回 null。 */
export function formatFromMime(mime) {
    const type = mime.split(';')[0]?.trim().toLowerCase() ?? '';
    for (const format of AUDIO_FORMATS) {
        if (MIME_BY_FORMAT[format] === type)
            return format;
    }
    return null;
}
/**
 * 按文本长度估算时长，用来在合成前判断要不要分段。
 *
 * 中文大约每字 0.2 秒，英文按每 5 字符 0.2 秒估。只做粗判，不发出去之前用。
 */
export function estimateDuration(text) {
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    const rest = text.length - chinese;
    return Math.round((chinese * 0.2 + rest * 0.04) * 10) / 10;
}
