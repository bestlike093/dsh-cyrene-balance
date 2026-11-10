/**
 * 口令强度下限。
 *
 * 慢哈希能把「几秒钟」拖成「几分钟」，拖不成「几百年」。
 * 所以这里拦的是「显然撑不住」的那一类，不追求评分卡。
 *
 * 只在**新库第一次落盘**时强制。已有仓库也卡校验会把人锁在门外，
 * 那种「安全」没有意义。
 */
import { ErrorCode, PetError } from '@pet/shared';
/** 低于这个长度直接拒。 */
export const MIN_PASSWORD_LENGTH = 8;
/** 至少要有几类字符同时出现。 */
export const MIN_PASSWORD_CLASSES = 2;
/** 常见弱口令。不做全量字典，只挡最容易被先试到的那一批。 */
const WEAK_PASSWORDS = [
    'password',
    'password1',
    'password123',
    '12345678',
    '123456789',
    '1234567890',
    'qwertyui',
    'qwerty123',
    'abc12345',
    'iloveyou',
    'admin123',
    'letmein1',
    'welcome1',
    'passw0rd',
    'zxcvbnm1',
    'a1234567',
    '11111111',
    '00000000',
    '88888888'
];
function characterClasses(password) {
    let classes = 0;
    if (/[a-z]/.test(password))
        classes += 1;
    if (/[A-Z]/.test(password))
        classes += 1;
    if (/[0-9]/.test(password))
        classes += 1;
    if (/[^A-Za-z0-9]/.test(password))
        classes += 1;
    return classes;
}
/** 判断口令够不够硬。纯函数，不读环境、不碰文件。 */
export function evaluatePassword(password) {
    const reasons = [];
    if (typeof password !== 'string' || password.length === 0) {
        return { ok: false, reasons: ['口令不能为空'] };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        reasons.push(`至少 ${MIN_PASSWORD_LENGTH} 位，当前 ${password.length} 位`);
    }
    if (characterClasses(password) < MIN_PASSWORD_CLASSES) {
        reasons.push('至少混用两类字符（小写、大写、数字、符号）');
    }
    if (new Set(password).size === 1) {
        reasons.push('不能是同一个字符重复');
    }
    if (WEAK_PASSWORDS.includes(password.toLowerCase())) {
        reasons.push('这是常见弱口令，换一个');
    }
    return { ok: reasons.length === 0, reasons };
}
/** 不达标就抛 PetError，错误码沿用 INVALID_ARGUMENT，调用方不必新增分支。 */
export function assertPasswordStrength(password) {
    const result = evaluatePassword(password);
    if (!result.ok) {
        throw new PetError(ErrorCode.INVALID_ARGUMENT, `口令强度不足：${result.reasons.join('；')}`);
    }
}
