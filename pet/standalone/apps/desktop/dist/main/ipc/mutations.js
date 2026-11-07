import { describeError } from '../error.js';
/** 同一秒内连点两次也不会互相覆盖：撞名就加序号。 */
async function uniqueBackupPath(deps, dir, stamp) {
    let candidate = deps.path.join(dir, `dsh-pet-${stamp}.petbackup`);
    let suffix = 2;
    while (await deps.fs.access(candidate).then(() => true, () => false)) {
        candidate = deps.path.join(dir, `dsh-pet-${stamp}-${suffix}.petbackup`);
        suffix += 1;
    }
    return candidate;
}
/** 本地时间命名，避免 UTC 在凌晨把日期写错一天。 */
function backupStamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
/** 只保留最近 keep 份；删不掉就留在原地，下次再试。 */
async function pruneBackupFiles(deps, dir, keep) {
    const entries = await deps.fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile() || !/^dsh-pet-.+\.petbackup$/.test(entry.name))
            continue;
        const full = deps.path.join(dir, entry.name);
        const stat = await deps.fs.stat(full).catch(() => null);
        if (stat !== null)
            files.push({ full, mtime: stat.mtimeMs });
    }
    files.sort((a, b) => b.mtime - a.mtime);
    let removed = 0;
    for (const item of files.slice(keep)) {
        try {
            await deps.fs.rm(item.full, { force: true });
            removed += 1;
        }
        catch {
            // 删不掉就留在原地，下次再试；不因为轮换失败回滚已经写好的备份。
        }
    }
    return removed;
}
/** 同一时刻只允许一次备份：短时连点第二次直接拒掉，避免出两份包。 */
let backupInFlight = false;
export function registerMutationChannels(deps) {
    const register = deps.registerChannel;
    /** 导入素材包：只弹 zip 选择框，解压与校验都在 packs.mjs。 */
    register('pet:packs:import', async () => {
        const picked = await deps.dialog.showOpenDialog(deps.getDialogParent(), {
            title: '选择素材包（.zip）',
            properties: ['openFile'],
            filters: [{ name: '素材包', extensions: ['zip'] }]
        });
        if (picked.canceled || picked.filePaths.length === 0) {
            return { ok: false, canceled: true };
        }
        const file = picked.filePaths[0];
        if (file === undefined)
            return { ok: false, canceled: true };
        const startedAt = Date.now();
        try {
            const pack = await deps.packStore.importFromZip(file);
            deps.log('[packs] 导入完成：', pack.id, `${Date.now() - startedAt}ms`);
            return { ok: true, pack, packs: await deps.packStore.list() };
        }
        catch (error) {
            const message = describeError(error);
            const code = typeof error?.code === 'string'
                ? String(error.code)
                : 'IMPORT_FAILED';
            // packs.mjs 会一次带回全部校验问题；界面逐条展示，最多 20 条。
            const rawDetails = error?.details;
            const details = Array.isArray(rawDetails)
                ? rawDetails
                    .slice(0, 20)
                    .map((item) => {
                    const record = (item ?? {});
                    return {
                        code: typeof record.code === 'string' ? record.code : code,
                        message: typeof record.message === 'string' ? record.message : '',
                        entry: typeof record.entry === 'string' ? record.entry : ''
                    };
                })
                    .filter((item) => item.message !== '')
                : [];
            deps.log('[packs] 导入失败：', code, message, `问题 ${details.length} 条`);
            return { ok: false, code, message, ...(details.length > 0 ? { details } : {}) };
        }
    });
    /** 启用 / 停用一个素材包；只改清单，不删文件。 */
    register('pet:packs:setEnabled', async (_event, packId, enabled) => {
        try {
            const result = await deps.packStore.setEnabled(packId, enabled !== false);
            return { ok: true, ...result, packs: await deps.packStore.list() };
        }
        catch (error) {
            const message = describeError(error);
            const code = typeof error?.code === 'string'
                ? String(error.code)
                : 'SET_ENABLED_FAILED';
            deps.log('[packs] 启用状态失败：', code, message);
            return { ok: false, code, message };
        }
    });
    /**
     * 删除素材包。设置里引用这个包的字段一并清空，避免指向不存在的文件。
     * 只认字符串前缀 `pack:<id>:`，与具体字段名解耦。
     */
    register('pet:packs:remove', async (_event, packId) => {
        const id = typeof packId === 'string' ? packId.trim() : '';
        try {
            await deps.packStore.remove(id);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[packs] 删除失败：', message);
            return { ok: false, message };
        }
        const prefix = `pack:${id}:`;
        const next = { ...deps.getSettings() };
        const reset = (value) => typeof value === 'string' && value.startsWith(prefix) ? '' : value;
        if (next.icon !== undefined)
            next.icon = { ...next.icon };
        if (next.bubble !== undefined)
            next.bubble = { ...next.bubble };
        if (next.sticker !== undefined)
            next.sticker = { ...next.sticker };
        if (next.icon !== undefined) {
            next.icon.tray = reset(next.icon.tray);
            next.icon.app = reset(next.icon.app);
        }
        if (next.bubble !== undefined) {
            next.bubble.background = reset(next.bubble.background);
            next.bubble.fontFamily = reset(next.bubble.fontFamily);
        }
        if (next.sticker !== undefined)
            next.sticker.source = reset(next.sticker.source);
        deps.setSettings(next);
        await deps.writeJson(deps.settingsPath, next);
        // 包删了，托盘与窗口图标要立刻退回内置素材。
        deps.applyIconSettings(true);
        deps.broadcastSettings(next);
        return { ok: true, packs: await deps.packStore.list() };
    });
    /**
     * 表情包入库。只接受单个 id，拒绝批量；
     * 素材包 id 与文件名都会在 stickerInbox 内再做一次清洗与越界检查。
     */
    register('pet:sticker:approve', async (_event, payload) => {
        const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
        if (id === '')
            return { ok: false, code: 'INPUT_MISSING', message: '缺少待审核 id' };
        const packId = typeof payload?.packId === 'string' ? payload.packId.trim() : '';
        const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
        try {
            const result = await deps.stickerInbox.approve(id, {
                ...(packId === '' ? {} : { packId }),
                ...(name === '' ? {} : { name })
            });
            deps.log('[sticker] 用户确认入库：', id);
            return {
                ok: true,
                ...result,
                items: await deps.stickerInbox.list(),
                packs: await deps.packStore.list()
            };
        }
        catch (error) {
            const message = describeError(error);
            deps.log('[sticker] 入库失败：', message);
            return { ok: false, code: 'APPROVE_FAILED', message };
        }
    });
    /** 丢弃待审核图；删文件不可撤销，所以只接受单个 id。 */
    register('pet:sticker:reject', async (_event, payload) => {
        const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
        if (id === '')
            return { ok: false, code: 'INPUT_MISSING', message: '缺少待审核 id' };
        try {
            const result = await deps.stickerInbox.reject(id);
            deps.log('[sticker] 用户丢弃：', id);
            return { ok: true, ...result, items: await deps.stickerInbox.list() };
        }
        catch (error) {
            const message = describeError(error);
            deps.log('[sticker] 丢弃失败：', message);
            return { ok: false, code: 'REJECT_FAILED', message };
        }
    });
    /** 打开独立预览页；只做窗口切换，不在打开时读盘。 */
    register('pet:sticker:open', () => {
        deps.openStickerWindow();
        return { ok: true };
    });
    /**
     * 发一张已入库的表情到最近一次 QQ 会话。
     * file 由渲染层传素材包内相对路径，主进程仍会重新解析并做边界检查。
     */
    register('pet:sticker:send', async (_event, payload) => {
        const file = typeof payload?.file === 'string' ? payload.file.trim() : '';
        if (file === '')
            return { ok: false, code: 'INPUT_MISSING', message: '缺少表情文件' };
        try {
            const result = await deps.sendQqSticker(file);
            deps.log('[sticker] 发送结果：', result.ok === true ? 'ok' : result.reason ?? 'failed');
            return result;
        }
        catch (error) {
            const message = describeError(error);
            deps.log('[sticker] 发送失败：', message);
            return { ok: false, code: 'SEND_FAILED', message };
        }
    });
    /**
     * 设置保存。广播点只发射，不同步做任何 key 级计算；
     * 需要按 key 分支的逻辑必须先抽到纯函数，不能藏在这里。
     */
    register('pet:settings:save', async (_event, next) => {
        if (typeof next !== 'object' || next === null)
            return deps.getSettings();
        const dropped = Object.keys(next).filter((key) => !deps.settingsTopKeys.has(key));
        if (dropped.length > 0)
            deps.log('[settings] 已丢弃未登记字段：', dropped.join(','));
        const patch = deps.sanitizeSettingsPatch(next);
        if (Object.keys(patch).length === 0)
            return deps.getSettings();
        let merged = deps.mergeLayer(deps.getSettings(), patch);
        // 服务商只接受 deepseek：这里再兜一次，防止绕过迁移直接写设置文件。
        if (merged.companion?.chat?.provider !== 'deepseek') {
            merged = deps.mergeLayer(merged, { companion: { chat: { provider: 'deepseek' } } });
        }
        deps.setSettings(merged);
        await deps.writeJson(deps.settingsPath, merged);
        // 图标引用变了就当场换掉，不用等重启。
        deps.applyIconSettings();
        deps.broadcastSettings(merged);
        return merged;
    });
    register('pet:backup:chooseDir', async () => {
        const prefs = await deps.getBackupPrefs();
        const { canceled, filePaths } = await deps.dialog.showOpenDialog(deps.getDialogParent(), {
            title: '选择备份目录',
            defaultPath: prefs.dir === '' ? deps.getAppPath('documents') : prefs.dir,
            properties: ['openDirectory', 'createDirectory']
        });
        if (canceled || filePaths.length === 0)
            return { ok: false, reason: 'canceled' };
        const dir = filePaths[0];
        if (dir === undefined)
            return { ok: false, reason: 'canceled' };
        await deps.saveBackupPrefs({ dir });
        return { ok: true, dirName: deps.path.basename(dir) };
    });
    register('pet:backup:setKeep', async (_event, payload) => {
        const keep = Number(payload?.keep);
        if (!Number.isInteger(keep) || keep < 1 || keep > 100) {
            return { ok: false, reason: 'invalid-keep', message: '保留份数需在 1–100 之间' };
        }
        await deps.saveBackupPrefs({ keep });
        return { ok: true, keep };
    });
    register('pet:backup:run', async (_event, payload) => {
        if (backupInFlight)
            return { ok: false, reason: 'busy' };
        backupInFlight = true;
        try {
            return await runBackup(deps, payload);
        }
        finally {
            // 释放只走这一条路径：成功、失败、渲染断开导致的中断，都从这里落回。
            backupInFlight = false;
        }
    });
    /**
     * 备份锁探针。
     *
     * 只给主进程诊断与测试读「当前是否在跑」，不暴露给渲染，不进 preload。
     * 仅在非 production 注册，避免线上被当成轮询原语；要等完成，等 invoke 的
     * promise 或上层 done 信号，禁止自旋读 probe。
     */
    if (process.env.NODE_ENV !== 'production') {
        register('pet:backup:probe', async () => ({ ok: true, inFlight: backupInFlight }));
    }
}
/** 手动与自动备份共用同一套落盘、限权与轮换逻辑。 */
export async function runBackup(deps, payload) {
    const vault = deps.getVault();
    if (vault === null) {
        return { ok: false, reason: 'vault-unavailable', message: '加密仓库没有装配成功' };
    }
    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (password.length < 8) {
        return { ok: false, reason: 'weak-password', message: '备份口令至少 8 位' };
    }
    const prefs = await deps.getBackupPrefs();
    const dir = prefs.dir === '' ? deps.getAppPath('documents') : prefs.dir;
    const stat = await deps.fs.stat(dir).catch(() => null);
    if (stat === null || !stat.isDirectory()) {
        return { ok: false, reason: 'dir-missing', message: '备份目录不存在，请重新选择' };
    }
    const filePath = await uniqueBackupPath(deps, dir, backupStamp());
    const fileName = deps.path.basename(filePath);
    try {
        const backup = await deps.createVaultBackup({
            ring: vault.ring,
            password,
            files: await deps.readBackupFiles()
        });
        await deps.fs.writeFile(filePath, JSON.stringify(backup), 'utf8');
        await deps.restrictPermissions(filePath);
        const removed = await pruneBackupFiles(deps, dir, prefs.keep);
        try {
            await deps.saveBackupPrefs({ lastRunAt: new Date().toISOString() });
        }
        catch {
            // 时间戳写失败不影响这次备份，文件已经落盘。
        }
        deps.log('[backup] 已备份', `file=${fileName}`, `removed=${removed}`);
        return {
            ok: true,
            fileName,
            dirName: deps.path.basename(dir),
            fileCount: backup.files.length,
            removed
        };
    }
    catch (error) {
        return { ok: false, reason: 'failed', message: describeError(error) };
    }
}
