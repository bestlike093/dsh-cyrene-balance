/**
 * 运行时契约。
 *
 * 和 `@pet/shared` 的 `HostAdapter` 是两件事，刻意分开命名：
 *
 * - `HostAdapter`：宿主**替我决策**——问用户、审批、报进度。
 * - `PetRuntime`：宿主**替我供料**——会话、通知、语音、抓帧、输入、存储。
 *
 * dsh 是一种实现，独立进程是另一种，QQ / 微信适配器也可以是。
 * 所有可选能力都配一个布尔位：core 能在不发起调用的前提下判断，
 * 而不是「先试一次失败再降级」——那会把异常当流程。
 */
/** 运行时能力不足时抛出，调用方据此降级而不是崩溃。 */
export class RuntimeCapabilityError extends Error {
    capability;
    constructor(capability, runtimeId) {
        super(`运行时 ${runtimeId} 不支持 ${capability}`);
        this.name = 'RuntimeCapabilityError';
        this.capability = capability;
    }
}
/** 调用可选能力前的统一检查。 */
export function requireCapability(runtime, capability) {
    if (!runtime.capabilities[capability]) {
        throw new RuntimeCapabilityError(capability, runtime.id);
    }
}
/**
 * 最容易出错的四处，先固化成小工具。
 *
 * 这些组合在睡眠、游戏、语音三条线上都会反复出现，散在各处写会不一致。
 */
export const runtimeOps = {
    async trySpeak(runtime, text, options) {
        if (!runtime.capabilities.speech)
            return false;
        await runtime.speak(text, options);
        return true;
    },
    async tryNotify(runtime, notice) {
        if (!runtime.capabilities.notify)
            return false;
        await runtime.notify(notice);
        return true;
    },
    /** 读状态但没装存储时返回 null，调用方不要因此认为「状态是空的」。 */
    async readStateOrNull(runtime, key) {
        if (!runtime.capabilities.storage)
            return null;
        return runtime.readState(key);
    },
    async captureOrNull(runtime, target) {
        if (!runtime.capabilities.capture || runtime.capture === undefined)
            return null;
        return runtime.capture(target);
    }
};
