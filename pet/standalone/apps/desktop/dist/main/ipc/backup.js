export function registerBackupChannels(deps) {
    const register = deps.registerChannel;
    /** 找当前备份目录里最新的一份，给设置页和恢复页说明「文件在哪」。 */
    register('pet:backup:findLatest', async () => {
        const prefs = await deps.getBackupPrefs();
        const dir = prefs.dir === '' ? deps.getDocumentsPath() : prefs.dir;
        const entries = await deps.fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        let latest = null;
        for (const entry of entries) {
            if (!entry.isFile() || !/^dsh-pet-.+\.petbackup$/.test(entry.name))
                continue;
            const full = deps.pathJoin(dir, entry.name);
            const stat = await deps.fs.stat(full).catch(() => null);
            if (stat === null)
                continue;
            if (latest === null || stat.mtimeMs > latest.mtime) {
                latest = { path: full, mtime: stat.mtimeMs };
            }
        }
        if (latest === null) {
            return { ok: true, found: false, dir, path: '', fileName: '', mtime: '' };
        }
        return {
            ok: true,
            found: true,
            dir,
            path: latest.path,
            fileName: deps.pathBasename(latest.path),
            mtime: new Date(latest.mtime).toISOString()
        };
    });
    register('pet:backup:setAuto', async (_event, payload) => {
        const intervalDays = Number(payload?.intervalDays);
        if (!Number.isInteger(intervalDays) || intervalDays < 0 || intervalDays > 365) {
            return {
                ok: false,
                reason: 'invalid-interval',
                message: '自动备份间隔需在 0–365 天之间（0 表示关闭）'
            };
        }
        if (intervalDays === 0) {
            await deps.removeAutoSecret();
            await deps.saveBackupPrefs({ autoIntervalDays: 0, autoStored: false, autoLastError: '' });
            return { ok: true, intervalDays: 0, hasPassword: false };
        }
        const provided = typeof payload?.password === 'string' ? payload.password : '';
        if (provided.length > 0 && provided.length < 8) {
            return { ok: false, reason: 'weak-password', message: '自动备份口令至少 8 位' };
        }
        const password = provided.length > 0 ? provided : await deps.readAutoPassword();
        if (password.length < 8) {
            return { ok: false, reason: 'need-password', message: '自动备份需要先输入一次备份口令' };
        }
        // 只有口令确实写进系统加密存储后才落开关；否则重启后会「开着但跑不了」。
        if (provided.length > 0 && !(await deps.writeAutoPassword(provided))) {
            return {
                ok: false,
                reason: 'encryption-unavailable',
                message: '本机系统加密不可用，无法安全保存自动备份口令'
            };
        }
        await deps.saveBackupPrefs({ autoIntervalDays: intervalDays, autoStored: true, autoLastError: '' });
        return { ok: true, intervalDays, hasPassword: true };
    });
}
