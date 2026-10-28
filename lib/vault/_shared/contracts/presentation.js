/**
 * 表现层三端口共享契约（文档第 10 章 / 10.1b–10.1d）。
 *
 * 主题 / 字体 / 风格三个端口的共同要求在这里定义一次：
 * 校验与应用分离、广播收发分离、令牌路径统一、错误码枚举。
 * 端口各自只声明特有成员，不再重复声明这些。
 */
/** `FieldErrorV1.field` 表示「整体错误」时的取值；空串与「字段缺失」无法区分。 */
export const WHOLE_FIELD = '$';
/** 令牌点分路径的合法前缀；各端口不得自造。 */
export const TOKEN_PREFIX = {
    colors: 'colors',
    radius: 'radius',
    spacing: 'spacing',
    motion: 'motion',
    font: 'font'
};
//# sourceMappingURL=presentation.js.map