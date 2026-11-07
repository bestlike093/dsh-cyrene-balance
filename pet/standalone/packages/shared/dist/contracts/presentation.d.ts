/**
 * 表现层三端口共享契约（文档第 10 章 / 10.1b–10.1d）。
 *
 * 主题 / 字体 / 风格三个端口的共同要求在这里定义一次：
 * 校验与应用分离、广播收发分离、令牌路径统一、错误码枚举。
 * 端口各自只声明特有成员，不再重复声明这些。
 */
/** `FieldErrorV1.field` 表示「整体错误」时的取值；空串与「字段缺失」无法区分。 */
export declare const WHOLE_FIELD = "$";
/** 令牌点分路径的合法前缀；各端口不得自造。 */
export declare const TOKEN_PREFIX: {
    readonly colors: "colors";
    readonly radius: "radius";
    readonly spacing: "spacing";
    readonly motion: "motion";
    readonly font: "font";
};
export type TokenPrefixV1 = (typeof TOKEN_PREFIX)[keyof typeof TOKEN_PREFIX];
/**
 * 校验失败的机器可读原因。
 * 枚举而非自由字符串：UI 要按类型映射文案（且可翻译），测试要断言稳定值。
 *
 * `UNKNOWN_TOKEN` 与 `INVALID_TOKEN` 必须分开 —— 前者是名字不存在（可能拼错），
 * 后者是值不合法（格式错），给用户的提示完全不同。
 */
/**
 * 后两个码的语义：
 * - `NO_FALLBACK_AVAILABLE`：字体回退链也构造不出来，正常路径不应出现；
 * - `INVALID_RESOURCE`：字体魔数校验失败（register 阶段的第二道校验）。
 *
 * 注：不要在这些成员之间夹注释 —— union 必须连续，解析器才不会漏记。
 */
export type PresentationErrorV1 = 'INVALID_COLOR' | 'INVALID_FAMILY' | 'INVALID_TOKEN' | 'UNKNOWN_TOKEN' | 'OUT_OF_RANGE' | 'NOT_REGISTERED' | 'NO_FALLBACK_AVAILABLE' | 'INVALID_RESOURCE';
export interface FieldErrorV1 {
    /** 点分路径，如 `colors.primary`；整体错误用 {@link WHOLE_FIELD}。 */
    readonly field: string;
    readonly reason: PresentationErrorV1;
    /** 面向一般人的提示；不得只写日志。 */
    readonly hint?: string;
}
export type ValidationResultV1 = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly errors: readonly FieldErrorV1[];
};
/**
 * 增量推送载荷。
 * 键为点分路径（与 {@link FieldErrorV1.field} 同构），值为字符串 ——
 * CSS 变量本身就是字符串；number 型令牌（如字体 weight）在进入载荷前转成字符串。
 * CSS 变量名（`--colors-primary`）的转换在消费端做，不写进载荷。
 */
export type TokenPatchV1 = Readonly<Record<string, string>>;
/**
 * 下行入口：只有主窗持有。
 * `broadcast()` 必须是全量推送，并转调本接口的 `publish()` —— 不得另写一套推送实现。
 */
export interface IPresentationPublisherV1 {
    publish(patch: TokenPatchV1): Promise<void>;
}
/**
 * 上行入口：子窗与 iframe 只拿到这个。
 * 没有 `publish` / `apply`，因此「子窗反向改主窗主题」在类型层不存在。
 */
export interface IPresentationSubscriberV1 {
    /** 返回取消函数；模块卸载时必须调用，否则监听器泄漏。 */
    subscribe(fn: (patch: TokenPatchV1) => void): () => void;
}
/**
 * 三端口共同形状。继承 Publisher，因此 `broadcast()` 内部能调到 `publish()`。
 *
 * 实现约束（类型层无法表达，靠测试守）：
 * - `publish()` 是唯一推送出口；
 * - `apply()` 只调用 `publish()` 一次，不得再调 `broadcast()`，否则一次换肤推两遍；
 * - `broadcast()` 转调 `publish()`，语义是「手动再发一次全量」；
 * - `apply()` / `register()` 内部必须调用 `validate()`，非法值抛错；
 * - `validate()` 是纯函数，不得做 IO；
 * - 订阅端按 patch 覆盖（幂等），不做累加。
 */
export interface IPresentationPortV1<T extends {
    readonly id: string;
}> extends IPresentationPublisherV1 {
    /** 同步、纯函数、不抛错；必须遍历完所有字段再返回，不得短路。 */
    validate(v: T): ValidationResultV1;
    /** 生效并广播；非法值抛错。 */
    apply(v: T): Promise<void>;
    /** 入库，不一定生效。 */
    register(v: T): Promise<void>;
    unregister(id: string): Promise<void>;
    list(): readonly T[];
    current(): T;
    /** 全量推送；内部转调 `publish()`。 */
    broadcast(): Promise<void>;
    /** 可枚举的令牌名，供诊断面板与未来编辑器使用。 */
    describeTokens(): readonly string[];
}
