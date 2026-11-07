// 错误文案（从 electron/main.mjs 迁出）。
export function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
