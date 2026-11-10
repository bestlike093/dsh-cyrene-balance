/**
 * 表现层三端口的 NOT_IMPLEMENTED 桩（S7-a）。
 *
 * 文档 10.1b：未实现的一律显式抛错，禁止静默返回空或默认值。
 * 任何针对这些桩的契约测试都应在构造上 FAIL —— 这个 FAIL 是「无人实现」的可见状态，
 * 不要为了让测试变绿而给它加默认返回。
 */
import { type FontSourceV1, type IFontPortV1, type IPresentationPortV1, type IStylePortV1, type IThemePortV1, type ResolvedFontV1, type StyleTokensV1, type ThemeTokensV1, type TokenPatchV1, type ValidationResultV1 } from '@pet/shared';
/** 三端口共同的桩行为；子类只提供端口名与特有成员。 */
declare abstract class PresentationPortStub<T extends {
    readonly id: string;
}> implements IPresentationPortV1<T> {
    protected abstract readonly portName: string;
    validate(_value: T): ValidationResultV1;
    publish(_patch: TokenPatchV1): Promise<void>;
    apply(_value: T): Promise<void>;
    register(_value: T): Promise<void>;
    unregister(_id: string): Promise<void>;
    list(): readonly T[];
    current(): T;
    broadcast(): Promise<void>;
    describeTokens(): readonly string[];
}
export declare class NotImplementedThemePort extends PresentationPortStub<ThemeTokensV1> implements IThemePortV1 {
    protected readonly portName = "IThemePortV1";
}
export declare class NotImplementedStylePort extends PresentationPortStub<StyleTokensV1> implements IStylePortV1 {
    protected readonly portName = "IStylePortV1";
}
export declare class NotImplementedFontPort extends PresentationPortStub<FontSourceV1> implements IFontPortV1 {
    protected readonly portName = "IFontPortV1";
    resolve(_family: string, _weight: number): ResolvedFontV1;
}
export {};
