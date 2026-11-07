// 语音域：合成请求与参考音频选择。
// 依赖全部由装配层注入，本模块不反向 import 主进程单例。
import { describeError } from '../error.js';
import { SubscriptionRegistry } from './lib/subscriptions.js';
/** 自动开口的节流时间：进程内唯一写者，所有窗口共享。 */
let lastAutoSpeakAt = 0;
/** 合成单飞锁：并发请求直接拒，不排队，避免声音滞后于气泡。 */
let speakInFlight = false;
/**
 * 持有语音的 sender 登记簿：窗口 hide 不释放，webContents 销毁才移除。
 * 只在 test 构建挂到 globalThis，供生命周期断言；不注册通道，不进生产。
 */
const subscriptions = new SubscriptionRegistry();
const noop = () => { };
if (process.env.NODE_ENV === 'test') {
    ;
    globalThis.__voiceHeldWindows = {
        has: (id) => subscriptions.has(id),
        size: (id) => id === undefined ? subscriptions.senderIds().length : subscriptions.size(id),
        clear: () => subscriptions.reset()
    };
}
export function registerVoiceChannels(deps) {
    const register = deps.registerChannel;
    register('pet:voice:speak', async (event, payload) => {
        const sender = event?.sender;
        if (sender !== null && typeof sender === 'object' && typeof sender.id === 'number') {
            subscriptions.add(sender.id, noop);
            sender.once?.('destroyed', () => {
                subscriptions.dispose(sender.id);
            });
        }
        if (speakInFlight)
            return { ok: false, reason: 'busy' };
        speakInFlight = true;
        try {
            const settings = deps.getSettings();
            const voice = settings.voice ?? {};
            const plan = deps.planSpeak({
                voice,
                // 夜间不扰统管自动朗读；语音页的 quietHours 作为独立子项继续保留。
                quiet: settings.presence?.quiet,
                text: payload?.text,
                reason: payload?.reason,
                lastAutoSpeakAt
            });
            if (!plan.ok)
                return { ok: false, reason: plan.reason };
            if (plan.autoSpeakAt !== null)
                lastAutoSpeakAt = plan.autoSpeakAt;
            const provider = deps.createLocalTtsProvider({
                baseUrl: plan.endpoint,
                protocol: plan.protocol,
                refAudioPath: plan.refAudioPath,
                promptLang: plan.promptLang
            });
            const result = await provider.synthesize({ text: plan.text });
            return { ok: true, format: result.format, audio: result.audio };
        }
        catch (error) {
            // 本地服务没跑、参考音频写错、端口被占……都只影响这一次出声。
            const message = describeError(error);
            deps.log('[voice] 合成失败：', message);
            return { ok: false, reason: 'tts-failed', message };
        }
        finally {
            speakInFlight = false;
        }
    });
    /**
     * 参考音频选择器。
     *
     * 只弹系统框、回绝对路径，不读文件、不复制、不改设置；
     * 点取消回 canceled，界面保持原来的值。
     */
    register('pet:voice:pickRefAudio', async () => {
        const result = await deps.dialog.showOpenDialog({
            title: '选择参考音频',
            properties: ['openFile'],
            filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }]
        });
        const file = result.filePaths?.[0];
        if (result.canceled || typeof file !== 'string' || file.length === 0) {
            return { ok: false, reason: 'canceled' };
        }
        return { ok: true, path: file };
    });
}
