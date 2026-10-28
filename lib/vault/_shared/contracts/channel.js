/**
 * v2.1 远程决策与通道契约（文档第 9 章）。
 * envelope 只携带摘要与密文，原始上下文不出本机。
 */
export const DECISION_KINDS = ['approval', 'question', 'notice'];
export const DECISION_ACTIONS = ['allow', 'deny', 'answer', 'dismiss'];
export const CHANNEL_IDS = ['local-loopback', 'qq', 'wechat', 'webhook'];
//# sourceMappingURL=channel.js.map