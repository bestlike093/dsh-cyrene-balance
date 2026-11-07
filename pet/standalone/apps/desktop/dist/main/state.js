// 运行时状态派生值（从 electron/main.mjs 迁出，显式传原始设置值）。
export const PRESENCE_INTERVAL_DEFAULT_MINUTES = 45;
export const PRESENCE_INTERVAL_MIN_MINUTES = 1;
export const PRESENCE_INTERVAL_MAX_MINUTES = 120;
/** 自动开口的间隔，默认 45 分钟，限制在 1–120 分钟。 */
export function presenceIntervalMs(intervalMinutes) {
    const minutes = Number(intervalMinutes);
    const safe = Number.isFinite(minutes)
        ? Math.min(Math.max(minutes, PRESENCE_INTERVAL_MIN_MINUTES), PRESENCE_INTERVAL_MAX_MINUTES)
        : PRESENCE_INTERVAL_DEFAULT_MINUTES;
    return safe * 60 * 1000;
}
