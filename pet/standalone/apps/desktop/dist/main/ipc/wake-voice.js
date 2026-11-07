// 语音唤醒：运行时按需下载，不随包发布。
//
// 为什么拆出来：
// 1. 唤醒引擎是原生二进制 + 关键词模型，几十 MB 起，打进 dist 会直接顶穿 2 MiB 门禁。
// 2. 不是每个用户都想要常驻麦克风，默认关闭，下不下、开不开都由用户自己决定。
//
// 这里只负责「装 / 卸 / 开 / 关 / 报告状态」，不碰音频。
// 拾音与关键词检测在运行时进程里做，主进程只收一个「被叫醒」事件。
// 下载清单由发布方提供（manifestUrl），每个文件都必须带 sha256；校验不过不落盘。
export const WAKE_STATE_FILE = 'wake-voice.json';
export const WAKE_ENGINE_DIR = 'wake-engine';
/** 兜底上限：清单写错或被人换掉时不至于把磁盘写满。 */
export const WAKE_MAX_BYTES = 600 * 1024 * 1024;
const VERSION_PATTERN = /^[0-9A-Za-z._-]{1,32}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_STATE = { enabled: false, installedVersion: null };
/**
 * 清单来自网络，逐项校验后才允许写盘。
 * 任何一项不合格都整单拒绝：宁可装不上，不可装进一个来路不明的文件。
 */
export function validateManifest(raw) {
    if (raw === null || typeof raw !== 'object')
        throw new Error('清单格式不对');
    const record = raw;
    const version = typeof record.version === 'string' ? record.version : '';
    if (!VERSION_PATTERN.test(version))
        throw new Error('清单版本号不合法');
    const files = record.files;
    if (!Array.isArray(files) || files.length === 0)
        throw new Error('清单里没有文件');
    let total = 0;
    const seen = new Set();
    const normalized = [];
    for (const item of files) {
        if (item === null || typeof item !== 'object')
            throw new Error('清单文件项不合法');
        const entry = item;
        const path = typeof entry.path === 'string' ? entry.path.replace(/\\/g, '/') : '';
        const url = typeof entry.url === 'string' ? entry.url : '';
        const sha256 = typeof entry.sha256 === 'string' ? entry.sha256.toLowerCase() : '';
        if (path === '' || path.startsWith('/') || path.includes('..') || /^[a-zA-Z]:/.test(path)) {
            throw new Error(`清单路径越界：${path}`);
        }
        if (!url.startsWith('https://'))
            throw new Error(`清单地址必须走 https：${path}`);
        if (!SHA256_PATTERN.test(sha256))
            throw new Error(`清单缺少合法 sha256：${path}`);
        if (seen.has(path))
            throw new Error(`清单里有重复路径：${path}`);
        seen.add(path);
        normalized.push({ path, url, sha256 });
    }
    if (typeof record.totalBytes === 'number')
        total = record.totalBytes;
    if (total > WAKE_MAX_BYTES)
        throw new Error('唤醒运行时超过体积上限');
    return { version, totalBytes: total, files: normalized };
}
function normalizeState(raw) {
    if (raw === null || typeof raw !== 'object')
        return { ...DEFAULT_STATE };
    const record = raw;
    return {
        enabled: record.enabled === true,
        installedVersion: typeof record.installedVersion === 'string' && VERSION_PATTERN.test(record.installedVersion)
            ? record.installedVersion
            : null
    };
}
export function registerWakeVoiceChannels(deps) {
    const register = deps.registerChannel;
    const statePath = deps.pathJoin(deps.userData, WAKE_STATE_FILE);
    const engineRoot = deps.pathJoin(deps.userData, WAKE_ENGINE_DIR);
    let state = { ...DEFAULT_STATE };
    let loaded = false;
    let installing = false;
    async function loadState() {
        if (loaded)
            return state;
        try {
            state = normalizeState(JSON.parse(await deps.fs.readFile(statePath, 'utf8')));
        }
        catch {
            // 没有状态文件是正常情况：第一次装上就是默认值。
            state = { ...DEFAULT_STATE };
        }
        loaded = true;
        return state;
    }
    async function persist(next) {
        state = next;
        loaded = true;
        await deps.fs.mkdir(deps.userData, { recursive: true });
        await deps.fs.writeFile(statePath, JSON.stringify(next));
    }
    async function engineSize(version) {
        // 运行时目录会带一层 bin/ 之类的子目录，统计要往下走，否则会把「已安装」误判成空。
        async function walk(dir, depth) {
            if (depth > 4)
                return 0;
            let names;
            try {
                names = await deps.fs.readdir(dir);
            }
            catch {
                return 0;
            }
            let total = 0;
            for (const name of names) {
                const target = deps.pathJoin(dir, name);
                const info = await deps.fs.stat(target).catch(() => null);
                if (info === null)
                    continue;
                if (info.isDirectory()) {
                    total += await walk(target, depth + 1);
                    continue;
                }
                total += info.size;
            }
            return total;
        }
        return walk(deps.pathJoin(engineRoot, version), 0);
    }
    register('pet:wake:status', async () => {
        const current = await loadState();
        const installed = current.installedVersion;
        const sizeBytes = installed === null ? 0 : await engineSize(installed);
        return {
            ok: true,
            enabled: current.enabled,
            installed: installed !== null && sizeBytes > 0,
            installedVersion: installed,
            sizeBytes,
            manifestConfigured: deps.manifestUrl !== null,
            installing
        };
    });
    register('pet:wake:install', async () => {
        if (installing)
            return { ok: false, reason: 'busy', message: '正在下载，请稍等' };
        if (deps.manifestUrl === null) {
            return { ok: false, reason: 'no-manifest', message: '还没有配置唤醒运行时的下载源' };
        }
        installing = true;
        const staging = deps.pathJoin(engineRoot, `.staging-${Date.now()}`);
        try {
            const manifest = validateManifest(await deps.fetchJson(deps.manifestUrl));
            await deps.fs.mkdir(staging, { recursive: true });
            let bytes = 0;
            for (const file of manifest.files) {
                const data = await deps.downloadBytes(file.url);
                bytes += data.length;
                if (bytes > WAKE_MAX_BYTES)
                    throw new Error('唤醒运行时超过体积上限');
                const digest = deps.sha256(data).toLowerCase();
                if (digest !== file.sha256)
                    throw new Error(`校验失败：${file.path}`);
                const target = deps.pathJoin(staging, file.path);
                const parent = target.slice(0, target.length - file.path.length - 1);
                await deps.fs.mkdir(parent, { recursive: true });
                await deps.fs.writeFile(target, data);
            }
            // 全部校验通过才换上去；中途失败只清 staging，旧版本继续可用。
            const target = deps.pathJoin(engineRoot, manifest.version);
            await deps.fs.rm(target, { recursive: true, force: true });
            await deps.fs.rename(staging, target);
            await deps.fs.rm(staging, { recursive: true, force: true });
            // 只留当前版本，旧目录直接清掉，避免越装越大。
            const versions = await deps.fs.readdir(engineRoot).catch(() => []);
            for (const name of versions) {
                if (name !== manifest.version && !name.startsWith('.')) {
                    await deps.fs.rm(deps.pathJoin(engineRoot, name), { recursive: true, force: true });
                }
            }
            await persist({ enabled: state.enabled, installedVersion: manifest.version });
            deps.log('[wake] 运行时已安装', `version=${manifest.version}`, `files=${manifest.files.length}`);
            return { ok: true, version: manifest.version, fileCount: manifest.files.length, sizeBytes: bytes };
        }
        catch (error) {
            await deps.fs.rm(staging, { recursive: true, force: true });
            return { ok: false, reason: 'failed', message: deps.describeError(error) };
        }
        finally {
            installing = false;
        }
    });
    register('pet:wake:remove', async () => {
        const current = await loadState();
        try {
            await deps.fs.rm(engineRoot, { recursive: true, force: true });
            await persist({ enabled: false, installedVersion: null });
            deps.log('[wake] 运行时已删除', `was=${current.installedVersion ?? 'none'}`);
            return { ok: true };
        }
        catch (error) {
            return { ok: false, reason: 'failed', message: deps.describeError(error) };
        }
    });
    register('pet:wake:setEnabled', async (_event, payload) => {
        const current = await loadState();
        const enabled = payload?.enabled === true;
        if (enabled && current.installedVersion === null) {
            // 没有运行时就别让开关停在「已开」：用户会以为她在听，其实没在听。
            return { ok: false, reason: 'not-installed', message: '还没有下载唤醒运行时' };
        }
        await persist({ enabled, installedVersion: current.installedVersion });
        deps.log('[wake] 开关', enabled ? 'on' : 'off');
        return { ok: true, enabled, installedVersion: current.installedVersion };
    });
    return {
        isEnabled: () => loaded && state.enabled && state.installedVersion !== null,
        init: async () => {
            await loadState();
        }
    };
}
