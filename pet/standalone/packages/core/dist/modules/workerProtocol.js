import { ErrorCode } from '@pet/shared';
export function isWorkerMessage(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const type = value.type;
    return typeof type === 'string';
}
/** 把跨线程传来的字符串错误码收回成 ErrorCode，未知值统一按 LOAD_FAILED。 */
export function toErrorCode(code) {
    const values = Object.values(ErrorCode);
    return code !== undefined && values.includes(code) ? code : ErrorCode.LOAD_FAILED;
}
