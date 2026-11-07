// 无副作用查询通道：只读本地状态，不写盘、不改设置、不主动 send。
// 依赖全部由 electron/main.mjs 注入，本模块不反向 import 主进程单例。
import { describeError } from '../error.js';
import { registerChatStatus } from './queries/chat-status.js';
const MODEL_PREVIEW_NAMES = ['preview.png', 'thumbnail.png', 'screenshot.png', 'cover.png', 'icon.png'];
/** 把 YYYY-MM-DD 或完整时间解析成毫秒时间戳；纯日期按本地时区补齐当天起止。 */
function parseTimeBound(raw, endOfDay) {
    if (typeof raw !== 'string' || raw.trim() === '')
        return null;
    const value = raw.trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const parsed = Date.parse(dateOnly ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}` : value);
    return Number.isFinite(parsed) ? parsed : null;
}
/** 语音状态缓存时长：设置页轮询频率远高于本地探测，10 秒内复用同一个结果。 */
export const STATUS_TTL_MS = 10_000;
/** 语音状态缓存：对外仍是只读查询，写缓存只作为实现细节封在本模块里。 */
let voiceStatusCache = null;
/** 给模型列表补预览地址；没有预览图时给 null，不是错误。 */
async function withModelPreview(deps, model) {
    for (const name of MODEL_PREVIEW_NAMES) {
        const file = deps.path.join(deps.modelStore.root, model.id, name);
        const stat = await deps.fs.stat(file).catch(() => null);
        if (stat?.isFile() === true) {
            return {
                ...model,
                preview: `pet-media://model/${encodeURIComponent(model.id)}/${encodeURIComponent(name)}`
            };
        }
    }
    return { ...model, preview: null };
}
export function registerQueryChannels(deps) {
    const register = deps.registerChannel;
    register('pet:settings:get', async () => deps.getSettings());
    /** 同步口令状态：只读 vault，不写、不回传明文。 */
    register('pet:sync:passphraseStatus', async () => {
        const secretStore = deps.getSecretStore();
        if (secretStore === null)
            return { ok: false, reason: 'vault-unavailable' };
        try {
            const masked = await secretStore.getMasked(deps.syncSecretService, deps.syncSecretField);
            return { ok: true, configured: masked !== null, masked: masked ?? null };
        }
        catch (error) {
            deps.log('[sync] 读取同步口令状态失败：', error instanceof Error ? error.message : error);
            return { ok: false, reason: 'vault-unavailable' };
        }
    });
    register('pet:models:list', async () => {
        try {
            const models = await deps.modelStore.list();
            return { ok: true, models: await Promise.all(models.map((item) => withModelPreview(deps, item))) };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[models] 列表失败：', message);
            return { ok: false, message, models: [] };
        }
    });
    register('pet:assets:list', async () => {
        try {
            return await deps.assetLibrary.list();
        }
        catch (error) {
            deps.log('[assets] 列表失败：', describeError(error));
            return { ok: false, reason: 'read-failed', groups: [], total: 0 };
        }
    });
    register('pet:system:stats', async () => ({ ok: true, stats: deps.systemStats.snapshot() }));
    /**
     * 语音服务的真实状态。
     *
     * 只回结果，不替界面编人话；云端只判断「有没有填地址」，不发请求、不计费。
     * 10 秒缓存挡住设置页每 2 秒一次的重复探测。
     */
    register('pet:voice:status', async () => {
        const voice = deps.getSettings().voice ?? deps.defaultSettings.voice;
        // 第 0 层：能力整体关闭，短路到 disabled；不做地址判定，也不探测。
        if (voice.provider === 'off')
            return { ok: true, state: 'disabled' };
        if (voice.provider === 'cloud') {
            const baseUrl = String(voice.cloud?.baseUrl ?? '').trim();
            return { ok: true, state: baseUrl.length === 0 ? 'cloud-unconfigured' : 'cloud-unverified' };
        }
        const endpoint = deps.toTtsEndpoint(voice.localUrl);
        if (endpoint.length === 0)
            return { ok: true, state: 'no-endpoint' };
        // 决策层级：空地址先判未配置；非空但无法确认回环，直接拒绝探测。
        // 地址写错或端口非法时没有 host 可比，按 not-loopback 处理，避免伪装成「已配置但连不上」。
        if (!deps.isLoopbackEndpoint(endpoint)) {
            return { ok: true, state: 'not-loopback' };
        }
        const refAudioPath = String(voice.refAudioPath ?? '').trim();
        if (refAudioPath.length === 0)
            return { ok: true, state: 'no-ref-audio' };
        const key = `${endpoint}|${refAudioPath}`;
        if (voiceStatusCache !== null && voiceStatusCache.key === key && deps.now() - voiceStatusCache.at < STATUS_TTL_MS) {
            return voiceStatusCache.value;
        }
        const probe = await deps.probeTtsEndpoint(endpoint);
        const value = probe.ok
            ? { ok: true, state: 'ready', status: probe.status }
            : { ok: true, state: probe.error === 'not-loopback' ? 'not-loopback' : 'offline', error: probe.error };
        voiceStatusCache = { key, at: deps.now(), value };
        return value;
    });
    register('pet:presence:mood', async () => ({ ok: true, mood: deps.presenceService.currentMood() }));
    /** 当前生效的模型（带渲染用 URL）。没有可用模型时 model 为 null。 */
    register('pet:models:active', async () => {
        try {
            const models = await deps.modelStore.list();
            const wanted = deps.getSettings().live2dModelId;
            const hit = models.find((item) => item.id === wanted && item.valid);
            return {
                ok: true,
                model: hit === undefined ? null : { ...hit, url: deps.modelStore.toMediaUrl(hit) },
                models
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[models] 读取当前模型失败：', message);
            return { ok: false, message, model: null, models: [] };
        }
    });
    register('pet:packs:list', async () => {
        try {
            return { ok: true, packs: await deps.packStore.list() };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[packs] 列表失败：', message);
            return { ok: false, message, packs: [] };
        }
    });
    /** 待审核表情：QQ 偷来的图还没入库，只回文件清单与 pet-media 地址。 */
    register('pet:sticker:inbox', async () => {
        try {
            return { ok: true, items: await deps.stickerInbox.list() };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[sticker] 读取待审核失败：', message);
            return { ok: false, message, items: [] };
        }
    });
    /** 表情库：内置 + 用户素材包，给预览页展示与「发到 QQ」用 id。 */
    register('pet:sticker:library', async () => {
        try {
            return { ok: true, items: await deps.stickerLibrary.list() };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[sticker] 读取表情库失败：', message);
            return { ok: false, message, items: [] };
        }
    });
    register('pet:chat:history', () => deps.chatService.history());
    /** 连接自检：发一次最小请求，只回结果，不写盘、不改设置。 */
    register('pet:llm:test', async () => deps.chatService.test());
    registerChatStatus({
        registerChannel: register,
        getChatSnapshot: () => (typeof deps.chatService.status === 'function' ? deps.chatService.status() : null),
        probeChat: () => typeof deps.chatService.test === 'function' ? deps.chatService.test() : Promise.resolve({ ok: false }),
        now: deps.now,
        log: deps.log
    });
    register('pet:memory:stats', () => {
        const stats = deps.memoryStore.stats();
        return { ...stats, enabled: deps.memoryEnabled() };
    });
    /**
     * 分页读取记忆内容，最新在前。
     * 支持关键词、来源（user / assistant）与时间范围；命中结果跨页过滤后再分页。
     */
    register('pet:memory:list', async (_event, payload) => {
        if (!deps.memoryStore.stats().available) {
            return { ok: false, reason: 'vault-unavailable', total: 0, offset: 0, limit: 0, items: [] };
        }
        const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
        const role = payload?.role === 'user' || payload?.role === 'assistant' ? payload.role : '';
        const fromMs = parseTimeBound(payload?.from, false);
        const toMs = parseTimeBound(payload?.to, true);
        const filtering = query !== '' || role !== '' || fromMs !== null || toMs !== null;
        if (!filtering) {
            // 层与来源在存储里就能筛，直接透传；传了不认识的值由存储自己忽略。
            const scope = typeof payload?.scope === 'string' ? payload.scope : '';
            const layer = typeof payload?.layer === 'string' ? payload.layer : '';
            const options = { offset: payload?.offset, limit: payload?.limit };
            if (scope !== '')
                options.scope = scope;
            if (layer !== '')
                options.layer = layer;
            if (payload?.includeCold === false)
                options.includeCold = false;
            return { ok: true, ...deps.memoryStore.list(options) };
        }
        const keyword = query.toLowerCase();
        const matched = deps.collectMemoryAll().filter((item) => {
            if (role !== '' && item?.role !== role)
                return false;
            if (keyword !== '' && !String(item?.text ?? '').toLowerCase().includes(keyword))
                return false;
            if (fromMs === null && toMs === null)
                return true;
            const at = Date.parse(String(item?.at ?? ''));
            if (!Number.isFinite(at))
                return false;
            if (fromMs !== null && at < fromMs)
                return false;
            if (toMs !== null && at > toMs)
                return false;
            return true;
        });
        const offset = Math.max(0, Number(payload?.offset) || 0);
        const limit = Math.max(1, Number(payload?.limit) || 50);
        return {
            ok: true,
            total: matched.length,
            offset,
            limit,
            query,
            role,
            from: typeof payload?.from === 'string' ? payload.from : '',
            to: typeof payload?.to === 'string' ? payload.to : '',
            items: matched.slice(offset, offset + limit)
        };
    });
    /** 最近一份日报：目录里没有就明确回 no-report，不返回空对象冒充成功。 */
    register('pet:daily:last', async () => {
        let entries = [];
        try {
            entries = await deps.fs.readdir(deps.reportsDir);
        }
        catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
            if (code !== 'ENOENT')
                deps.log('[daily] 读目录失败：', String(error));
            return { ok: false, reason: 'no-report' };
        }
        const files = entries.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
        if (files.length === 0)
            return { ok: false, reason: 'no-report' };
        const name = files[files.length - 1];
        try {
            const parsed = JSON.parse(await deps.fs.readFile(deps.path.join(deps.reportsDir, name), 'utf8'));
            return { ok: true, ...parsed };
        }
        catch (error) {
            deps.log('[daily] 报告不可读：', String(error));
            return { ok: false, reason: 'unreadable' };
        }
    });
    register('pet:persona:preview', () => deps.buildPersonaPrompt(deps.getSettings()));
    register('pet:secrets:masked', async (_event, request) => {
        const serviceId = String(request?.serviceId ?? '');
        const field = typeof request?.field === 'string' ? request.field : '';
        return { masked: await deps.requireSecretStore().getMasked(serviceId, field) };
    });
    register('pet:backup:getConfig', async () => {
        const prefs = await deps.getBackupPrefs();
        return {
            ok: true,
            dirName: prefs.dir === '' ? '' : deps.path.basename(prefs.dir),
            keep: prefs.keep,
            lastRunAt: prefs.lastRunAt,
            autoIntervalDays: Number.isInteger(prefs.autoIntervalDays) ? prefs.autoIntervalDays : 0,
            autoLastError: typeof prefs.autoLastError === 'string' ? prefs.autoLastError : '',
            autoStored: prefs.autoStored === true,
            fallbackDirName: deps.path.basename(deps.app.getPath('documents'))
        };
    });
    /**
     * 启动前体检：只汇总本地能查到的状态。
     * 不在这里发网络请求、不计费；拿不到的项明确写 null，不猜。
     */
    register('pet:preflight', async () => {
        let models = { count: 0, activeId: null, activeValid: false };
        try {
            const list = await deps.modelStore.list();
            const settings = deps.getSettings();
            models = {
                count: list.length,
                activeId: settings.live2dModelId || null,
                activeValid: list.some((item) => item.id === settings.live2dModelId && item.valid)
            };
        }
        catch (error) {
            models = { count: 0, activeId: null, activeValid: false, error: describeError(error) };
        }
        let secret = { configured: false, masked: null };
        try {
            const masked = await deps.requireSecretStore().getMasked(deps.balanceService, deps.balanceField);
            secret = { configured: typeof masked === 'string' && masked !== '', masked: masked ?? null };
        }
        catch (error) {
            secret = { configured: false, masked: null, error: describeError(error) };
        }
        let disk = { path: deps.userData, freeBytes: null, totalBytes: null };
        try {
            const info = await deps.fs.statfs(deps.userData);
            disk = {
                path: deps.userData,
                freeBytes: Number(info.bavail) * Number(info.bsize),
                totalBytes: Number(info.blocks) * Number(info.bsize)
            };
        }
        catch (error) {
            disk = { path: deps.userData, freeBytes: null, totalBytes: null, error: describeError(error) };
        }
        const vault = deps.getVault();
        let vaultInfo = { available: vault !== null, code: vault === null ? 'VAULT_UNAVAILABLE' : 'OK' };
        if (vault !== null) {
            try {
                vaultInfo = { available: true, ...(await vault.diagnose()) };
            }
            catch (error) {
                vaultInfo = { available: true, error: describeError(error) };
            }
        }
        const settings = deps.getSettings();
        const voice = settings.voice ?? deps.defaultSettings.voice;
        const voiceProvider = voice.provider ?? 'off';
        return {
            ok: true,
            at: new Date().toISOString(),
            chat: { ...deps.chatService.status(), historyPersisted: deps.chatHistoryStore.stats().persisted },
            memory: deps.memoryStore.stats(),
            models,
            secret,
            voice: {
                provider: voiceProvider,
                endpointConfigured: voiceProvider === 'local'
                    ? String(voice.localUrl ?? '').trim() !== ''
                    : voiceProvider === 'cloud'
                        ? String(voice.cloud?.baseUrl ?? '').trim() !== ''
                        : false
            },
            disk,
            vault: vaultInfo
        };
    });
    register('pet:render:info', () => deps.getLastRenderInfo() ?? {});
}
