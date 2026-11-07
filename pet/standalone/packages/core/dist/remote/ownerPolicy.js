/**
 * 主人判定。
 *
 * 两条同时满足才算：
 * 1. 私聊（可关，见 `privateOnly`）
 * 2. QQ 号在名单里
 *
 * 名单为空 = 谁都不是主人。这是 fail-closed：
 * 忘了配名单会退化成「只有群友模式」，不会误提权。
 *
 * 默认只认私聊：群成员可以顶着相同昵称说话，
 * 群聊里判断「这句话是不是主人的」没有可靠依据。
 * 关掉这个开关等于允许群聊提权，属于用户主动放宽。
 */
export class OwnerPolicy {
    owners;
    privateOnly;
    constructor(owners = [], options = {}) {
        this.owners = new Set(owners.map((id) => id.trim()).filter((id) => id.length > 0));
        this.privateOnly = options.privateOnly ?? true;
    }
    isOwner(message) {
        if (this.privateOnly && message.chatType !== 'private')
            return false;
        return this.owners.has(message.userId.trim());
    }
    get ownerCount() {
        return this.owners.size;
    }
    get requiresPrivateChat() {
        return this.privateOnly;
    }
}
/**
 * 把一条入站消息作用到会话闸门上。
 *
 * 只处理「提权」，不处理「降权」：
 * 群友说话不该把主人踢回 chat，否则主人在群里聊两句就丢了权限。
 * 降权只由空闲窗口负责。
 *
 * 返回 true 表示这条消息让模式变成了 closed-agent。
 */
export function applyIncomingMessage(gate, policy, message) {
    if (!policy.isOwner(message))
        return false;
    gate.touch();
    if (gate.mode === 'closed-agent')
        return false;
    gate.switchTo('closed-agent');
    return true;
}
