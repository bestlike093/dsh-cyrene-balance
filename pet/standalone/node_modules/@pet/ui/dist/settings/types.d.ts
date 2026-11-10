/**
 * 设置界面骨架 —— 类型层
 *
 * 约束（见 V2.2 指令集 16.4.5）：
 * - 纯数据 + 纯渲染，**不碰任何宿主 API**（无 Electron / 无 dsh / 无 IPC）
 * - 字段由各模块注册，不硬编码在界面里
 * - 内置 readonly 展示态（能力降级时使用）
 *
 * ⚠️ 字段级校验签名与端口级不同，不要混淆：
 *   - 端口级 `validate(v: T): ValidationResultV1`  → 校验整个对象（10.1b）
 *   - 字段级 `validate(raw: string): readonly FieldErrorV1[]` → 与 core 对齐
 *   空数组 = 通过。这不违反铁律 18（那是「用空值表示失败」）。
 */
import type { FieldErrorV1, ModuleTier } from '@pet/shared';
/** 字段种类。'key' 是凭据类槽位（E2 用），骨架本身不处理凭据逻辑。 */
export type SettingsFieldKindV1 = 'text' | 'number' | 'select' | 'toggle' | 'color' | 'readonly' | 'key';
export interface SettingsOptionV1 {
    readonly value: string;
    readonly label: string;
}
export interface SettingsFieldV1 {
    /** 全包唯一。重复注册必须抛错，不得静默覆盖。 */
    readonly id: string;
    /** 分组名。分组本身也需注册（见 registry）。 */
    readonly group: string;
    readonly label: string;
    readonly kind: SettingsFieldKindV1;
    /** 组内排序。显式给出，不依赖注册顺序。 */
    readonly order?: number;
    /** 面向一般人的说明文字。目标用户是一般人 ⇒ 不是可选项。 */
    readonly hint?: string;
    /** kind === 'select' 时必填 */
    readonly options?: readonly SettingsOptionV1[];
    /** 只读展示态：能力降级 / 不可用时置 true，必须由注册方给出原因 */
    readonly readonly?: boolean;
    /** 只读原因，readonly === true 时必填（降级要可见，不能只禁用） */
    readonly readonlyReason?: string;
    /** 凭据类字段标记：渲染时不回显、不进日志、不进诊断报告 */
    readonly sensitive?: boolean;
    /**
     * 同步校验。**纯函数，不做 IO**（10.1d④）。
     * 返回错误列表；空数组表示通过。
     */
    readonly validate?: (raw: string) => readonly FieldErrorV1[];
}
export interface SettingsGroupV1 {
    readonly id: string;
    readonly label: string;
    /** 分组排序，同样显式给出 */
    readonly order?: number;
    /**
     * 模块分组所属等级。
     *
     * 给了 tier 的分组会排在无 tier 的分组之后，并按 MODULE_TIERS 的声明顺序排列
     * （从最不能关到最不该默认开）。顺序只在 shared 维护一份，界面不另写。
     */
    readonly tier?: ModuleTier;
}
/** 值快照。敏感字段从不写入，因此这里天然不含凭据。 */
export type SettingsValuesV1 = Readonly<Record<string, string>>;
/**
 * 敏感字段的展示状态。
 *
 * 只有「有没有存过」「什么时候存的」——不含 key 片段。
 * 刻意不提供「读出 key」的字段：不建这条路径，将来才没人往里加东西。
 */
export interface SensitiveFieldStatusV1 {
    readonly saved: boolean;
    /** 面向一般人的时间文本；由上层格式化，渲染层只负责显示。 */
    readonly savedAt?: string;
}
