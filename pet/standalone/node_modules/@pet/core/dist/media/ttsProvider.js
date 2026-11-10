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
import { estimateDuration, buildTtsRequest } from './voice.js';
export class TtsProviderError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.name = 'TtsProviderError';
        this.reason = reason;
    }
}
const DEFAULT_MAX_TEXT = 500;
const MIME_BY_FORMAT = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    opus: 'audio/opus'
};
/**
 * 计费字符数：去掉空白后的 Unicode 码点数。
 *
 * 不用 `text.length`，因为它按 UTF-16 单元数，一个 emoji 会算成两个字符，
 * 和厂商账单对不上。
 */
export function countBillableChars(text) {
    return [...text.replace(/\s+/g, '')].length;
}
/** 估算一次合成的费用（元）。只用于提示，真实金额以服务商账单为准。 */
export function estimateTtsCostCny(text, pricePerKCharCny) {
    if (!Number.isFinite(pricePerKCharCny) || pricePerKCharCny <= 0)
        return 0;
    const chars = countBillableChars(text);
    // 保留 6 位，避免 0.0000001 这类浮点噪声
    return Math.round((chars / 1000) * pricePerKCharCny * 1e6) / 1e6;
}
/** 费用文案。带 `≈`，明确是估算不是账单。 */
export function formatTtsCost(costCny) {
    if (!Number.isFinite(costCny) || costCny <= 0)
        return '≈¥0';
    if (costCny < 0.01)
        return `≈¥${costCny.toFixed(4)}`;
    return `≈¥${costCny.toFixed(2)}`;
}
function toTtsSettings(baseUrl, apiKey, options) {
    return {
        baseUrl,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(options.voice === undefined ? {} : { voice: options.voice }),
        ...(options.speed === undefined ? {} : { speed: options.speed }),
        ...(options.format === undefined ? {} : { format: options.format }),
        ...(options.protocol === undefined ? {} : { protocol: options.protocol }),
        ...(options.refAudioPath === undefined ? {} : { refAudioPath: options.refAudioPath }),
        ...(options.promptLang === undefined ? {} : { promptLang: options.promptLang })
    };
}
async function requestAudio(settings, text, maxTextLength, fetchImpl, signal) {
    if ([...text].length > maxTextLength) {
        throw new TtsProviderError('settings', `文本超出单次上限：${[...text].length} > ${maxTextLength}`);
    }
    let request;
    try {
        request = buildTtsRequest(settings, text);
    }
    catch (error) {
        throw new TtsProviderError('settings', error instanceof Error ? error.message : '合成请求构造失败');
    }
    let response;
    try {
        response = await fetchImpl(request.url, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(request.body),
            ...(signal === undefined ? {} : { signal })
        });
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new TtsProviderError('aborted', '合成已取消');
        }
        throw new TtsProviderError('http', error instanceof Error ? error.message : '合成请求失败');
    }
    if (!response.ok) {
        throw new TtsProviderError('http', `合成接口返回 ${response.status}`);
    }
    // 有的服务商出错时也回 200，只是 body 里塞一段 JSON。先看 Content-Type。
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^audio\//i.test(contentType)) {
        throw new TtsProviderError('not-audio', `返回内容不是音频：${contentType === '' ? '缺少 Content-Type' : contentType}`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
        throw new TtsProviderError('empty', '合成结果为空');
    }
    const format = settings.format ?? (settings.protocol === 'gpt-sovits' ? 'wav' : 'mp3');
    return {
        audio: new Uint8Array(buffer),
        format,
        // 时长只能是估算：真实秒数要解码后才准，这里先给排队和展示用。
        durationSec: estimateDuration(text)
    };
}
/** 云端：独立 Key + 按字符计费。 */
export function createCloudTtsProvider(options) {
    const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT;
    const fetchImpl = options.fetchImpl ?? fetch;
    return {
        id: options.id ?? 'cloud',
        kind: 'cloud',
        billable: true,
        maxTextLength,
        async synthesize(input, signal) {
            if (options.apiKey.trim().length === 0) {
                throw new TtsProviderError('settings', '云端合成缺少 API Key');
            }
            const settings = toTtsSettings(options.baseUrl, options.apiKey, {
                voice: input.voice ?? options.voice,
                speed: input.speed,
                format: input.format ?? options.format
            });
            return requestAudio(settings, input.text, maxTextLength, fetchImpl, signal);
        }
    };
}
/**
 * 本地：走本机端口，不带 Key，不计费。
 *
 * 地址默认只接受回环，避免一条配置写错就把文本发到外面去。
 */
export function createLocalTtsProvider(options) {
    const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT;
    const fetchImpl = options.fetchImpl ?? fetch;
    const isLoopback = (() => {
        try {
            const url = new URL(options.baseUrl);
            const host = url.hostname;
            return (host === '127.0.0.1' ||
                host === 'localhost' ||
                host === '::1' ||
                host === '[::1]');
        }
        catch {
            return false;
        }
    })();
    if (!isLoopback) {
        throw new TtsProviderError('settings', '本地合成地址必须是回环地址（127.0.0.1 / localhost）');
    }
    return {
        id: options.id ?? 'local',
        kind: 'local',
        billable: false,
        maxTextLength,
        async synthesize(input, signal) {
            const settings = toTtsSettings(options.baseUrl, undefined, {
                voice: input.voice ?? options.voice,
                speed: input.speed,
                format: input.format ?? options.format,
                protocol: options.protocol ?? 'gpt-sovits',
                refAudioPath: options.refAudioPath,
                promptLang: options.promptLang,
                promptText: options.promptText ?? ''
            });
            return requestAudio(settings, input.text, maxTextLength, fetchImpl, signal);
        }
    };
}
/** 给调用方判断「这段音频是不是我们要的格式」，避免把 json 当 mp3 播。 */
export function isAudioMime(mime) {
    return /^audio\//i.test(mime.trim());
}
/** 导出给测试和诊断用，不参与运行时逻辑。 */
export const TTS_MIME_BY_FORMAT = MIME_BY_FORMAT;
