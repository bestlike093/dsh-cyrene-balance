import { HOST_CAPABILITIES, HOST_CAPABILITY } from '@pet/shared';
/**
 * 降级矩阵：每项能力的缺失行为在这里写死，模块不得自行决定。
 * `placeholder` 会在宿主根节点留可见占位，其余模式静默处理。
 */
export const CAPABILITY_DEGRADE = {
    [HOST_CAPABILITY.ask]: { mode: 'placeholder', message: '提问接管不可用：改成只读提示，不阻塞其他模块' },
    [HOST_CAPABILITY.approval]: {
        mode: 'placeholder',
        message: '审批接管不可用：需要确认的操作暂停，其他功能继续'
    },
    [HOST_CAPABILITY.taskProgress]: { mode: 'silent', message: '任务进度不可用：跳过进度上报' },
    [HOST_CAPABILITY.settings]: { mode: 'readonly', message: '设置接口不可用：使用只读默认值' },
    [HOST_CAPABILITY.tray]: { mode: 'silent', message: '托盘不可用：不显示托盘入口' },
    [HOST_CAPABILITY.window]: {
        mode: 'fixed',
        message: '窗口控制不可用：按固定画布尺寸渲染，不请求宿主改窗口'
    },
    [HOST_CAPABILITY.llmCall]: { mode: 'silent', message: 'LLM 接口不可用：台词降级到本地预置池' },
    [HOST_CAPABILITY.sessionRead]: { mode: 'readonly', message: '会话读取不可用：只用本地缓存，不订阅变更' },
    [HOST_CAPABILITY.storage]: { mode: 'silent', message: '持久化不可用：改用内存态，退出即清空' },
    [HOST_CAPABILITY.fileAccess]: { mode: 'silent', message: '文件访问不可用：隐藏上传入口' },
    [HOST_CAPABILITY.voiceInput]: { mode: 'silent', message: '语音输入不可用：静默降级，文本交互照常' },
    [HOST_CAPABILITY.skillCatalog]: { mode: 'silent', message: '技能目录不可用：隐藏技能面板' }
};
/** 降级模式的严重度。数值越大越需要让用户看见。 */
const DEGRADE_SEVERITY = {
    placeholder: 3,
    readonly: 2,
    fixed: 1,
    silent: 0
};
function parseSemver(value) {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
    if (match === null)
        return [0, 0, 0];
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
/** 语义化比较：a < b 返回负数。只比较三段数字，预发布标签忽略。 */
export function compareSemver(a, b) {
    const left = parseSemver(a);
    const right = parseSemver(b);
    for (let index = 0; index < 3; index += 1) {
        const diff = (left[index] ?? 0) - (right[index] ?? 0);
        if (diff !== 0)
            return diff;
    }
    return 0;
}
/**
 * 判定模块能否在宿主上完整运行。
 *
 * 三态分流，顺序不可颠倒：
 * 1. 真缺失 → `capability`，调用方转成降级占位；
 * 2. 形态不适用 → `not-applicable`，模块静默不启，不算失败；
 * 3. 版本过低 → `version`。
 */
export function evaluateModuleHost(meta, host) {
    const available = new Set(host.available);
    const notApplicable = new Set(host.notApplicable ?? []);
    const absent = (meta.hostCapabilities ?? []).filter((capability) => !available.has(capability));
    const missing = absent.filter((capability) => !notApplicable.has(capability));
    const skipped = absent.filter((capability) => notApplicable.has(capability));
    if (missing.length > 0) {
        const details = missing.map((capability) => `${capability}（${CAPABILITY_DEGRADE[capability].message}）`);
        const degradeMode = missing.reduce((worst, capability) => {
            const mode = CAPABILITY_DEGRADE[capability].mode;
            return DEGRADE_SEVERITY[mode] > DEGRADE_SEVERITY[worst] ? mode : worst;
        }, 'silent');
        return {
            ok: false,
            missing,
            notApplicable: skipped,
            reason: 'capability',
            message: `缺少宿主能力：${details.join('；')}`,
            degradeMode
        };
    }
    if (skipped.length > 0) {
        return {
            ok: false,
            missing: [],
            notApplicable: skipped,
            reason: 'not-applicable',
            message: `当前宿主形态不适用：${skipped.join('、')}`
        };
    }
    if (meta.minHostVersion !== undefined && compareSemver(host.version, meta.minHostVersion) < 0) {
        return {
            ok: false,
            missing: [],
            notApplicable: [],
            reason: 'version',
            message: `宿主版本 ${host.version} 低于要求 ${meta.minHostVersion}`
        };
    }
    return { ok: true, missing: [], notApplicable: [] };
}
/** 诊断面板用：把缺失能力展开成可读行，顺序固定，便于快照比对。 */
export function describeDegradation(missing) {
    const requested = new Set(missing);
    return HOST_CAPABILITIES.filter((capability) => requested.has(capability)).map((capability) => `${capability}: ${CAPABILITY_DEGRADE[capability].message}`);
}
/**
 * 解析能力声明文件（JSON 对象）。未知能力键直接忽略，便于旧宿主读新声明。
 * 非法输入返回 undefined，不抛错。
 */
export function parseHostCapabilityDeclaration(raw) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return undefined;
    const record = raw;
    const version = typeof record['version'] === 'string' ? record['version'] : '0.0.0-unknown';
    const declared = Array.isArray(record['available']) ? record['available'] : [];
    const available = HOST_CAPABILITIES.filter((capability) => declared.includes(capability));
    return { version, available };
}
/**
 * 宿主能力的三级解析：自动探测 → 声明文件 → 全部降级。
 * 探测抛错或返回空都视为「拿不到」，不阻塞 S3 开工。
 */
export async function resolveHostCapabilities(options = {}) {
    if (options.detect !== undefined) {
        try {
            const detected = await options.detect();
            if (detected.available.length > 0)
                return { snapshot: detected, source: 'detected' };
        }
        catch {
            // 落到声明文件
        }
    }
    const declared = options.declaration === undefined ? undefined : parseHostCapabilityDeclaration(options.declaration);
    if (declared !== undefined)
        return { snapshot: declared, source: 'declared' };
    return { snapshot: { version: '0.0.0-unknown', available: [] }, source: 'fallback' };
}
