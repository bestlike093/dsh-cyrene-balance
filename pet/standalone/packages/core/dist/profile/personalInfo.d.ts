/**
 * 个人信息。
 *
 * 真名、邮箱、电话、住址这些一旦落到普通配置文件里，
 * 就等于散落在磁盘上。这一层把它们整组送进加密仓库，
 * 明文配置里一个字段都不留。
 *
 * 和 `net/serviceSchema` 共用 `SecretWriter`，但目录固定为 `profile`，
 * 不和外部服务的 key 混在一起。
 *
 * 对应能力：`io.file.write` 之外的所有「需要知道你是谁」的调用。
 */
import type { ConfigValues, SecretWriter } from '../net/serviceSchema.js';
export type PersonalFieldKey = 'realName' | 'email' | 'phone' | 'address' | 'birthday' | 'idNumber';
export interface PersonalField {
    readonly key: PersonalFieldKey;
    readonly label: string;
    readonly required: boolean;
    readonly description: string;
    readonly placeholder?: string;
}
/**
 * 全部字段都算隐私，没有例外。
 *
 * `idNumber` 单独列出来是因为它最敏感：一旦泄露，
 * 能做的事情比手机号多得多。默认不填。
 */
export declare const PERSONAL_FIELDS: readonly PersonalField[];
export interface PersonalSplit {
    /** 有值的字段，交给加密仓库。 */
    readonly secrets: Readonly<Record<string, string>>;
    /** 永远是空对象：这一组不存在「可以落明文」的部分。 */
    readonly plain: Readonly<Record<string, never>>;
}
/**
 * 拆分个人信息。
 *
 * 返回的 `plain` 恒为空，调用方不用再判断哪些能写进配置文件——
 * 一律不许写。
 */
export declare function splitPersonal(values: ConfigValues): PersonalSplit;
/**
 * 日志与错误信息用的脱敏副本。
 *
 * 邮箱和电话保留一点点结构，方便用户确认「填的是不是这一条」，
 * 其余一律整段打码。
 */
export declare function redactPersonal(values: ConfigValues): Readonly<Record<string, string>>;
export interface PersonalPersistResult extends PersonalSplit {
    readonly written: readonly string[];
    readonly cleared: readonly string[];
}
/** 加密仓库里这一组数据用的目录名。 */
export declare const PERSONAL_SCOPE = "profile";
/**
 * 写入加密仓库。
 *
 * `clearKeys` 显式列出要删掉的字段，不传就什么都不删。
 */
export declare function persistPersonal(writer: SecretWriter, values: ConfigValues, clearKeys?: readonly string[]): Promise<PersonalPersistResult>;
/** 校验：邮箱和电话做最基本的形状检查，不追求覆盖所有写法。 */
export declare function validatePersonal(values: ConfigValues): readonly string[];
