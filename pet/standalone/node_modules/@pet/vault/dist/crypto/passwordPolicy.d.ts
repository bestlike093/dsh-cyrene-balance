/**
 * 口令强度下限。
 *
 * 慢哈希能把「几秒钟」拖成「几分钟」，拖不成「几百年」。
 * 所以这里拦的是「显然撑不住」的那一类，不追求评分卡。
 *
 * 只在**新库第一次落盘**时强制。已有仓库也卡校验会把人锁在门外，
 * 那种「安全」没有意义。
 */
/** 低于这个长度直接拒。 */
export declare const MIN_PASSWORD_LENGTH = 8;
/** 至少要有几类字符同时出现。 */
export declare const MIN_PASSWORD_CLASSES = 2;
export interface PasswordPolicyResult {
    readonly ok: boolean;
    /** 不通过的原因，给 UI 直接显示。通过时为空数组。 */
    readonly reasons: readonly string[];
}
/** 判断口令够不够硬。纯函数，不读环境、不碰文件。 */
export declare function evaluatePassword(password: string): PasswordPolicyResult;
/** 不达标就抛 PetError，错误码沿用 INVALID_ARGUMENT，调用方不必新增分支。 */
export declare function assertPasswordStrength(password: string): void;
