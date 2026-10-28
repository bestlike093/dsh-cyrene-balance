export const ALL_PERMISSIONS = [
    'ui.render',
    'ui.click-through',
    'net.egress',
    'fs.user-assets.read',
    'dsh.context.read',
    'dsh.decision.commit',
    'vault.seal',
    'memory.read',
    'memory.write'
];
/**
 * 能力名的唯一真源。
 *
 * `approval` 同时是宿主能力名与 `contracts/crypto.ts` 的 `Capability` 字面量。
 * 在能力上下文里裸写字符串，读代码的人无法判断来源；
 * 这个对象是 ③-d 扫描脚本的对照基准，别处一律引用它。
 */
export const HOST_CAPABILITY = {
    ask: 'ask',
    approval: 'approval',
    taskProgress: 'taskProgress',
    settings: 'settings',
    tray: 'tray',
    window: 'window',
    llmCall: 'llmCall',
    sessionRead: 'sessionRead',
    storage: 'storage',
    fileAccess: 'fileAccess',
    voiceInput: 'voiceInput',
    skillCatalog: 'skillCatalog'
};
/** 顺序即声明顺序；诊断输出依赖它保持稳定。 */
export const HOST_CAPABILITIES = Object.values(HOST_CAPABILITY);
/**
 * 每项能力的宿主形态。`Record<HostCapability, ...>` 保证扩项时漏写会编译失败 ——
 * 形态限定靠类型检查，不靠注释。
 */
export const HOST_CAPABILITY_FORM = {
    [HOST_CAPABILITY.ask]: 'any',
    [HOST_CAPABILITY.approval]: 'any',
    [HOST_CAPABILITY.taskProgress]: 'any',
    [HOST_CAPABILITY.settings]: 'any',
    [HOST_CAPABILITY.tray]: 'electron-only',
    [HOST_CAPABILITY.window]: 'electron-only',
    [HOST_CAPABILITY.llmCall]: 'any',
    [HOST_CAPABILITY.sessionRead]: 'any',
    [HOST_CAPABILITY.storage]: 'any',
    [HOST_CAPABILITY.fileAccess]: 'any',
    [HOST_CAPABILITY.voiceInput]: 'any',
    [HOST_CAPABILITY.skillCatalog]: 'any'
};
//# sourceMappingURL=module.js.map