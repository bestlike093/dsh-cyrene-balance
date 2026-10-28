/**
 * v2.2 宿主适配契约（文档第 9 章端口层、第 16 章 ①）。
 *
 * 铁律 3：失败必须可见。探测失败抛 `HostProbeError`；
 * 返回空 `available` 只表示「探测成功，宿主确实没有声明任何能力」。
 */
/** 探测失败的唯一表达形式。调用方按 code 决定降级路径。 */
export class HostProbeError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'HostProbeError';
        this.code = code;
    }
}
//# sourceMappingURL=host.js.map