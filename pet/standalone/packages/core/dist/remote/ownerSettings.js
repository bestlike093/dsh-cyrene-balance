import { OwnerPolicy } from './ownerPolicy.js';
/**
 * 主人判定的设置项。
 *
 * 只定义「字段 id 与取值约定」，不依赖 UI 包的类型：
 * core 不认识 `SettingsFieldV1`，界面侧按这些 id 注册字段即可。
 */
export const OWNER_SETTINGS = {
    /** 文本，多号用逗号 / 分号 / 空格 / 换行分隔 */
    allowlist: 'owner.qq.allowlist',
    /** 开关，'true' / 'false'。默认 true：只认私聊 */
    privateOnly: 'owner.qq.privateOnly'
};
/** 分隔符：中英文逗号、中英文分号、空白。 */
const SEPARATORS = /[,，;；\s]+/;
/**
 * 把输入框里的文本拆成 QQ 号列表。
 *
 * 容忍多余分隔符与换行，方便直接从聊天记录里粘一串。
 */
export function parseOwnerAllowlist(raw) {
    return raw
        .split(SEPARATORS)
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
}
/** 反向：把列表写成一行，供设置界面回填。 */
export function formatOwnerAllowlist(ids) {
    return ids.join(', ');
}
/**
 * 校验白名单文本，返回人话描述的问题列表；空数组表示通过。
 *
 * 只拦「明显不像 QQ 号」的输入：QQ 号是纯数字。
 * 不拦长度——历史号段长短不一，拦长度只会误伤。
 */
export function validateOwnerAllowlist(raw) {
    const ids = parseOwnerAllowlist(raw);
    const problems = [];
    const nonNumeric = ids.filter((id) => !/^\d+$/.test(id));
    if (nonNumeric.length > 0) {
        problems.push(`这些不是数字，可能填错了：${nonNumeric.join('、')}`);
    }
    const seen = new Set();
    const duplicated = new Set();
    for (const id of ids) {
        if (seen.has(id))
            duplicated.add(id);
        seen.add(id);
    }
    if (duplicated.size > 0) {
        problems.push(`这些号重复了：${[...duplicated].join('、')}`);
    }
    return problems;
}
/** 把设置界面的字符串值转成运行时判定规则。 */
export function ownerPolicyFromSettings(values) {
    const owners = parseOwnerAllowlist(values[OWNER_SETTINGS.allowlist] ?? '');
    // 只有明确写了 'false' 才放宽；缺失、空串、拼错都按「只认私聊」处理。
    const privateOnly = values[OWNER_SETTINGS.privateOnly] !== 'false';
    return new OwnerPolicy(owners, { privateOnly });
}
