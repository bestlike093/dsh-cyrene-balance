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
import { type FontSourceV1, type IFontPortV1, type IPresentationPublisherV1, type ResolvedFontV1, type TokenPatchV1, type ValidationResultV1 } from '@pet/shared';
import { PresentationPortBase } from './portBase.js';
export interface FontPortOptions {
    /** 壳注入的系统回退字体；按优先级排列。 */
    readonly fallbacks?: readonly FontSourceV1[];
}
export declare class FontPort extends PresentationPortBase<FontSourceV1> implements IFontPortV1 {
    private readonly fallbacks;
    constructor(publisher: IPresentationPublisherV1, options?: FontPortOptions);
    protected toPatch(value: FontSourceV1): TokenPatchV1;
    validate(value: FontSourceV1): ValidationResultV1;
    describeTokens(): readonly string[];
    resolve(family: string, weight: number): ResolvedFontV1;
}
