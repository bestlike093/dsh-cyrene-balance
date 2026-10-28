/**
 * v2.1 情绪与台词契约（文档第 4 章）。
 * 核心约束：台词与表情必须成对；解析失败要能说明降级到了哪一级。
 */
export const EMOTION_RESOLUTION_SOURCES = [
    'structured',
    'exact',
    'alias',
    'nearest',
    'fallback',
    'default'
];
/** 只接受「一个表情 + 一句台词」，防止模型一次吐多对造成重复渲染。 */
export function isDialoguePair(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return typeof record['emotion'] === 'string' && typeof record['line'] === 'string' && record['line'].length > 0;
}
//# sourceMappingURL=emotion.js.map