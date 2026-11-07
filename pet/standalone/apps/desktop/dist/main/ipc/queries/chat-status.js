/**
 * chat:status 只做本地同步短路，远端可达性单独走 stale 分支。
 *
 * 短路三件：能力开关、聊天上下文、缓存 TTL。三者都不触发探活。
 * TTL 未命中时先返回旧快照（stale=true），再 fire-and-forget 探活并只回写缓存。
 * 这里只吐 chat.state.* 码，文案统一在 renderer/reason-text.js。
 */
export const CHAT_STATUS_TTL_MS = 10_000;
const CHAT_STATE_PREFIX = 'chat.state.';
const SUPPORTED_CHAT_PROVIDERS = new Set(['deepseek']);
function project(snapshot, state, stale, checkedAt) {
    const provider = typeof snapshot?.provider === 'string' && snapshot.provider !== '' ? snapshot.provider : null;
    const model = typeof snapshot?.model === 'string' && snapshot.model !== '' ? snapshot.model : null;
    const historyCount = typeof snapshot?.historyCount === 'number' ? snapshot.historyCount : 0;
    return {
        ok: true,
        state,
        stale,
        reason: `${CHAT_STATE_PREFIX}${state}`,
        checkedAt,
        provider,
        model,
        historyCount,
        busy: snapshot?.busy === true
    };
}
export function registerChatStatus(deps) {
    const register = deps.registerChannel;
    let cache = null;
    let probing = false;
    const probe = (snapshot) => {
        if (probing)
            return;
        probing = true;
        void deps
            .probeChat()
            .then((result) => {
            const state = result?.ok === true ? 'ready' : 'stale';
            cache = {
                at: deps.now(),
                value: project(snapshot, state, state === 'stale', deps.now())
            };
        })
            .catch((error) => {
            deps.log('[chat] status probe failed:', error instanceof Error ? error.message : String(error));
            cache = {
                at: deps.now(),
                value: project(snapshot, 'stale', true, deps.now())
            };
        })
            .finally(() => {
            probing = false;
        });
    };
    register('pet:chat:status', () => {
        const snapshot = deps.getChatSnapshot();
        if (snapshot === null)
            return project(null, 'no-context', false, null);
        if (snapshot.enabled !== true)
            return project(snapshot, 'disabled', false, null);
        const provider = typeof snapshot.provider === 'string' ? snapshot.provider : '';
        if (!SUPPORTED_CHAT_PROVIDERS.has(provider)) {
            return project(snapshot, 'no-context', false, null);
        }
        if (cache !== null && deps.now() - cache.at < CHAT_STATUS_TTL_MS) {
            return cache.value;
        }
        probe(snapshot);
        if (cache !== null) {
            return { ...cache.value, stale: true };
        }
        return project(snapshot, 'unknown', true, null);
    });
}
