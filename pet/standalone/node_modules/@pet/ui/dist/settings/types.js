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
export {};
