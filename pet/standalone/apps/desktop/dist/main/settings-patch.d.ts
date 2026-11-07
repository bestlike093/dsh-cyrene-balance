type Dict = Record<string, unknown>;
export declare function mergeLayer(base: unknown, patch: unknown): unknown;
export declare const SETTINGS_TOP_KEYS: ReadonlySet<string>;
export declare function sanitizeSettingsPatch(patch: unknown): Dict;
export {};
