/**
 * 字段注册示例
 *
 * ⚠️ 本文件是「骨架可供 E2 复用」的示范（V2.2 16.4.5），
 *    交付时必须显式标注这一句，否则 E2 开工时会重搭一套设置界面。
 *
 * 示范三类：
 *   1. 表现层字段（主题 / 字体 / 风格）—— 校验器**从 core 导入，不在 ui 重写**
 *   2. 只读降级态 —— 能力不可用时的展示
 *   3. 凭据槽位（kind: 'key'）—— E2 将注册，骨架只给槽位，不实现凭据逻辑
 */
import { SettingsRegistryV1 } from './registry.js';
import { validateColor, validateFontFamily, validateFontWeight, } from '@pet/core/presentation';
export function createRegistry() {
    const r = new SettingsRegistryV1();
    // ---- 分组（顺序显式给出）----
    r.registerGroup({ id: 'appearance', label: '外观', order: 10 });
    r.registerGroup({ id: 'font', label: '字体', order: 20 });
    r.registerGroup({ id: 'account', label: '账号', order: 30 });
    // ---- 1. 表现层字段 ----
    r.register({
        id: 'theme.primary',
        group: 'appearance',
        label: '主题色',
        kind: 'color',
        order: 10,
        hint: '支持 #RRGGBB 或 rgb()，也支持预置变量名',
        validate: (raw) => validateColor('theme.primary', raw),
    });
    r.register({
        id: 'font.family',
        group: 'font',
        label: '字体',
        kind: 'text',
        order: 10,
        hint: '留空则使用系统字体',
        validate: (raw) => validateFontFamily('font.family', raw),
    });
    r.register({
        id: 'font.weight',
        group: 'font',
        label: '字重',
        kind: 'number',
        order: 20,
        hint: '100 – 900',
        // HTML input 的 value 恒为 string；core 侧收 number，故在此转换。
        // NaN / 非有限数 → OUT_OF_RANGE（不静默当 0 处理）。
        validate: (raw) => {
            const n = Number(raw);
            if (!Number.isFinite(n)) {
                return [{ field: 'font.weight', reason: 'OUT_OF_RANGE' }];
            }
            return validateFontWeight('font.weight', n);
        },
    });
    // ---- 2. 只读降级态示例 ----
    // 宿主不具备某能力时（如纯插件形态下无 window 控制），
    // 由注册方在注册时决定 readonly，并给出原因。
    r.register({
        id: 'window.alwaysOnTop',
        group: 'appearance',
        label: '始终置顶',
        kind: 'toggle',
        order: 90,
        readonly: true,
        // ⛔ readonly === true 时必须给 readonlyReason，否则注册抛错
        readonlyReason: '当前宿主不提供窗口控制（纯插件形态）',
    });
    // ---- 3. E2 凭据槽位（骨架只给槽位）----
    // ⚠️ 骨架不实现任何凭据逻辑：不读取、不存储、不回显、不进日志。
    //    E2 开工时在此注册真实字段即可，界面无需改动。
    r.register({
        id: 'account.apiKey',
        group: 'account',
        label: 'API Key',
        kind: 'key',
        order: 10,
        sensitive: true,
        hint: '粘贴后仅保存在本地加密存储中',
        // E2 将在此接入真实校验；此处仅占位，空值返回一个错误。
        validate: (raw) => raw.length === 0 ? [{ field: '$', reason: 'INVALID_TOKEN' }] : [],
    });
    // ---- 4. 模块开关分组（按等级排序）----
    // 排序不靠这里的 order，靠 tier：分组会按 MODULE_TIERS 的声明顺序排列
    // （core → essential → general → dangerous → critical），
    // 无 tier 的分组始终排在前面。等级顺序只在 shared 维护一份。
    // ⚠️ 这里只示范分组与顺序；真实开关由各模块注册，界面无需改动。
    r.registerGroup({ id: 'modules.essential', label: '基础功能', tier: 'essential' });
    r.registerGroup({ id: 'modules.general', label: '扩展功能', tier: 'general' });
    r.registerGroup({ id: 'modules.dangerous', label: '高风险功能', tier: 'dangerous' });
    r.register({
        id: 'modules.bubble.enabled',
        group: 'modules.essential',
        label: '桌面气泡',
        kind: 'toggle',
        order: 10,
        hint: '关闭后桌宠不再显示对话气泡',
    });
    r.register({
        id: 'modules.reminder.enabled',
        group: 'modules.general',
        label: '定时提醒',
        kind: 'toggle',
        order: 10,
        hint: '按设定时间提醒你休息或做某件事',
    });
    r.register({
        id: 'modules.shell.enabled',
        group: 'modules.dangerous',
        label: '执行本机命令',
        kind: 'toggle',
        order: 10,
        hint: '允许模块运行本机命令，关闭后相关功能不可用',
        readonly: true,
        readonlyReason: '该能力需要单独授权，授权入口尚未开放',
    });
    return r;
}
