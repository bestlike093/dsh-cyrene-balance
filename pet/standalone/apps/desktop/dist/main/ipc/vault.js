import { writeExportFile } from './lib/exportFile.js';
export function registerVaultChannels(deps) {
    const register = deps.registerChannel;
    // 手动轮换：换一把数据密钥供后续写入，旧钥匙继续留在 ring 里；
    // 旧数据靠 allowLegacyEpoch 读取，所以读取路径显式放行了旧 epoch。
    register('pet:vault:rotate', async () => {
        const vault = deps.getVault();
        const client = deps.getVaultClient();
        if (vault === null || client === null) {
            return { ok: false, reason: 'vault-unavailable', message: '加密仓库没有装配成功' };
        }
        try {
            const result = await client.rotate();
            deps.log('[vault] 已轮换密钥', `epoch=${result.from}->${result.to}`);
            return { ok: true, from: result.from, to: result.to };
        }
        catch (error) {
            return { ok: false, reason: 'failed', message: deps.describeError(error) };
        }
    });
    register('pet:vault:diagnose', async () => {
        const vault = deps.getVault();
        if (vault === null) {
            return { ok: false, code: 'VAULT_UNAVAILABLE', message: '加密仓库没有装配成功' };
        }
        return {
            ok: true,
            ...(await vault.diagnose()),
            legacyKeyMigration: deps.getLegacyKeyMigrationWarning()
        };
    });
    register('pet:vault:export', async (_event, payload) => {
        const vault = deps.getVault();
        if (vault === null) {
            return { ok: false, reason: 'vault-unavailable', message: '加密仓库没有装配成功' };
        }
        const password = typeof payload?.password === 'string' ? payload.password : '';
        if (password.length < 8) {
            return { ok: false, reason: 'weak-password', message: '备份口令至少 8 位' };
        }
        const { canceled, filePath } = await deps.showSaveDialog({
            title: '导出加密备份',
            defaultPath: deps.pathJoin(deps.getDocumentsPath(), `dsh-pet-${new Date().toISOString().slice(0, 10)}.petbackup`),
            filters: [{ name: 'DSH Pet 备份', extensions: ['petbackup'] }]
        });
        if (canceled || filePath === undefined)
            return { ok: false, reason: 'canceled' };
        try {
            const backup = await deps.createVaultBackup({
                ring: vault.ring,
                password,
                files: await deps.readBackupFiles()
            });
            // 与老路径逐字节一致：JSON.stringify 后直接写，不额外包一层。
            await writeExportFile({ writeFile: deps.fs.writeFile, restrictPermissions: deps.restrictPermissions }, filePath, JSON.stringify(backup));
            deps.log('[backup] 已导出', `files=${backup.files.length}`);
            // 只回文件名，绝对路径留在主进程：渲染侧不需要，也不该拿到。
            return { ok: true, fileName: deps.pathBasename(filePath), fileCount: backup.files.length };
        }
        catch (error) {
            return { ok: false, reason: 'failed', message: deps.describeError(error) };
        }
    });
    register('pet:vault:import', async (_event, payload) => {
        const vault = deps.getVault();
        if (vault === null) {
            return { ok: false, reason: 'vault-unavailable', message: '加密仓库没有装配成功' };
        }
        const password = typeof payload?.password === 'string' ? payload.password : '';
        if (password.length < 8) {
            return { ok: false, reason: 'weak-password', message: '备份口令至少 8 位' };
        }
        const { canceled, filePaths } = await deps.showOpenDialog({
            title: '选择 .petbackup 备份',
            properties: ['openFile'],
            filters: [{ name: 'DSH Pet 备份', extensions: ['petbackup'] }]
        });
        if (canceled || filePaths.length === 0)
            return { ok: false, reason: 'canceled' };
        // 先完整解包并校验；任何一步失败都在写盘前返回，避免半拉子覆盖。
        let restored = null;
        try {
            const raw = JSON.parse(await deps.fs.readFile(filePaths[0], 'utf8'));
            restored = await deps.openVaultBackup(raw, password);
        }
        catch (error) {
            return { ok: false, reason: 'invalid-backup', message: deps.describeError(error) };
        }
        // 覆盖前先留一份本地快照：选错文件或中途失败时还能退回去。
        const rollbackDir = deps.pathJoin(deps.userData, `import-rollback-${Date.now()}`);
        try {
            await deps.fs.mkdir(rollbackDir, { recursive: true });
            for (const name of deps.backupFiles) {
                await deps.fs
                    .copyFile(deps.pathJoin(deps.userData, name), deps.pathJoin(rollbackDir, name))
                    .catch(() => undefined);
            }
            await deps.writeRestoredKeyRing({
                path: deps.vaultKeysPath,
                backend: deps.getVaultBackend(),
                suite: deps.cryptoSuite,
                keys: restored.keys,
                signer: restored.signer
            });
            for (const file of restored.files) {
                if (!deps.backupFiles.includes(file.name))
                    continue;
                const target = deps.pathJoin(deps.userData, file.name);
                await deps.fs.writeFile(target, file.data);
                await deps.restrictPermissions(target);
            }
            deps.log('[backup] 已导入', `keys=${restored.keys.length}`, `files=${restored.files.length}`);
            // 内存里的旧密钥已经和新文件错位：先停写，再自动重启，避免把旧密钥覆盖回去。
            deps.disableMemory();
            deps.disableChatHistory();
            deps.markMemoryFlushed();
            deps.scheduleRestart();
            return {
                ok: true,
                restartRequired: true,
                rollbackDir,
                fileCount: restored.files.length
            };
        }
        catch (error) {
            return {
                ok: false,
                reason: 'failed',
                message: deps.describeError(error),
                rollbackDir
            };
        }
    });
}
