/**
 * 外部服务的配置表单描述。
 *
 * 抄两处做法：
 *
 * - 宿主（Cyrene）是「设置 → 插件 → 填 Key」，字段少但每加一项都要改页面。
 * - AstrBot 是插件自带一份配置 schema，WebUI 照着渲染表单，插件不用画界面。
 *
 * 取后者：桌宠只描述「有哪些字段、什么类型、必填与否、怎么校验」，
 * 面板照着渲染就行。加一个服务时不碰 UI 代码。
 *
 * 密钥字段单独标成 `secret`，UI 应当用密码框并以掩码回显，
 * 不允许把明文写进日志或拼进错误信息。
 */
export type FieldType = 'text' | 'secret' | 'url' | 'number' | 'switch' | 'select';
export interface SelectOption {
    readonly value: string;
    readonly label: string;
}
export interface ConfigField {
    readonly key: string;
    readonly label: string;
    readonly type: FieldType;
    readonly required: boolean;
    readonly description?: string;
    readonly placeholder?: string;
    readonly defaultValue?: string | number | boolean;
    /**
     * 这一项算隐私，必须进加密仓库。
     *
     * 不只是密钥：自建接口地址、内网域名、代理 IP 都会暴露使用者的网络位置。
     * `type: 'secret'` 的字段自动算敏感，不用再标一次。
     */
    readonly sensitive?: boolean;
    /** 仅 `select` 使用。 */
    readonly options?: readonly SelectOption[];
    /** 仅 `number` 使用。 */
    readonly min?: number;
    readonly max?: number;
}
export interface ServiceSchema {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    /** 去哪里申请密钥。留空表示由使用者自己判断。 */
    readonly docsUrl?: string;
    readonly fields: readonly ConfigField[];
}
export interface FieldError {
    readonly key: string;
    readonly message: string;
}
/**
 * 三个服务的表单。
 *
 * 刻意不写死任何服务商名字：换一家、走自建代理都只是改值，
 * 不需要改这份 schema。
 */
export declare const SERVICE_SCHEMAS: readonly ServiceSchema[];
export type ConfigValues = Readonly<Record<string, string | number | boolean | undefined>>;
/**
 * 校验一份表单值。
 *
 * 一次返回全部问题，面板能一次标完红字，不用让用户改一处试一次。
 * `secret` 字段的错误信息里不含值本身。
 */
export declare function validateValues(schema: ServiceSchema, values: ConfigValues): readonly FieldError[];
export interface FormField extends ConfigField {
    /** 已经填了就用填的，没填用默认值。 */
    readonly value: string | number | boolean | undefined;
    readonly error: string | null;
}
/**
 * 给 UI 用的渲染模型：字段顺序、当前值、错误都在一条里。
 *
 * 面板只管照着这个数组画控件，不用自己合并默认值或去对照错误。
 */
export declare function toFormModel(schema: ServiceSchema, values: ConfigValues): readonly FormField[];
/** 这一项是否必须进加密仓库。 */
export declare function isSensitiveField(field: ConfigField): boolean;
/** 需要加密的字段名，按 schema 顺序。 */
export declare function sensitiveKeys(schema: ServiceSchema): readonly string[];
export interface SplitResult {
    /** 只含已填的敏感字段，交给加密仓库。 */
    readonly secrets: Readonly<Record<string, string>>;
    /** 其余字段，可以落普通配置文件。 */
    readonly plain: Readonly<Record<string, unknown>>;
}
/**
 * 把一份表单值拆成两半。
 *
 * 判断依据只来自 schema，调用方不需要自己认哪些算隐私。
 * 没填的字段不会出现在任何一半里——避免空串覆盖掉已存的值。
 */
export declare function splitForStorage(schema: ServiceSchema, values: ConfigValues): SplitResult;
/**
 * 脱敏副本，给日志与错误信息用。
 *
 * 敏感项一律写成固定长度的星号串，长度也刻意不跟随原文，
 * 免得从日志里反推出密钥长度。非敏感项照常显示。
 */
export declare function redactValues(schema: ServiceSchema, values: ConfigValues): Readonly<Record<string, string>>;
/**
 * 加密仓库需要的最小能力。
 *
 * core 不依赖 vault，只要求传进来的东西长这样；
 * vault 的 `VaultServiceSecretStore` 天然满足。
 */
export interface SecretWriter {
    set(serviceId: string, value: string, field?: string): Promise<void>;
    clear(serviceId: string, field?: string): Promise<void>;
}
export interface PersistResult extends SplitResult {
    /** 写进加密仓库的字段名。 */
    readonly written: readonly string[];
    /** 从加密仓库清掉的字段名。 */
    readonly cleared: readonly string[];
}
/**
 * 按 schema 把敏感字段写进加密仓库。
 *
 * `clearKeys` 显式列出要清掉的字段——不传就不清，
 * 避免「用户只是没改这一项」被当成「要删掉」。
 */
export declare function persistSecrets(writer: SecretWriter, schema: ServiceSchema, values: ConfigValues, clearKeys?: readonly string[]): Promise<PersistResult>;
