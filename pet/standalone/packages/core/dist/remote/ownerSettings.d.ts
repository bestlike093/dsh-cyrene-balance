import { OwnerPolicy } from './ownerPolicy.js';
/**
 * 主人判定的设置项。
 *
 * 只定义「字段 id 与取值约定」，不依赖 UI 包的类型：
 * core 不认识 `SettingsFieldV1`，界面侧按这些 id 注册字段即可。
 */
export declare const OWNER_SETTINGS: {
    /** 文本，多号用逗号 / 分号 / 空格 / 换行分隔 */
    readonly allowlist: "owner.qq.allowlist";
    /** 开关，'true' / 'false'。默认 true：只认私聊 */
    readonly privateOnly: "owner.qq.privateOnly";
};
/**
 * 把输入框里的文本拆成 QQ 号列表。
 *
 * 容忍多余分隔符与换行，方便直接从聊天记录里粘一串。
 */
export declare function parseOwnerAllowlist(raw: string): string[];
/** 反向：把列表写成一行，供设置界面回填。 */
export declare function formatOwnerAllowlist(ids: readonly string[]): string;
/**
 * 校验白名单文本，返回人话描述的问题列表；空数组表示通过。
 *
 * 只拦「明显不像 QQ 号」的输入：QQ 号是纯数字。
 * 不拦长度——历史号段长短不一，拦长度只会误伤。
 */
export declare function validateOwnerAllowlist(raw: string): readonly string[];
/**
 * 设置值快照里与本层相关的部分。
 *
 * 键用设置项 id，与界面注册的字段 id 保持一致 ——
 * 这样从 `SettingsValuesV1`（Record<string, string>）取出来可以直接喂进来。
 */
export interface OwnerSettingsValues {
    readonly [OWNER_SETTINGS.allowlist]?: string;
    readonly [OWNER_SETTINGS.privateOnly]?: string;
}
/** 把设置界面的字符串值转成运行时判定规则。 */
export declare function ownerPolicyFromSettings(values: OwnerSettingsValues): OwnerPolicy;
