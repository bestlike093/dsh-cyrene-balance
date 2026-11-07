export function registerSyncChannels(deps) {
    const register = deps.registerChannel;
    /**
     * 设置同步：导出快照 / 应用对端变更。
     *
     * 和托盘菜单走同一份 settingsSync，只在本机同步目录里搬运，不连远端。
     * 应用后回调会更新内存里的 settings，设置页重新读一次即可看到新值。
     */
    register('pet:sync:run', async (_event, payload) => {
        const action = payload?.action;
        if (action !== 'export' && action !== 'apply')
            return { ok: false, reason: 'bad-action' };
        const sync = deps.getSettingsSync();
        if (sync === null)
            return { ok: false, reason: 'sync-unavailable' };
        try {
            const result = action === 'export' ? await sync.publish() : await sync.pull();
            const stamp = new Date().toISOString();
            try {
                await deps.saveSyncPrefs(action === 'export' ? { lastExportAt: stamp } : { lastPullAt: stamp });
            }
            catch (error) {
                // 时间只是界面展示，记不下来不该让一次成功的同步看起来失败。
                deps.log('[sync] 记录同步时间失败：', error instanceof Error ? error.message : error);
            }
            return { ok: true, action, ...result };
        }
        catch (error) {
            deps.log('[sync] 设置页操作失败：', error instanceof Error ? error.message : error);
            return { ok: false, reason: 'sync-failed' };
        }
    });
    /** 同步目录与最近一次导出 / 合并时间：设置页只读展示，不提供远端地址。 */
    register('pet:sync:info', async () => {
        const prefs = await deps.getSyncPrefs();
        const sync = deps.getSettingsSync();
        return {
            ok: true,
            enabled: sync !== null,
            dir: sync?.dir ?? '',
            node: sync?.node ?? '',
            lastExportAt: prefs.lastExportAt,
            lastPullAt: prefs.lastPullAt
        };
    });
    /**
     * 换同步目录：只写本机路径偏好并重建实例。
     * 不迁移、不删除旧目录里的包，避免把使用者已有的同步数据当成临时文件处理。
     */
    register('pet:sync:chooseDir', async () => {
        const picked = await deps.dialog.showOpenDialog({
            title: '选择同步目录',
            properties: ['openDirectory', 'createDirectory']
        });
        if (picked.canceled || picked.filePaths.length === 0)
            return { ok: false, reason: 'canceled' };
        await deps.saveSyncPrefs({ dir: picked.filePaths[0] });
        await deps.initSettingsSync();
        deps.log('[sync] 同步目录已切换：', deps.getSettingsSync()?.dir ?? '');
        return { ok: true, dir: deps.getSettingsSync()?.dir ?? '' };
    });
    /**
     * 同步口令：只用来给同步包里的敏感字段加一层密文。
     *
     * 明文只在这里出现一次，随后进加密仓库；状态接口只回「是否已配置」和掩码。
     * 口令本身不进 settings.json，也不进同步包。
     */
    register('pet:sync:setPassphrase', async (_event, payload) => {
        const value = typeof payload?.passphrase === 'string' ? payload.passphrase : '';
        if (value.trim().length < deps.minPassphraseLength) {
            return { ok: false, reason: 'passphrase-too-short' };
        }
        try {
            await deps
                .requireSecretStore()
                .set(deps.syncSecretService, value.trim(), deps.syncSecretField);
            deps.log('[sync] 已设置同步口令');
            return { ok: true };
        }
        catch (error) {
            deps.log('[sync] 保存同步口令失败：', error instanceof Error ? error.message : error);
            return { ok: false, reason: 'vault-unavailable' };
        }
    });
    register('pet:sync:clearPassphrase', async () => {
        try {
            await deps.requireSecretStore().clear(deps.syncSecretService, deps.syncSecretField);
            deps.log('[sync] 已清除同步口令；后续包不再带密文字段');
            return { ok: true };
        }
        catch (error) {
            deps.log('[sync] 清除同步口令失败：', error instanceof Error ? error.message : error);
            return { ok: false, reason: 'vault-unavailable' };
        }
    });
}
