function filterMemoryForExport(items, options) {
    const query = typeof options?.query === 'string' ? options.query.trim().toLowerCase() : '';
    const role = options?.role === 'user' || options?.role === 'assistant' ? options.role : '';
    const bound = (raw, endOfDay) => {
        if (typeof raw !== 'string' || raw.trim() === '')
            return null;
        const value = raw.trim();
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
        const parsed = Date.parse(dateOnly ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}` : value);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const fromMs = bound(options?.from, false);
    const toMs = bound(options?.to, true);
    return items.filter((item) => {
        if (role !== '' && item?.role !== role)
            return false;
        if (query !== '' && !String(item?.text ?? '').toLowerCase().includes(query))
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
}
export function registerMemoryChannels(deps) {
    const register = deps.registerChannel;
    /** 导出记忆为脱敏后的 Markdown 或 JSON，路径由用户选择。 */
    register('pet:memory:export', async (_event, payload) => {
        if (!deps.memoryStore.stats().available)
            return { ok: false, code: 'VAULT_UNAVAILABLE' };
        const items = filterMemoryForExport(deps.collectMemoryAll(), payload).map((item) => ({
            ...item,
            text: deps.sanitizeReflectionText(String(item.text ?? ''))
        }));
        if (items.length === 0)
            return { ok: false, code: 'MEMORY_EMPTY' };
        const stamp = new Date().toISOString().slice(0, 10);
        const { canceled, filePath } = await deps.dialog.showSaveDialog({
            title: '导出记忆',
            defaultPath: deps.pathJoin(deps.documentsDir, `昔涟记忆-${stamp}.md`),
            filters: [
                { name: 'Markdown', extensions: ['md'] },
                { name: 'JSON', extensions: ['json'] }
            ]
        });
        if (canceled || typeof filePath !== 'string' || filePath === '') {
            return { ok: false, canceled: true };
        }
        const isJson = filePath.toLowerCase().endsWith('.json');
        const content = isJson
            ? JSON.stringify({
                exportedAt: new Date().toISOString(),
                total: items.length,
                sanitized: true,
                items
            }, null, 2)
            : [
                '# 昔涟 · 记忆导出',
                '',
                `导出时间：${new Date().toLocaleString('zh-CN')}`,
                `共 ${items.length} 条`,
                '文本已脱敏：密钥与本地路径已隐藏。',
                '',
                ...items.map((item) => {
                    const who = item.role === 'user' ? '我' : '昔涟';
                    return `## ${who} · ${item.at ?? ''}\n\n${String(item.text ?? '')}\n`;
                })
            ].join('\n');
        try {
            await deps.writeFile(filePath, content, 'utf8');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[memory] 导出失败：', message);
            return { ok: false, code: 'WRITE_FAILED', message };
        }
        return { ok: true, path: filePath, count: items.length };
    });
    /**
     * 列出结构化事实；按「还活跃的在前、强度高的在前」排。
     * payload.scope / payload.kind 可选：设置页按来源与分类筛选。
     */
    register('pet:memory:facts', async (_event, payload) => {
        if (deps.factStore === undefined)
            return { ok: false, code: 'UNAVAILABLE', facts: [] };
        try {
            await deps.factStore.load();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[memory] 读取结构化事实失败：', message);
            return { ok: false, code: 'LOAD_FAILED', facts: [] };
        }
        const wantedScope = typeof payload?.scope === 'string' ? payload.scope.trim() : '';
        const wantedKind = typeof payload?.kind === 'string' ? payload.kind.trim() : '';
        const snap = deps.factStore.snapshot();
        const all = Array.isArray(snap.facts) ? snap.facts : [];
        const scopeCount = {};
        for (const item of all) {
            const scope = typeof item.scope === 'string' ? item.scope : 'desktop';
            scopeCount[scope] = (scopeCount[scope] ?? 0) + 1;
        }
        const filtered = all.filter((item) => {
            if (wantedKind !== '' && item.kind !== wantedKind)
                return false;
            if (wantedScope === '')
                return true;
            const scope = typeof item.scope === 'string' ? item.scope : 'desktop';
            if (wantedScope === 'all')
                return true;
            if (wantedScope === 'desktop')
                return scope === 'desktop' || scope === 'shared';
            // qq 是聚合筛选：私聊和群聊一起看，但仍不混桌面。
            if (wantedScope === 'qq')
                return scope.startsWith('qq:') || scope === 'shared';
            return scope === wantedScope || scope === 'shared';
        });
        const facts = filtered
            .map((item) => ({
            id: item.id,
            kind: item.kind,
            text: item.text,
            scope: typeof item.scope === 'string' ? item.scope : 'desktop',
            strength: Math.round(Number(item.strength ?? 0) * 10) / 10,
            mentions: Number(item.mentions ?? 0),
            updatedAt: item.updatedAt ?? null,
            archived: item.archived === true
        }))
            .sort((a, b) => Number(a.archived) - Number(b.archived) || b.strength - a.strength);
        return {
            ok: true,
            total: facts.length,
            allTotal: snap.total,
            active: facts.filter((item) => !item.archived).length,
            archived: facts.filter((item) => item.archived).length,
            byScope: scopeCount,
            facts
        };
    });
    /** 删掉一条记错的事实。 */
    register('pet:memory:facts:remove', async (_event, payload) => {
        if (deps.factStore?.remove === undefined)
            return { ok: false, reason: 'unsupported' };
        const id = typeof payload?.id === 'string' ? payload.id : '';
        return deps.factStore.remove(id);
    });
    /** 改一条记错的事实：只换文字，保留来源和强度。 */
    register('pet:memory:facts:update', async (_event, payload) => {
        if (deps.factStore?.update === undefined)
            return { ok: false, reason: 'unsupported' };
        const id = typeof payload?.id === 'string' ? payload.id : '';
        const text = typeof payload?.text === 'string' ? payload.text : '';
        return deps.factStore.update(id, text);
    });
    /** 导出结构化事实为 JSONL，换机或重装时能整份带走。 */
    register('pet:memory:facts:export', async (_event, payload) => {
        if (deps.factStore?.exportJsonl === undefined)
            return { ok: false, code: 'UNSUPPORTED' };
        try {
            await deps.factStore.load();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[memory] 导出结构化事实前读取失败：', message);
            return { ok: false, code: 'LOAD_FAILED', message };
        }
        const scope = typeof payload?.scope === 'string' && payload.scope.trim() !== '' ? payload.scope.trim() : 'all';
        const text = deps.factStore.exportJsonl({
            scope,
            includeArchived: payload?.includeArchived !== false
        });
        if (typeof text !== 'string' || text === '')
            return { ok: false, code: 'MEMORY_EMPTY' };
        const stamp = new Date().toISOString().slice(0, 10);
        const { canceled, filePath } = await deps.dialog.showSaveDialog({
            title: '导出她记住的事',
            defaultPath: deps.pathJoin(deps.documentsDir, `昔涟记忆-${stamp}.jsonl`),
            filters: [
                { name: 'JSON Lines', extensions: ['jsonl'] },
                { name: 'JSON', extensions: ['json'] }
            ]
        });
        if (canceled || typeof filePath !== 'string' || filePath === '') {
            return { ok: false, canceled: true };
        }
        try {
            await deps.writeFile(filePath, text, 'utf8');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[memory] 导出结构化事实失败：', message);
            return { ok: false, code: 'WRITE_FAILED', message };
        }
        return { ok: true, path: filePath, count: text.split('\n').filter((line) => line.trim() !== '').length };
    });
    /** 导入 JSONL：坏行跳过并计数，同 id 的不会被重复写入，导入后立即落盘。 */
    register('pet:memory:facts:import', async (_event, payload) => {
        if (deps.factStore?.importJsonl === undefined)
            return { ok: false, code: 'UNSUPPORTED' };
        if (deps.readFile === undefined || deps.dialog.showOpenDialog === undefined) {
            return { ok: false, code: 'UNSUPPORTED' };
        }
        const { canceled, filePaths } = await deps.dialog.showOpenDialog({
            title: '导入她记住的事',
            properties: ['openFile'],
            filters: [
                { name: 'JSON Lines', extensions: ['jsonl'] },
                { name: 'JSON', extensions: ['json'] },
                { name: '全部文件', extensions: ['*'] }
            ]
        });
        const file = Array.isArray(filePaths) ? filePaths[0] : undefined;
        if (canceled || typeof file !== 'string' || file === '')
            return { ok: false, canceled: true };
        let text = '';
        try {
            text = await deps.readFile(file, 'utf8');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[memory] 读取导入文件失败：', message);
            return { ok: false, code: 'READ_FAILED', message };
        }
        try {
            await deps.factStore.load();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[memory] 导入前读取失败：', message);
            return { ok: false, code: 'LOAD_FAILED', message };
        }
        const result = deps.factStore.importJsonl(text, {
            scope: typeof payload?.scope === 'string' ? payload.scope : 'desktop',
            includeArchived: payload?.includeArchived !== false
        });
        if (result.ok !== true)
            return result;
        try {
            await deps.factStore.flush?.();
        }
        catch (error) {
            // 落盘失败不回滚内存结果：数据已经在，下一次写入会再试。
            deps.log('[memory] 导入后落盘失败：', error instanceof Error ? error.message : String(error));
        }
        return { ...result, path: file };
    });
    /** 删除单条。id 必须来自列表；不认识就回 not-found，不静默成功。 */
    register('pet:memory:delete', async (_event, payload) => {
        if (!deps.memoryStore.stats().available)
            return { ok: false, reason: 'vault-unavailable' };
        const id = typeof payload?.id === 'string' ? payload.id : '';
        return deps.memoryStore.remove(id);
    });
    /**
     * 钉子：把一条记忆锁住，避免降温 / 自动归档。
     * 通道只转发状态，真正的「钉住就不降温」由存储层的 refreshCold / sweep 判断。
     */
    register('pet:memory:pin', async (_event, payload) => {
        if (!deps.memoryStore.stats().available)
            return { ok: false, reason: 'vault-unavailable' };
        if (typeof deps.memoryStore.setPinned !== 'function') {
            return { ok: false, reason: 'unsupported' };
        }
        const id = typeof payload?.id === 'string' ? payload.id : '';
        if (id.trim() === '')
            return { ok: false, reason: 'bad-id' };
        return deps.memoryStore.setPinned(id, payload?.pinned === true);
    });
    register('pet:memory:clear', async () => {
        if (!deps.memoryStore.stats().available)
            return { ok: false, reason: 'vault-unavailable' };
        // memory.clear 的 ok:true 表示「清理请求已处理」，不代表磁盘已确认。
        // store 返回 {ok:false} 或直接 throw 都不向渲染层抛：通道层只保证调用不中断，
        // 磁盘一致性由 store 内部 retry / 原数组恢复保证。这与 chat.clear 的 ok 语义不同。
        try {
            await deps.memoryStore.clear();
            await deps.memoryStore.flush();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[memory] clear 失败：', message);
        }
        return { ok: true };
    });
}
