import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ErrorCode } from './_shared/index.js';
import { createFileKeyRing, restrictPermissions } from './crypto/fileKeyRing.js';
import { createSystemKeyBackend } from './crypto/keyBackend.js';
const LOCAL_STATE_VERSION = 1;
async function loadLocalState(path) {
    if (path === undefined)
        return {};
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (parsed.version !== LOCAL_STATE_VERSION)
            return {};
        return typeof parsed.acknowledgedBackend === 'string'
            ? { acknowledgedBackend: parsed.acknowledgedBackend }
            : {};
    }
    catch {
        // 不存在或已损坏：一律当作未确认，不把损坏文件当成有效凭据。
        return {};
    }
}
async function saveLocalState(path, state) {
    if (path === undefined)
        return;
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify({ version: LOCAL_STATE_VERSION, ...state }), {
        encoding: 'utf8',
        mode: 0o600
    });
    await rename(temp, path);
    await restrictPermissions(path);
}
/**
 * 装配工厂：只依赖 KeyRing / KeyBackend 两个抽象。
 * 诊断先接，装配后接；`secure=false` 是保护失效，诊断级别固定为 error（❌）。
 */
export async function createVault(options) {
    const backend = options.backend ?? (await createSystemKeyBackend(options.safeStorage));
    const ring = await createFileKeyRing({
        path: options.keyFilePath,
        backend,
        suite: options.suite
    });
    const localState = await loadLocalState(options.stateFilePath);
    /** 已确认的后端身份；来源是本机 state.json 或本次运行的显式确认。 */
    let acknowledgedKey = localState.acknowledgedBackend ?? null;
    let recoveryAudited = false;
    const buildDiagnostic = async () => {
        const diagnostic = await ring.diagnostics();
        const key = `${diagnostic.backend}:${String(diagnostic.secure)}`;
        // 后端一变，旧确认立即作废；同步清掉本机状态，切回旧后端也不会复活。
        if (acknowledgedKey !== null && acknowledgedKey !== key) {
            acknowledgedKey = null;
            await saveLocalState(options.stateFilePath, {});
        }
        // 密钥文件解不开时只发生一次系统级恢复：留证据、写审计，绝不静默继续。
        if (!recoveryAudited && diagnostic.recoveredFrom !== undefined) {
            recoveryAudited = true;
            await options.audit?.append('tamper_detected', {
                code: ErrorCode.VAULT_TAMPERED,
                backend: diagnostic.backend,
                source: 'system',
                backupPath: diagnostic.recoveredFrom,
                ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
                note: '密钥文件无法解开：已改名保留证据并重新初始化'
            });
        }
        if (!diagnostic.secure) {
            return {
                ...diagnostic,
                severity: 'error',
                code: 'KEY_BACKEND_INSECURE',
                kind: 'secure',
                group: 'credential',
                acknowledged: acknowledgedKey === key,
                message: '密钥后端不提供真实保护（secure=false），用户必须在设置中显式确认后才能继续'
            };
        }
        if (diagnostic.permission !== 'ok') {
            return {
                ...diagnostic,
                severity: 'error',
                code: 'KEY_FILE_PERMISSION',
                kind: 'secure',
                group: 'credential',
                acknowledged: false,
                message: `密钥文件权限异常：${diagnostic.permission}`
            };
        }
        return {
            ...diagnostic,
            severity: 'ok',
            code: 'OK',
            kind: 'secure',
            group: 'credential',
            // 后端安全时没有待确认项；保持 false，避免「一次确认」被误读为持续有效。
            acknowledged: false,
            message: '密钥后端与文件权限正常'
        };
    };
    return {
        ring,
        diagnose: buildDiagnostic,
        async acknowledgeInsecure() {
            const diagnostic = await ring.diagnostics();
            if (!diagnostic.secure) {
                // 先写审计，再落本机状态，最后置内存；任一步失败都不算确认成功。
                await options.audit?.append('key_backend_insecure', {
                    backend: diagnostic.backend,
                    keyId: ring.current().keyId,
                    source: 'user',
                    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
                    note: '用户显式确认不安全密钥后端'
                });
                const key = `${diagnostic.backend}:${String(diagnostic.secure)}`;
                await saveLocalState(options.stateFilePath, { acknowledgedBackend: key });
                acknowledgedKey = key;
            }
            return buildDiagnostic();
        }
    };
}
//# sourceMappingURL=vaultFactory.js.map