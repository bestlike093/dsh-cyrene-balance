import { ErrorCode, PetError } from '@pet/shared';
/** 适配器注册表：按媒体类型分派，未知类型给出稳定错误码。 */
export class AdapterRegistry {
    adapters = new Map();
    register(adapter, options = {}) {
        if (this.adapters.has(adapter.kind) && options.replace !== true) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, `适配器已注册：${adapter.kind}`);
        }
        this.adapters.set(adapter.kind, adapter);
    }
    unregister(kind) {
        return this.adapters.delete(kind);
    }
    has(kind) {
        return this.adapters.has(kind);
    }
    kinds() {
        return [...this.adapters.keys()];
    }
    create(kind, context) {
        const adapter = this.adapters.get(kind);
        if (adapter === undefined) {
            throw new PetError(ErrorCode.MODEL_NOT_RENDERABLE, `没有可用的渲染适配器：${kind}`, {
                details: { kind, available: this.kinds() }
            });
        }
        return adapter.create(context);
    }
}
