import { validateAssetRef } from '../presentation/validators.js';
/** 帧率上限：高于它基本等于笔误，也避免 dt 归一化时出现极小数。 */
const MAX_FPS = 120;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPositiveInt(value) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
function isNonNegativeInt(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function invalid(field, hint, reason = 'INVALID_RESOURCE') {
    return { field, reason, hint };
}
function parseGrid(raw, errors) {
    if (!isRecord(raw)) {
        errors.push(invalid('grid', 'grid 必须是对象，含 columns / rows / frameWidth / frameHeight'));
        return null;
    }
    let ok = true;
    for (const key of ['columns', 'rows', 'frameWidth', 'frameHeight']) {
        if (!isPositiveInt(raw[key])) {
            errors.push(invalid(`grid.${key}`, `${key} 必须是正整数`, 'OUT_OF_RANGE'));
            ok = false;
        }
    }
    if (!ok)
        return null;
    const columns = raw.columns;
    const rows = raw.rows;
    const frameWidth = raw.frameWidth;
    const frameHeight = raw.frameHeight;
    return { columns, rows, frameWidth, frameHeight };
}
function parseClip(raw, index, totalFrames, seenNames, errors) {
    const path = `clips[${index}]`;
    if (!isRecord(raw)) {
        errors.push(invalid(path, '片段必须是对象'));
        return null;
    }
    let ok = true;
    const name = raw.name;
    if (typeof name !== 'string' || name.length === 0) {
        errors.push(invalid(`${path}.name`, '片段名不能为空', 'INVALID_TOKEN'));
        ok = false;
    }
    else if (seenNames.has(name)) {
        errors.push(invalid(`${path}.name`, `片段名重复：${name}`, 'INVALID_TOKEN'));
        ok = false;
    }
    else {
        seenNames.add(name);
    }
    const startFrame = raw.startFrame;
    if (!isNonNegativeInt(startFrame)) {
        errors.push(invalid(`${path}.startFrame`, 'startFrame 必须是非负整数', 'OUT_OF_RANGE'));
        ok = false;
    }
    const frameCount = raw.frameCount;
    if (!isPositiveInt(frameCount)) {
        errors.push(invalid(`${path}.frameCount`, 'frameCount 必须是正整数', 'OUT_OF_RANGE'));
        ok = false;
    }
    const fps = raw.fps;
    if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || fps > MAX_FPS) {
        errors.push(invalid(`${path}.fps`, `fps 必须在 (0, ${MAX_FPS}] 之间`, 'OUT_OF_RANGE'));
        ok = false;
    }
    const loop = raw.loop;
    if (typeof loop !== 'boolean') {
        errors.push(invalid(`${path}.loop`, 'loop 必须是布尔值'));
        ok = false;
    }
    if (ok && isNonNegativeInt(startFrame) && isPositiveInt(frameCount) && startFrame + frameCount > totalFrames) {
        errors.push(invalid(`${path}.frameCount`, `片段超出帧总数：${startFrame} + ${frameCount} > ${totalFrames}`, 'OUT_OF_RANGE'));
        ok = false;
    }
    if (!ok)
        return null;
    return {
        name: name,
        startFrame: startFrame,
        frameCount: frameCount,
        fps: fps,
        loop: loop
    };
}
/**
 * 解析外部帧序列描述。
 *
 * 任一字段不合格都会收集进 errors 后整体失败，不做「部分可用」的降级——
 * 静默接受残缺描述会在播放期变成难查的空帧。
 */
export function parseSpriteSheet(raw) {
    if (!isRecord(raw)) {
        return {
            ok: false,
            errors: [invalid('', '帧序列描述必须是对象', 'INVALID_TOKEN')]
        };
    }
    const errors = [];
    const image = raw.image;
    if (typeof image !== 'string') {
        errors.push(invalid('image', 'image 必须是资源引用字符串'));
    }
    else {
        errors.push(...validateAssetRef('image', image));
    }
    const grid = parseGrid(raw.grid, errors);
    const totalFrames = grid === null ? 0 : grid.columns * grid.rows;
    const clipsRaw = raw.clips;
    const clips = [];
    if (!Array.isArray(clipsRaw) || clipsRaw.length === 0) {
        errors.push(invalid('clips', 'clips 必须是非空数组'));
    }
    else if (grid !== null) {
        const seen = new Set();
        for (let i = 0; i < clipsRaw.length; i += 1) {
            const clip = parseClip(clipsRaw[i], i, totalFrames, seen, errors);
            if (clip !== null)
                clips.push(clip);
        }
    }
    if (errors.length > 0)
        return { ok: false, errors };
    return {
        ok: true,
        value: {
            image: image,
            grid: grid,
            clips
        }
    };
}
