export declare const PRESENCE_INTERVAL_DEFAULT_MINUTES = 45;
export declare const PRESENCE_INTERVAL_MIN_MINUTES = 1;
export declare const PRESENCE_INTERVAL_MAX_MINUTES = 120;
/** 自动开口的间隔，默认 45 分钟，限制在 1–120 分钟。 */
export declare function presenceIntervalMs(intervalMinutes: unknown): number;
