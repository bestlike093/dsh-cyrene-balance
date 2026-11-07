import { writeExportFile } from './lib/exportFile.js';
/** 旧契约返回布尔，迁移期在通道层归一化；新契约直接返回对象。 */
function normalizeClearResult(result) {
    if (result === true)
        return { ok: true };
    if (result !== null && typeof result === 'object') {
        if (result.ok === true)
            return { ok: true };
        return { ok: false, reason: String(result.reason ?? 'persist-failed') };
    }
    return { ok: false, reason: 'persist-failed' };
}
export function registerChatChannels(deps) {
    // 保持行首 register('…') 形式，契约门禁按这个口径扫描注册面。
    const register = deps.registerChannel;
    register('pet:chat:send', async (_event, payload) => {
        // 与迁移前一致：payload 缺失时补空对象，交给 chatService 判空。
        const input = (payload ?? {});
        const said = typeof input.text === 'string' ? input.text : '';
        // 先拍再回：她嘴里的「拍好了」要配得上一张真的照片。
        // 没拍成也不拦这句话，只是把失败原因捎回界面，由界面自己说清楚。
        const shot = typeof deps.takePhotoIfAsked === 'function' ? await deps.takePhotoIfAsked(said) : null;
        const result = (await deps.getChatService().send(input));
        if (shot === null || shot === undefined)
            return result;
        const base = result !== null && typeof result === 'object' ? result : { ok: false, reason: 'request-failed' };
        if (base.ok !== true)
            return base;
        if (shot.ok === true && shot.photo !== undefined)
            return { ...base, photo: shot.photo };
        return { ...base, photoFailed: String(shot.reason ?? 'capture-failed') };
    });
    register('pet:chat:clear', async () => {
        return normalizeClearResult(await deps.getChatService().clear());
    });
    /** 导出聊天记录：只在用户主动点击时写文件，内容不改动。 */
    register('pet:chat:export', async () => {
        const turns = deps.getChatService().history();
        if (turns.length === 0)
            return { ok: false, code: 'CHAT_EMPTY' };
        const stamp = new Date().toISOString().slice(0, 10);
        const { canceled, filePath } = await deps.showSaveDialog({
            title: '导出聊天记录',
            defaultPath: deps.pathJoin(deps.getDocumentsPath(), `昔涟聊天记录-${stamp}.md`),
            filters: [{ name: 'Markdown', extensions: ['md'] }]
        });
        if (canceled || typeof filePath !== 'string' || filePath === '') {
            return { ok: false, canceled: true };
        }
        const lines = [
            '# 昔涟 · 聊天记录',
            '',
            `导出时间：${new Date().toLocaleString('zh-CN')}`,
            `共 ${turns.length} 条`,
            ''
        ];
        for (const turn of turns) {
            const who = turn.role === 'user' ? '我' : '昔涟';
            lines.push(`## ${who}`, '', String(turn.content ?? ''), '');
        }
        try {
            await writeExportFile(deps.fs, filePath, lines.join('\n'), 'utf8');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log('[chat] 导出失败：', message);
            return { ok: false, code: 'WRITE_FAILED', message };
        }
        return { ok: true, path: filePath, count: turns.length };
    });
    register('pet:chat:open', () => {
        deps.openChatWindow();
        return true;
    });
}
