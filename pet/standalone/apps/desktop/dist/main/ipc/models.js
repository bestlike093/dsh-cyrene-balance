export function registerModelChannels(deps) {
    const register = deps.registerChannel;
    /**
     * 导入模型。payload.kind 决定弹哪种选择框：
     * - zip：选一个压缩包，由主进程解压
     * - folder：选一个已经解压好的文件夹
     * 导入成功后直接切换过去，省掉「导入完还要再点一次」。
     */
    register('pet:models:import', async (_event, payload) => {
        const kind = payload?.kind === 'folder' ? 'folder' : 'zip';
        const picked = await deps.dialog.showOpenDialog(deps.getDialogParent(), {
            title: kind === 'zip' ? '选择模型压缩包（.zip）' : '选择模型文件夹',
            properties: kind === 'zip' ? ['openFile'] : ['openDirectory'],
            ...(kind === 'zip' ? { filters: [{ name: '压缩包', extensions: ['zip'] }] } : {})
        });
        if (picked.canceled || picked.filePaths.length === 0) {
            return { ok: false, canceled: true };
        }
        const source = picked.filePaths[0];
        const startedAt = Date.now();
        try {
            const imported = kind === 'zip'
                ? await deps.modelStore.importFromZip(source)
                : await deps.modelStore.importFromDirectory(source);
            deps.log('[models] 导入完成：', imported.id, `${Date.now() - startedAt}ms`);
            const next = { ...deps.getSettings(), live2dModelId: imported.id };
            deps.setSettings(next);
            await deps.writeJson(deps.settingsPath, next);
            deps.broadcastSettings(next);
            return {
                ok: true,
                model: { ...imported, url: deps.modelStore.toMediaUrl(imported) },
                models: await deps.modelStore.list()
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[models] 导入失败：', message);
            return { ok: false, message };
        }
    });
    /** 切换当前模型；空串表示「不使用模型」，桌宠回到空态引导。 */
    register('pet:models:setActive', async (_event, modelId) => {
        const id = typeof modelId === 'string' ? modelId.trim() : '';
        if (id !== '') {
            const models = await deps.modelStore.list();
            const hit = models.find((item) => item.id === id);
            if (hit === undefined)
                return { ok: false, message: '找不到这个模型' };
            if (!hit.valid)
                return { ok: false, message: hit.reason ?? '模型文件不完整' };
        }
        const next = { ...deps.getSettings(), live2dModelId: id };
        deps.setSettings(next);
        await deps.writeJson(deps.settingsPath, next);
        deps.broadcastSettings(next);
        return { ok: true, live2dModelId: id };
    });
    /** 在资源管理器里打开模型目录，方便使用者自己看/清。 */
    register('pet:models:openFolder', async () => {
        await deps.modelStore.ensureRoot();
        const error = await deps.openPath(deps.mediaRoot);
        return error === '' ? { ok: true } : { ok: false, message: error };
    });
}
