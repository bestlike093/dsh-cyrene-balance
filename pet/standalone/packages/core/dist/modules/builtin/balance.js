import { ErrorCode, PetError } from '@pet/shared';
const DEFAULT_ENDPOINT = 'https://api.deepseek.com/user/balance';
/** 宿主按这个键读余额快照。改名字要和桌面壳同步。 */
export const BALANCE_SNAPSHOT_KEY = 'balance.snapshot';
/**
 * 把宿主返回的东西压成一份快照。
 *
 * 宿主端口已经把 HTTP 细节消化成结构化结果，这里只做类型收口：
 * 认不出来的形状就记成 bad-payload，让界面能说出「拿不到」而不是显示 NaN。
 */
function normalize(payload) {
    if (typeof payload !== 'object' || payload === null) {
        return { ok: false, reason: 'bad-payload' };
    }
    const data = payload;
    if (data['ok'] !== true) {
        return {
            ok: false,
            reason: typeof data['reason'] === 'string' ? data['reason'] : 'unknown',
            ...(typeof data['message'] === 'string' ? { message: data['message'] } : {})
        };
    }
    return {
        ok: true,
        isAvailable: data['isAvailable'] === true,
        currency: typeof data['currency'] === 'string' ? data['currency'] : 'CNY',
        totalBalance: typeof data['totalBalance'] === 'number' ? data['totalBalance'] : null,
        todaySpent: typeof data['todaySpent'] === 'number' ? data['todaySpent'] : null
    };
}
/**
 * 余额模块：只读网络，不写配置。
 *
 * bootstrap 拉一次余额，把结果写进 memory 快照，宿主读快照渲染状态栏和气泡。
 * 没配 Key、网络失败都只记进快照、不抛错 —— 缺钥匙是正常状态，
 * 抛出去会在界面底部留一张占位卡，那属于噪音。
 *
 * 真正的请求在宿主侧完成：沙箱拿到的 net.fetch 只认余额这一个端点，
 * Key 也只在主进程里短暂存在。
 */
export const balanceModule = {
    meta: {
        id: 'builtin.balance',
        name: '余额',
        version: '1.1.0',
        permissions: ['net.egress', 'memory.write'],
        // 一般模块：它只是查余额，用户主动配置才启用。
        // `net.egress` 是这项权限本身要单独授权，不代表整个模块是危险级 ——
        // 把已有的余额功能降成默认关闭，等于替用户改了现状。
        tier: 'general'
    },
    async bootstrap(ctx) {
        const sandbox = ctx;
        const net = sandbox.api.net;
        if (net === undefined) {
            throw new PetError(ErrorCode.PERMISSION_DENIED, '余额模块缺少 net.egress');
        }
        const memory = sandbox.api.memory;
        if (memory?.write === undefined) {
            throw new PetError(ErrorCode.PERMISSION_DENIED, '余额模块缺少 memory.write');
        }
        const configured = sandbox.config.options['endpoint'];
        const endpoint = typeof configured === 'string' && configured.length > 0 ? configured : DEFAULT_ENDPOINT;
        let snapshot;
        try {
            const response = (await net.fetch(endpoint, { method: 'GET' }));
            const payload = response?.ok === true && typeof response.json === 'function'
                ? await response.json()
                : { ok: false, reason: 'request-failed' };
            snapshot = normalize(payload);
        }
        catch (error) {
            snapshot = {
                ok: false,
                reason: 'fetch-failed',
                message: error instanceof Error ? error.message : String(error)
            };
        }
        await memory.write(BALANCE_SNAPSHOT_KEY, { ...snapshot, at: Date.now() });
    },
    async teardown() {
        // 快照留在 memory 里不删：下次启动读不到网络时，还能先显示上一次的数字。
    }
};
