import type { IModel, ModelKind, SizeProfile, SpriteSheet } from '@pet/shared';
export interface AdapterContext {
    readonly id: string;
    readonly source: string;
    readonly profile: SizeProfile;
    /** 像素比，供适配器决定内部画布尺寸 */
    readonly dpr: number;
    /** 已解析的帧序列描述；仅 sprite 适配器读取，其他适配器忽略。 */
    readonly spriteSheet?: SpriteSheet;
}
export interface ModelAdapter {
    readonly kind: ModelKind;
    create(context: AdapterContext): IModel;
}
/** 适配器注册表：按媒体类型分派，未知类型给出稳定错误码。 */
export declare class AdapterRegistry {
    private readonly adapters;
    register(adapter: ModelAdapter, options?: {
        replace?: boolean;
    }): void;
    unregister(kind: ModelKind): boolean;
    has(kind: ModelKind): boolean;
    kinds(): readonly ModelKind[];
    create(kind: ModelKind, context: AdapterContext): IModel;
}
