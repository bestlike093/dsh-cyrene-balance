const MAX_SCOPE_LENGTH = 120;
const MAX_NOTE_LENGTH = 60;
/** 允许从设置页直接落到某个分区；未知值按默认页打开。 */
const OPEN_TABS = new Set(['today', 'mind', 'bonds', 'memory']);
function cleanText(value, max) {
    if (typeof value !== 'string')
        return '';
    return value.trim().slice(0, max);
}
/** 好感动作只认字符串 scope；空串回落到桌面那一份。 */
function readScope(payload) {
    if (payload === null || typeof payload !== 'object')
        return 'desktop';
    if (payload.scope === undefined || payload.scope === null)
        return 'desktop';
    if (typeof payload.scope !== 'string')
        return null;
    const scope = payload.scope.trim();
    if (scope === '')
        return 'desktop';
    if (scope.length > MAX_SCOPE_LENGTH)
        return null;
    return scope;
}
export function registerInsightChannels(deps) {
    const register = deps.registerChannel;
    register('pet:insight:open', (_event, payload) => {
        const tab = typeof payload?.tab === 'string' ? payload.tab : '';
        deps.openWindow(OPEN_TABS.has(tab) ? tab : undefined);
        return { ok: true };
    });
    /** 整份快照；force=true 时跳过 500ms 缓存，用于手动刷新。 */
    register('pet:insight:snapshot', async (_event, payload) => {
        try {
            const snapshot = await deps.insight.snapshot({ force: payload?.force === true });
            return { ok: true, snapshot };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.('[insight] 读取快照失败：', message);
            return { ok: false, code: 'SNAPSHOT_FAILED', message };
        }
    });
    /** 直接设定好感；非法值由 affinity 自己挡掉，不会误清零。 */
    register('pet:insight:set-favor', (_event, payload) => {
        const scope = readScope(payload);
        if (scope === null)
            return { ok: false, code: 'INVALID_SCOPE' };
        if (typeof payload?.value !== 'number' || !Number.isFinite(payload.value)) {
            return { ok: false, code: 'INVALID_VALUE' };
        }
        try {
            const state = deps.affinity.setFavor(payload.value, {
                scope,
                note: cleanText(payload?.note, MAX_NOTE_LENGTH) || '手动设定'
            });
            deps.insight.invalidate?.();
            return { ok: true, scope, state };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.('[insight] 设定好感失败：', message);
            return { ok: false, code: 'SET_FAVOR_FAILED', message };
        }
    });
    /** 加减好感；正数加、负数减，越界由 affinity 夹到 0–100。 */
    register('pet:insight:adjust-favor', (_event, payload) => {
        const scope = readScope(payload);
        if (scope === null)
            return { ok: false, code: 'INVALID_SCOPE' };
        if (typeof payload?.delta !== 'number' || !Number.isFinite(payload.delta)) {
            return { ok: false, code: 'INVALID_DELTA' };
        }
        if (payload.delta === 0)
            return { ok: false, code: 'NO_CHANGE' };
        try {
            const state = deps.affinity.adjustFavor(payload.delta, {
                scope,
                note: cleanText(payload?.note, MAX_NOTE_LENGTH) || '手动调整'
            });
            deps.insight.invalidate?.();
            return { ok: true, scope, state };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.('[insight] 调整好感失败：', message);
            return { ok: false, code: 'ADJUST_FAVOR_FAILED', message };
        }
    });
    /** 锁住或解锁：锁住后模型评估不再改动 favor。 */
    register('pet:insight:lock-favor', (_event, payload) => {
        const scope = readScope(payload);
        if (scope === null)
            return { ok: false, code: 'INVALID_SCOPE' };
        if (typeof payload?.locked !== 'boolean')
            return { ok: false, code: 'INVALID_LOCKED' };
        try {
            const state = deps.affinity.setLocked(payload.locked, { scope });
            deps.insight.invalidate?.();
            return { ok: true, scope, state };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.('[insight] 锁定好感失败：', message);
            return { ok: false, code: 'LOCK_FAVOR_FAILED', message };
        }
    });
    /**
     * 把某个会话的好感归零并解锁。
     * 只影响这一个 scope，桌面与其它群各归各的。
     */
    register('pet:insight:reset-scope', (_event, payload) => {
        const scope = readScope(payload);
        if (scope === null)
            return { ok: false, code: 'INVALID_SCOPE' };
        try {
            deps.affinity.setLocked(false, { scope });
            const state = deps.affinity.setFavor(0, {
                scope,
                note: cleanText(payload?.note, MAX_NOTE_LENGTH) || '重置这段关系'
            });
            deps.insight.invalidate?.();
            return { ok: true, scope, state };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.('[insight] 重置会话失败：', message);
            return { ok: false, code: 'RESET_SCOPE_FAILED', message };
        }
    });
    /** 删除一条记忆；只接受明文 id，拒绝整批清空。 */
    register('pet:insight:delete-memory', (_event, payload) => {
        const id = cleanText(payload?.id, 120);
        if (id === '')
            return { ok: false, code: 'INVALID_ID' };
        try {
            const result = deps.memory.remove(id);
            deps.insight.invalidate?.();
            return {
                ok: result?.ok === true,
                removed: result?.removed === true,
                reason: typeof result?.reason === 'string' ? result.reason : null,
                total: Number(result?.total) || 0
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.('[insight] 删除记忆失败：', message);
            return { ok: false, code: 'DELETE_FAILED', message };
        }
    });
}
