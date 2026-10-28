/**
 * v2.1 渲染与上传契约（文档第 2 章）。
 * 上层只认 IModel + IScaler；PIXI 只是其中一种实现。
 */
/** `profile.anchor` 到 `fit(align)` 的唯一映射入口。 */
export function alignForProfile(profile) {
    return profile.anchor === 'bottom-center' ? 'bottom' : 'center';
}
/**
 * 按文件名判断媒体类型。入口统一在这里，避免 renderer 与上传流水线各写一套。
 * 未知扩展名返回 null，由调用方明确拒绝。
 */
export function mediaKindForName(name) {
    const lower = name.toLowerCase();
    if (/\.(png|jpe?g|webp)$/.test(lower))
        return 'image';
    if (lower.endsWith('.gif'))
        return 'gif';
    if (/\.(mp4|webm|mov)$/.test(lower))
        return 'video';
    if (lower.endsWith('.model3.json'))
        return 'live2d';
    // 必须放在 model3.json 之后：两者都以 .json 结尾，先判 sprite 会吞掉 Live2D 描述。
    if (lower.endsWith('.sprite.json'))
        return 'sprite';
    if (lower.endsWith('.moc3'))
        return 'live2d';
    return null;
}
//# sourceMappingURL=render.js.map