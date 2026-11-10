/**
 * 字体端口实现（S7-d）。
 *
 * 系统字体不由 core 探测 —— 那是壳的职责。壳把可用回退字体通过构造参数注入，
 * core 只做纯逻辑的匹配与回退决策：
 *
 * - 注册表里同名 family ⇒ 命中，取权重最近的一个，`isFallback: false`；
 * - 注册表没有、系统回退里有同名 ⇒ 同样算命中；
 * - 都没有 ⇒ 用回退链第一个，`isFallback: true`；
 * - 回退链为空 ⇒ 抛 `NO_FALLBACK_AVAILABLE`，不返回 null。
 */
import { ErrorCode, PetError, TOKEN_PREFIX } from '@pet/shared';
import { PresentationPortBase } from './portBase.js';
import { validateFontSource } from './validators.js';
/** 权重差最小者优先；差相同时取更重的一方，避免细体被误判。 */
function pickNearest(list, weight) {
    const sorted = [...list].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || b.weight - a.weight);
    return sorted[0];
}
export class FontPort extends PresentationPortBase {
    fallbacks;
    constructor(publisher, options = {}) {
        super(publisher);
        this.fallbacks = options.fallbacks ?? [];
    }
    toPatch(value) {
        const prefix = `${TOKEN_PREFIX.font}.${value.id}`;
        return {
            [`${prefix}.family`]: value.family,
            [`${prefix}.weight`]: String(value.weight),
            [`${prefix}.style`]: value.style,
            [`${prefix}.assetRef`]: value.assetRef
        };
    }
    validate(value) {
        return validateFontSource(value);
    }
    describeTokens() {
        return this.list().flatMap((source) => {
            const prefix = `${TOKEN_PREFIX.font}.${source.id}`;
            return [`${prefix}.family`, `${prefix}.weight`, `${prefix}.style`, `${prefix}.assetRef`];
        });
    }
    resolve(family, weight) {
        const exact = this.list().filter((source) => source.family === family);
        if (exact.length > 0) {
            return { source: pickNearest(exact, weight), isFallback: false, requestedFamily: family };
        }
        const system = this.fallbacks.filter((source) => source.family === family);
        if (system.length > 0) {
            return { source: pickNearest(system, weight), isFallback: false, requestedFamily: family };
        }
        const firstFallback = this.fallbacks[0];
        if (firstFallback !== undefined) {
            return { source: firstFallback, isFallback: true, requestedFamily: family };
        }
        throw new PetError(ErrorCode.NOT_SUPPORTED, `没有可用字体，也没有系统回退：${family}`, { details: { reason: 'NO_FALLBACK_AVAILABLE', family, weight } });
    }
}
